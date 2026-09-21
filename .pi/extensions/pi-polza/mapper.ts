/**
 * Mapper: ResolvedModel → Pi ProviderModelConfig.
 *
 * Rules (ТЗ v2 §5, §10, §11, §14):
 *  - Only eligible models are projected, and NEVER with placeholder values.
 *  - Pi native input is limited to `text`/`image`. audio/video/file stay in internal metadata.
 *  - `cost` MUST be USD / 1M tokens in Pi. Polza prices are RUB, so they are NEVER written there.
 *    The safe technical representation is zeros; actual billed cost is `usage.cost_rub` (native
 *    RUB) and catalog RUB prices live in the internal registry / `/polza-model-info`.
 *  - `reasoning` is only true when metadata declares it.
 */
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import type { ResolvedModel } from "./metadata/types.ts";

export type PiInputModality = "text" | "image";

/**
 * Explanation of the zero-cost choice, kept next to the code so it is never mistaken for "free".
 */
export const PI_COST_POLICY =
  "Pi cost is intentionally left at 0 (USD/1M): Polza catalog prices are RUB and must never be " +
  "written into Pi's USD cost. Actual billed cost is usage.cost_rub (native RUB). Never treat " +
  "these zeros as 'free'.";

/** Map resolved input modalities to Pi-native modalities. Returns null when nothing is mappable. */
export function mapInputModalitiesToPi(inputModalities: string[] | null): PiInputModality[] | null {
  if (!inputModalities) return null;
  const mapped: PiInputModality[] = [];
  if (inputModalities.includes("text")) mapped.push("text");
  if (inputModalities.includes("image")) mapped.push("image");
  return mapped.length > 0 ? mapped : null;
}

/**
 * Project a resolved model to Pi's config. Returns null when the model is not eligible or a
 * required Pi field cannot be established from real metadata.
 */
export function toProviderModelConfig(model: ResolvedModel): ProviderModelConfig | null {
  if (!model.piEligibility.eligible) return null;

  const contextWindow = model.limits.contextWindow.value;
  const maxTokens = model.limits.maxCompletionTokens.value;
  const input = mapInputModalitiesToPi(model.modalities.input.value);
  if (contextWindow === null || maxTokens === null || input === null) return null;

  return {
    id: model.id,
    name: model.name,
    reasoning: model.capabilities.reasoning.value === true,
    input,
    // See PI_COST_POLICY. RUB is never placed here.
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow,
    maxTokens,
  };
}

export function toProviderModelConfigs(models: ResolvedModel[]): ProviderModelConfig[] {
  const out: ProviderModelConfig[] = [];
  for (const model of models) {
    const config = toProviderModelConfig(model);
    if (config) out.push(config);
  }
  return out;
}

/** Internal capability view kept alongside the Pi model (not representable in Pi's schema). */
export interface InternalModelCapabilities {
  tools: boolean | null;
  toolChoice: boolean | null;
  structuredOutputs: boolean | null;
  responseFormat: boolean | null;
  /** Modalities the underlying model understands but Pi cannot send natively. */
  internalInputModalities: string[];
  reasoningEffort: boolean | null;
}

export function extractInternalCapabilities(model: ResolvedModel): InternalModelCapabilities {
  const input = model.modalities.input.value ?? [];
  return {
    tools: model.capabilities.tools.value,
    toolChoice: model.capabilities.toolChoice.value,
    structuredOutputs: model.capabilities.structuredOutputs.value,
    responseFormat: model.capabilities.responseFormat.value,
    internalInputModalities: input.filter((m) => m !== "text" && m !== "image"),
    reasoningEffort: model.capabilities.reasoningEffort.value,
  };
}
