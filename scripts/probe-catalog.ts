/**
 * Diagnostic probe: fetch the ENTIRE Polza model catalog (all pages) directly from the API
 * and report on its real structure. Does not register any Pi provider.
 *
 * Output:
 *  - console: statistics + cheapest chat models
 *  - artifacts/raw/catalog-full.json   (git-ignored, redacted full dump)
 *  - artifacts/catalog-sample.json     (small committed sample used by mapper tests)
 *
 * Run: npm run probe:catalog
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PROJECT_ROOT } from "../.pi/extensions/pi-polza/env.ts";
import { fetchCatalog, hasCachePricing, isChatModel, isUsableChatModel, supportsChatCompletions, supportsReasoning, supportsTextOutput, supportsTools, supportsVision, toNumber } from "../.pi/extensions/pi-polza/catalog.ts";
import { redactJson } from "../.pi/extensions/pi-polza/http.ts";
import type { PolzaCatalogModel } from "../.pi/extensions/pi-polza/types.ts";

const ARTIFACTS = resolve(PROJECT_ROOT, "artifacts");
const RAW_DIR = resolve(ARTIFACTS, "raw");

function priceOf(model: PolzaCatalogModel): { prompt?: number; completion?: number; currency?: string } {
  const pricing = model.top_provider?.pricing;
  return {
    prompt: toNumber(pricing?.prompt_per_million),
    completion: toNumber(pricing?.completion_per_million),
    currency: typeof pricing?.currency === "string" ? pricing.currency : undefined,
  };
}

function describe(model: PolzaCatalogModel): string {
  const price = priceOf(model);
  const ctx = model.top_provider?.context_length;
  const maxOut = model.top_provider?.max_completion_tokens;
  return [
    model.id,
    `type=${model.type ?? "?"}`,
    `ctx=${ctx ?? "null"}`,
    `maxOut=${maxOut ?? "null"}`,
    `in=[${(model.architecture?.input_modalities ?? []).join(",")}]`,
    `prompt=${price.prompt ?? "?"}${price.currency ? " " + price.currency : ""}`,
    `completion=${price.completion ?? "?"}`,
    `tools=${supportsTools(model)}`,
    `vision=${supportsVision(model)}`,
    `reasoning=${supportsReasoning(model)}`,
    `cache=${hasCachePricing(model)}`,
  ].join("  ");
}

async function main(): Promise<void> {
  console.log("Fetching full Polza catalog (all pages)...");
  const started = Date.now();
  const { models, pages, reportedTotal } = await fetchCatalog({
    limit: 100,
    onPage: (page, number) => {
      const meta = page.meta ?? {};
      console.log(
        `  page ${number}: received ${page.data.length} — meta(total=${meta.total ?? "?"}, totalPages=${meta.totalPages ?? "?"})`,
      );
    },
  });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  const chat = models.filter(isChatModel);
  const chatCompletions = chat.filter(supportsChatCompletions);
  const usableChat = chatCompletions.filter(isUsableChatModel);
  const nonTextChat = chatCompletions.filter((m) => !supportsTextOutput(m));
  const toolCapable = usableChat.filter(supportsTools);
  const vision = usableChat.filter(supportsVision);
  const reasoning = usableChat.filter(supportsReasoning);
  const withCachePricing = usableChat.filter(hasCachePricing);
  const withoutContext = usableChat.filter((m) => !(typeof m.top_provider?.context_length === "number" && m.top_provider.context_length > 0));
  const withoutMaxOut = usableChat.filter(
    (m) => !(typeof m.top_provider?.max_completion_tokens === "number" && m.top_provider.max_completion_tokens > 0),
  );

  const currencies = new Set<string>();
  const types = new Map<string, number>();
  const keyUnion = new Set<string>();
  for (const model of models) {
    types.set(model.type ?? "(none)", (types.get(model.type ?? "(none)") ?? 0) + 1);
    const currency = priceOf(model).currency;
    if (currency) currencies.add(currency);
    for (const key of Object.keys(model)) keyUnion.add(key);
  }

  console.log(`\nFetched ${models.length} models across ${pages} page(s) in ${elapsed}s (meta.total=${reportedTotal ?? "?"}).`);

  console.log("\nModel types:");
  for (const [type, count] of [...types.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`);
  }

  console.log("\nTop-level keys observed on catalog entries:");
  console.log("  " + [...keyUnion].sort().join(", "));

  console.log("\nAll catalog models:              " + models.length);
  console.log("Chat models (type==chat):        " + chat.length);
  console.log("Chat Completions compatible:     " + chatCompletions.length);
  console.log("Chat models with text output:    " + usableChat.length + "  (excluded non-text: " + nonTextChat.length + ")");
  console.log("Tool-capable:                    " + toolCapable.length);
  console.log("Vision-capable:                  " + vision.length);
  console.log("Reasoning-capable:               " + reasoning.length);
  console.log("Models with cache pricing:       " + withCachePricing.length);
  console.log("Models without context_length:   " + withoutContext.length);
  console.log("Models without max_completion_tokens: " + withoutMaxOut.length);
  console.log("Currencies found:                " + ([...currencies].join(", ") || "(none)"));

  // Cheapest chat models suitable for cheap tests.
  const priced = usableChat
    .map((model) => ({ model, ...priceOf(model) }))
    .filter((entry) => entry.prompt !== undefined && entry.completion !== undefined)
    .sort((a, b) => (a.prompt! - b.prompt!) || (a.completion! - b.completion!));

  console.log("\n10 cheapest Chat Completions chat models (by prompt price):");
  for (const entry of priced.slice(0, 10)) {
    console.log(
      `  ${entry.prompt} ${entry.currency ?? "?"} / ${entry.completion ?? "?"}  ${entry.model.id}  ctx=${entry.model.top_provider?.context_length ?? "null"}  maxOut=${entry.model.top_provider?.max_completion_tokens ?? "null"}  tools=${supportsTools(entry.model)}`,
    );
  }

  console.log("\nSample cache-priced models:");
  for (const model of withCachePricing.slice(0, 8)) {
    console.log("  " + describe(model));
  }

  // Persist a redacted full dump (git-ignored) and a small committed sample.
  mkdirSync(RAW_DIR, { recursive: true });
  writeFileSync(resolve(RAW_DIR, "catalog-full.json"), JSON.stringify(redactJson({ models, pages, reportedTotal }), null, 2) + "\n");

  const pickFirst = (predicate: (m: PolzaCatalogModel) => boolean, exclude: Set<string>): PolzaCatalogModel | undefined =>
    usableChat.find((m) => !exclude.has(m.id) && predicate(m));
  const sampleIds = new Set<string>();
  const sample: PolzaCatalogModel[] = [];
  const add = (model: PolzaCatalogModel | undefined): void => {
    if (!model || sampleIds.has(model.id)) return;
    sampleIds.add(model.id);
    sample.push(model);
  };
  add(pickFirst((m) => supportsTools(m) && supportsReasoning(m), sampleIds));
  add(pickFirst((m) => supportsVision(m), sampleIds));
  add(pickFirst((m) => hasCachePricing(m), sampleIds));
  add(pickFirst((m) => !supportsTools(m), sampleIds));
  add(pickFirst((m) => m.top_provider?.context_length == null, sampleIds));
  add(priced[0]?.model);

  writeFileSync(
    resolve(ARTIFACTS, "catalog-sample.json"),
    JSON.stringify({ note: "Characteristic Polza catalog entries captured by scripts/probe-catalog.ts", models: sample }, null, 2) + "\n",
  );
  console.log(`\nWrote ${sample.length} sample models to artifacts/catalog-sample.json`);
  console.log(`Wrote redacted full dump to artifacts/raw/catalog-full.json (git-ignored)`);
}

main().catch((error) => {
  console.error("probe-catalog failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
