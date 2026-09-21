/**
 * Metadata resolver: merge Polza (authoritative) with OpenRouter (enrichment) into a ResolvedModel.
 *
 * Priority per field: explicit verified override → Polza → OpenRouter → unknown.
 * Overrides are surgical (per model id + per field), documented and test-covered; they are NOT a
 * bulk metadata source. When Polza and OpenRouter both provide different concrete values, Polza
 * wins and the conflict is recorded — even if an override is what is ultimately returned.
 */
import { normalizePolzaModel, type NormalizedPolzaModel } from "./polza.ts";
import { normalizeOpenRouterModel, type OpenRouterModel } from "./openrouter.ts";
import { fromOverride, fromPolza, fromOpenRouter, unknown, type Provenanced } from "./provenance.ts";
import { resolveWithConflict, type MetadataConflict } from "./conflicts.ts";
import { evaluateEligibility } from "./eligibility.ts";
import type { ResolvedModel } from "./types.ts";
import type { PolzaCatalogModel } from "../types.ts";

export interface ResolveOverrides {
  contextWindow?: number | null;
  maxCompletionTokens?: number | null;
  inputModalities?: string[] | null;
  outputModalities?: string[] | null;
  supportsTools?: boolean | null;
  supportsToolChoice?: boolean | null;
  supportsReasoning?: boolean | null;
  supportsReasoningEffort?: boolean | null;
}

export interface ResolveOptions {
  /** Surgical verified overrides — highest priority, per field. */
  overrides?: ResolveOverrides;
  /** Set to `true` only after a real tool loop through Polza succeeded. */
  verifiedToolSupport?: boolean | "unknown";
}

/**
 * Resolve one field. Priority: override → Polza → OpenRouter → unknown.
 * Polza/OpenRouter conflicts are still recorded when both are concrete and differ.
 */
function pick<T>(
  field: string,
  polzaValue: T | null,
  openRouterValue: T | null,
  overrideValue: T | null | undefined,
  conflicts: MetadataConflict[],
): Provenanced<T> {
  const merged = resolveWithConflict<T>(field, fromPolza(polzaValue), fromOpenRouter(openRouterValue), conflicts);
  if (overrideValue !== undefined && overrideValue !== null) return fromOverride(overrideValue);
  return merged;
}

export function resolveModel(
  polzaRaw: PolzaCatalogModel,
  openRouterRaw: OpenRouterModel | null | undefined,
  options: ResolveOptions = {},
): ResolvedModel {
  const polza: NormalizedPolzaModel = normalizePolzaModel(polzaRaw);
  const openRouter = openRouterRaw ? normalizeOpenRouterModel(openRouterRaw) : null;
  const overrides = options.overrides ?? {};
  const conflicts: MetadataConflict[] = [];

  const limits = {
    contextWindow: pick("contextWindow", polza.contextWindow, openRouter?.contextWindow ?? null, overrides.contextWindow, conflicts),
    maxCompletionTokens: pick(
      "maxCompletionTokens",
      polza.maxCompletionTokens,
      openRouter?.maxCompletionTokens ?? null,
      overrides.maxCompletionTokens,
      conflicts,
    ),
  };

  const modalities = {
    input: pick(
      "inputModalities",
      polza.inputModalities.length ? polza.inputModalities : null,
      openRouter && openRouter.inputModalities.length ? openRouter.inputModalities : null,
      overrides.inputModalities,
      conflicts,
    ),
    output: pick(
      "outputModalities",
      polza.outputModalities.length ? polza.outputModalities : null,
      openRouter && openRouter.outputModalities.length ? openRouter.outputModalities : null,
      overrides.outputModalities,
      conflicts,
    ),
  };

  const capabilities = {
    tools: pick("supportsTools", polza.supportsTools, openRouter?.supportsTools ?? null, overrides.supportsTools, conflicts),
    toolChoice: pick(
      "supportsToolChoice",
      polza.supportsToolChoice,
      openRouter?.supportsToolChoice ?? null,
      overrides.supportsToolChoice,
      conflicts,
    ),
    reasoning: pick(
      "supportsReasoning",
      polza.supportsReasoning,
      openRouter?.supportsReasoning ?? null,
      overrides.supportsReasoning,
      conflicts,
    ),
    reasoningEffort: pick(
      "supportsReasoningEffort",
      polza.supportsReasoningEffort,
      openRouter?.supportsReasoningEffort ?? null,
      overrides.supportsReasoningEffort,
      conflicts,
    ),
    structuredOutputs: pick(
      "supportsStructuredOutputs",
      polza.supportsStructuredOutputs,
      openRouter?.supportsStructuredOutputs ?? null,
      null,
      conflicts,
    ),
    responseFormat: pick(
      "supportsResponseFormat",
      polza.supportsResponseFormat,
      openRouter?.supportsResponseFormat ?? null,
      null,
      conflicts,
    ),
    vision: unknown<boolean>(),
  };

  // Vision is a projection of the resolved input modalities (source follows those modalities).
  const visionFromModalities = modalities.input.value?.includes("image") ?? null;
  capabilities.vision = { value: visionFromModalities, source: visionFromModalities === null ? "unknown" : modalities.input.source };

  const resolved: ResolvedModel = {
    id: polza.id,
    name: polza.name,
    openRouterId: openRouter?.id ?? null,
    availability: { polza: true },
    limits,
    modalities,
    capabilities,
    declaredToolSupport: capabilities.tools.value === true,
    verifiedToolSupport: options.verifiedToolSupport ?? "unknown",
    pricing: {
      polzaRUB: polza.pricing,
      openRouterReference: openRouter?.referencePricing ?? null,
    },
    conflicts,
    piEligibility: { eligible: false, reasons: [] },
    raw: { polza: polzaRaw, openrouter: openRouterRaw ?? null },
  };

  resolved.piEligibility = evaluateEligibility({ polza, limits, modalities });
  return resolved;
}

/**
 * Resolve a batch. `openRouterById` must be keyed by EXACT id — no fuzzy matching here.
 * (Aliases are resolved before this step, explicitly.)
 */
export function resolveModels(
  polzaModels: PolzaCatalogModel[],
  openRouterById: Map<string, OpenRouterModel>,
  options: ResolveOptions = {},
): ResolvedModel[] {
  return polzaModels.map((model) => resolveModel(model, openRouterById.get(model.id) ?? null, options));
}
