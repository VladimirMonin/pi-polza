/**
 * Diagnostic probe: analyse the Polza↔OpenRouter metadata conflicts (ТЗ §20).
 *
 * Read-only; uses the local OpenRouter cache when available (no enrichment spend).
 *
 * Run: npm run probe:conflicts
 */
import { loadDotEnv } from "../.pi/extensions/pi-polza/env.ts";
import { buildPolzaCatalog } from "../.pi/extensions/pi-polza/provider.ts";
import type { MetadataConflict } from "../.pi/extensions/pi-polza/metadata/conflicts.ts";
import type { ResolvedModel } from "../.pi/extensions/pi-polza/metadata/types.ts";

type Pattern = { pattern: string; count: number; examples: string[] };

const buckets = new Map<string, Pattern>();

function record(pattern: string, example: string): void {
  const entry = buckets.get(pattern) ?? { pattern, count: 0, examples: [] };
  entry.count += 1;
  if (entry.examples.length < 4) entry.examples.push(example);
  buckets.set(pattern, entry);
}

function ratio(a: number, b: number): string {
  const r = a / b;
  if (Math.abs(r - 2) < 0.15) return "≈2×";
  if (Math.abs(r - 0.5) < 0.05) return "≈0.5×";
  if (r > 4 || r < 0.25) return ">4×";
  return `${r.toFixed(2)}×`;
}

function nearEqual(a: number, b: number): boolean {
  const high = Math.max(a, b);
  return high > 0 && Math.abs(a - b) / high < 0.05;
}

function contextPattern(polza: number, openrouter: number): string {
  if (nearEqual(polza, openrouter)) return "context: effectively equal (<5% — rounding / different definition)";
  return polza > openrouter ? `context: Polza larger (${ratio(polza, openrouter)})` : `context: OpenRouter larger (${ratio(openrouter, polza)})`;
}

function maxOutPattern(polza: number, openrouter: number): string {
  if (nearEqual(polza, openrouter)) return "maxOut: effectively equal (<5% — rounding / different definition)";
  return polza > openrouter ? `maxOut: Polza larger (${ratio(polza, openrouter)})` : `maxOut: OpenRouter larger (${ratio(openrouter, polza)})`;
}

function classify(model: ResolvedModel, conflict: MetadataConflict): void {
  const { field, polza, openrouter } = conflict;
  const short = model.id;

  if (field === "contextWindow" && typeof polza === "number" && typeof openrouter === "number") {
    record(contextPattern(polza, openrouter), `${short} polza=${polza} or=${openrouter}`);
    return;
  }
  if (field === "maxCompletionTokens" && typeof polza === "number" && typeof openrouter === "number") {
    record(maxOutPattern(polza, openrouter), `${short} polza=${polza} or=${openrouter}`);
    return;
  }
  if (field.startsWith("input") || field.startsWith("output")) {
    const p = Array.isArray(polza) ? (polza as string[]).join(",") : String(polza);
    const o = Array.isArray(openrouter) ? (openrouter as string[]).join(",") : String(openrouter);
    const pSet = new Set(Array.isArray(polza) ? (polza as string[]) : []);
    const oSet = new Set(Array.isArray(openrouter) ? (openrouter as string[]) : []);
    const orExtra = [...oSet].filter((m) => !pSet.has(m));
    const polzaExtra = [...pSet].filter((m) => !oSet.has(m));
    let pattern = `${field}: sets differ`;
    if (orExtra.length > 0 && polzaExtra.length === 0) pattern = `${field}: OpenRouter has extra (${orExtra.join("/")})`;
    else if (polzaExtra.length > 0 && orExtra.length === 0) pattern = `${field}: Polza has extra (${polzaExtra.join("/")})`;
    else pattern = `${field}: both differ`;
    record(pattern, `${short} polza=[${p}] or=[${o}]`);
    return;
  }
  if (field.startsWith("supports")) {
    const pattern = `capability ${field}: Polza=${String(polza)} OpenRouter=${String(openrouter)}`;
    record(pattern, short);
    return;
  }
  record(`other ${field}`, short);
}

async function main(): Promise<void> {
  loadDotEnv();
  const build = await buildPolzaCatalog({ openRouter: "cache-first" });
  const withConflicts = build.resolved.filter((m) => m.conflicts.length > 0);
  const allConflicts = build.resolved.flatMap((m) => m.conflicts);

  console.log(`OpenRouter source: ${build.openRouterSource}`);
  console.log(`Models with conflicts: ${withConflicts.length} / ${build.resolved.length}`);
  console.log(`Conflict entries: ${allConflicts.length}\n`);

  for (const model of withConflicts) for (const conflict of model.conflicts) classify(model, conflict);

  const sorted = [...buckets.values()].sort((a, b) => b.count - a.count);
  for (const bucket of sorted) {
    console.log(`${String(bucket.count).padStart(4)}  ${bucket.pattern}`);
    for (const example of bucket.examples) console.log(`        e.g. ${example}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
