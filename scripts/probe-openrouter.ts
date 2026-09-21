/**
 * Diagnostic probe: OpenRouter public model metadata.
 *
 * OpenRouter is used ONLY as an enrichment source for technical capabilities. Its pricing is
 * captured for reference/diagnostics only and never used for Polza billing.
 *
 * Run: npm run probe:openrouter
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PROJECT_ROOT } from "../.pi/extensions/pi-polza/env.ts";
import { fetchOpenRouterModels, normalizeOpenRouterModel } from "../.pi/extensions/pi-polza/metadata/openrouter.ts";
import { redactJson } from "../.pi/extensions/pi-polza/http.ts";

const ARTIFACTS = resolve(PROJECT_ROOT, "artifacts");
const RAW_DIR = resolve(ARTIFACTS, "raw");

const SAMPLE_IDS = [
  "google/gemini-2.5-flash",
  "google/gemini-2.5-pro",
  "openai/gpt-5.2",
  "moonshotai/kimi-k2-thinking",
  "anthropic/claude-3-haiku",
  "openai/gpt-5-nano",
];

async function main(): Promise<void> {
  const { models, totalCount } = await fetchOpenRouterModels();
  console.log(`OpenRouter models: ${models.length} (total_count=${totalCount ?? "?"})`);
  const first = models[0];
  if (first) console.log("Sample top-level keys: " + Object.keys(first).join(", "));

  const withContext = models.filter((m) => (typeof m.context_length === "number" && m.context_length > 0) || (typeof m.top_provider?.context_length === "number" && m.top_provider.context_length > 0));
  const withMaxOut = models.filter((m) => typeof m.top_provider?.max_completion_tokens === "number" && m.top_provider.max_completion_tokens > 0);
  const withParams = models.filter((m) => Array.isArray(m.supported_parameters));
  console.log(`  with context_length:        ${withContext.length}`);
  console.log(`  with max_completion_tokens: ${withMaxOut.length}`);
  console.log(`  with supported_parameters:  ${withParams.length}`);

  const byId = new Map(models.map((m) => [m.id, m]));
  console.log("\nRequested sample ids:");
  for (const id of SAMPLE_IDS) {
    console.log(`  ${id}: ${byId.has(id) ? "present" : "NOT FOUND"}`);
  }

  mkdirSync(RAW_DIR, { recursive: true });
  writeFileSync(resolve(RAW_DIR, "openrouter-full.json"), JSON.stringify(redactJson({ models, totalCount }), null, 2) + "\n");

  const sample = SAMPLE_IDS.map((id) => byId.get(id)).filter((m): m is NonNullable<typeof m> => Boolean(m));
  if (sample.length < 4) {
    for (const model of models.slice(0, 6)) if (!sample.includes(model)) sample.push(model);
  }
  writeFileSync(
    resolve(ARTIFACTS, "openrouter-sample.json"),
    JSON.stringify({ note: "OpenRouter metadata samples captured by scripts/probe-openrouter.ts", models: sample }, null, 2) + "\n",
  );
  console.log(`\nWrote ${sample.length} sample models to artifacts/openrouter-sample.json`);
  console.log("Wrote redacted full dump to artifacts/raw/openrouter-full.json (git-ignored)");

  const normalized = sample.map(normalizeOpenRouterModel);
  console.log("\nNormalized sample (technical fields only):");
  for (const m of normalized) {
    console.log(
      `  ${m.id}: ctx=${m.contextWindow ?? "null"} maxOut=${m.maxCompletionTokens ?? "null"} in=[${m.inputModalities.join(",")}] out=[${m.outputModalities.join(",")}] tools=${m.supportsTools} reasoning=${m.supportsReasoning}`,
    );
  }
}

main().catch((error) => {
  console.error("probe-openrouter failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
