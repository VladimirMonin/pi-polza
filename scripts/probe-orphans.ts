/**
 * Diagnostic probe: classify the models that stay incomplete after enrichment (ТЗ §23).
 *
 * Reporting only — it never invents limits and never adds aliases. Uses the local OpenRouter cache.
 *
 * Run: npm run probe:orphans
 */
import { loadDotEnv } from "../.pi/extensions/pi-polza/env.ts";
import { buildPolzaCatalog } from "../.pi/extensions/pi-polza/provider.ts";
import { isUsableChatModel } from "../.pi/extensions/pi-polza/catalog.ts";
import { readOpenRouterCache } from "../.pi/extensions/pi-polza/metadata/openrouter-cache.ts";
import type { OpenRouterModel } from "../.pi/extensions/pi-polza/metadata/openrouter.ts";

function classificationFor(id: string, missingContext: boolean, missingMaxOut: boolean, orMatch: OpenRouterModel | null): string {
  if (orMatch) return `ID renamed? exact name matches OpenRouter id "${orMatch.id}"`;
  const vendor = id.split("/")[0] ?? "";
  if (/gigachat|aiesa|yandex|alice/i.test(id)) return "vendor-exclusive (Russian ecosystem; not on OpenRouter)";
  if (/preview|beta|exp|latest/i.test(id)) return "preview / moving alias (upstream may not publish fixed limits)";
  if (missingContext && !missingMaxOut) return "missing context only (enrichment had no exact OpenRouter id)";
  if (!missingContext && missingMaxOut) return "missing max output only (enrichment had no exact OpenRouter id)";
  return "missing both limits (no exact OpenRouter id)";
}

async function main(): Promise<void> {
  loadDotEnv();
  const build = await buildPolzaCatalog({ openRouter: "cache-first" });
  const cache = readOpenRouterCache();
  const orModels = cache?.models ?? [];

  const byName = new Map<string, OpenRouterModel>();
  for (const model of orModels) {
    if (typeof model.name === "string") byName.set(model.name.toLowerCase(), model);
  }
  const byId = new Map(orModels.map((m) => [m.id, m] as const));
  const byCanonical = new Map<string, OpenRouterModel>();
  for (const model of orModels) {
    if (typeof model.canonical_slug === "string") byCanonical.set(model.canonical_slug, model);
  }

  const orphans = build.resolved.filter(
    (m) =>
      isUsableChatModel(m.raw.polza) &&
      (m.limits.contextWindow.value === null || m.limits.maxCompletionTokens.value === null),
  );

  console.log(`OpenRouter source: ${build.openRouterSource}   orphans: ${orphans.length}\n`);

  const buckets = new Map<string, string[]>();
  for (const model of orphans) {
    const missingContext = model.limits.contextWindow.value === null;
    const missingMaxOut = model.limits.maxCompletionTokens.value === null;
    const orMatch =
      byId.get(model.id) ??
      byCanonical.get(model.id) ??
      byName.get((model.name ?? "").toLowerCase()) ??
      (model.raw.openrouter ? { id: model.raw.openrouter.id, name: model.raw.openrouter.name } as OpenRouterModel : null);
    const reason = classificationFor(model.id, missingContext, missingMaxOut, orMatch);
    const detail = `${model.id}  [name="${model.name}" missing=${[missingContext ? "context" : null, missingMaxOut ? "maxOut" : null].filter(Boolean).join("+")}]`;
    const list = buckets.get(reason) ?? [];
    list.push(detail);
    buckets.set(reason, list);
  }

  for (const [reason, list] of buckets) {
    console.log(`${reason}  (${list.length})`);
    for (const line of list) console.log(`   ${line}`);
    console.log("");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
