/**
 * Verified, surgical model overrides.
 *
 * An override is ONLY justified when real evidence (live probe / official vendor source) contradicts
 * what the pipeline resolved. Rules (ТЗ §22):
 *
 *  - one entry = ONE model id + ONE field (never a copied catalog row),
 *  - every entry carries `reason`, `source` and `verifiedAt`,
 *  - priority is `override → Polza → OpenRouter → unknown` (resolver enforces this).
 *
 * Keep this list short and factual. If it grows, that is a signal the pipeline itself is wrong.
 */
import type { ResolveOverrides } from "../metadata/resolver.ts";

export const OVERRIDE_FIELDS = [
  "contextWindow",
  "maxCompletionTokens",
  "inputModalities",
  "outputModalities",
  "supportsTools",
  "supportsToolChoice",
  "supportsReasoning",
  "supportsReasoningEffort",
] as const;

export type OverrideField = (typeof OVERRIDE_FIELDS)[number];

export interface ModelOverride {
  modelId: string;
  field: OverrideField;
  value: number | string[] | boolean;
  /** Why this override exists (the observed wrong behaviour). */
  reason: string;
  /** Where the correct value came from (official docs, live probe, etc.). */
  source: string;
  /** ISO date of the verification. */
  verifiedAt: string;
}

/** Populated only when a concrete model is proven wrong. Currently empty by design. */
export const MODEL_OVERRIDES: readonly ModelOverride[] = [];

const FIELD_TO_KEY: Record<OverrideField, keyof ResolveOverrides> = {
  contextWindow: "contextWindow",
  maxCompletionTokens: "maxCompletionTokens",
  inputModalities: "inputModalities",
  outputModalities: "outputModalities",
  supportsTools: "supportsTools",
  supportsToolChoice: "supportsToolChoice",
  supportsReasoning: "supportsReasoning",
  supportsReasoningEffort: "supportsReasoningEffort",
};

/** Returns human-readable problems; empty means valid. */
export function validateOverrides(list: readonly ModelOverride[]): string[] {
  const errors: string[] = [];
  list.forEach((entry, index) => {
    const at = `#${index} (${entry.modelId || "?"})`;
    if (!entry.modelId?.trim()) errors.push(`${at}: missing modelId`);
    if (!(OVERRIDE_FIELDS as readonly string[]).includes(entry.field)) errors.push(`${at}: invalid field "${entry.field}"`);
    if (entry.value === undefined || entry.value === null) errors.push(`${at}: missing value`);
    if (!entry.reason?.trim()) errors.push(`${at}: missing reason`);
    if (!entry.source?.trim()) errors.push(`${at}: missing source`);
    if (!entry.verifiedAt?.trim()) errors.push(`${at}: missing verifiedAt`);
  });
  return errors;
}

/** Group overrides by model id into resolver-ready objects. */
export function buildOverrideMap(list: readonly ModelOverride[] = MODEL_OVERRIDES): Map<string, ResolveOverrides> {
  const map = new Map<string, ResolveOverrides>();
  for (const entry of list) {
    const target = map.get(entry.modelId) ?? {};
    (target as Record<string, unknown>)[FIELD_TO_KEY[entry.field]] = entry.value;
    map.set(entry.modelId, target);
  }
  return map;
}

/** All override entries for one model (for `/polza-model-info` explanations). */
export function overridesFor(modelId: string, list: readonly ModelOverride[] = MODEL_OVERRIDES): ModelOverride[] {
  return list.filter((entry) => entry.modelId === modelId);
}
