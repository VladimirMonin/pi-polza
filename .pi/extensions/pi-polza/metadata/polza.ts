/**
 * Normalization of a raw Polza catalog entry into a source-neutral shape.
 *
 * Unknown values stay `null` — never guessed.
 *
 * IMPORTANT capability nuance (observed live): Polza frequently ships a sparse
 * `supported_parameters` list — e.g. `["max_tokens"]` — even for models that clearly support
 * tools/reasoning (google/gemini-2.5-flash, openai/gpt-5.2, ...). A missing entry is therefore
 * treated as UNKNOWN, not as an authoritative "no". Only a *listed* parameter yields `true`;
 * OpenRouter is then used to fill the negative/positive where Polza is silent.
 */
import { toNumber } from "../catalog.ts";
import type { PolzaCatalogModel } from "../types.ts";

export interface NormalizedPolzaPricing {
  currency: string | null;
  promptPerMillion: number | null;
  completionPerMillion: number | null;
  cacheReadPerMillion: number | null;
  cacheWritePerMillion: number | null;
}

export interface NormalizedPolzaModel {
  id: string;
  name: string;
  type: string | null;
  endpoints: string[];
  inputModalities: string[];
  outputModalities: string[];
  contextWindow: number | null;
  maxCompletionTokens: number | null;
  supportedParameters: string[];
  supportsTools: boolean | null;
  supportsToolChoice: boolean | null;
  supportsReasoning: boolean | null;
  supportsReasoningEffort: boolean | null;
  supportsIncludeReasoning: boolean | null;
  supportsStructuredOutputs: boolean | null;
  supportsResponseFormat: boolean | null;
  pricing: NormalizedPolzaPricing;
  raw: PolzaCatalogModel;
}

function positiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.floor(value);
  return null;
}

export function normalizePolzaModel(raw: PolzaCatalogModel): NormalizedPolzaModel {
  const params = Array.isArray(raw.top_provider?.supported_parameters)
    ? raw.top_provider!.supported_parameters!
    : null;
  const has = (name: string): boolean => params?.includes(name) ?? false;
  // Polza lists are sparse and unreliable for negatives -> absence means unknown, not false.
  const cap = (name: string): boolean | null => (params === null ? null : has(name) ? true : null);

  const pricing = raw.top_provider?.pricing ?? null;

  return {
    id: raw.id,
    name: typeof raw.name === "string" && raw.name ? raw.name : raw.id,
    type: typeof raw.type === "string" ? raw.type : null,
    endpoints: Array.isArray(raw.endpoints) ? raw.endpoints : [],
    inputModalities: Array.isArray(raw.architecture?.input_modalities)
      ? raw.architecture!.input_modalities!
      : [],
    outputModalities: Array.isArray(raw.architecture?.output_modalities)
      ? raw.architecture!.output_modalities!
      : [],
    contextWindow: positiveInt(raw.top_provider?.context_length),
    maxCompletionTokens: positiveInt(raw.top_provider?.max_completion_tokens),
    supportedParameters: params ?? [],
    supportsTools: cap("tools"),
    supportsToolChoice: cap("tool_choice"),
    supportsReasoning: cap("reasoning"),
    supportsReasoningEffort: cap("reasoning_effort"),
    supportsIncludeReasoning: cap("include_reasoning"),
    supportsStructuredOutputs: cap("structured_outputs"),
    supportsResponseFormat: cap("response_format"),
    pricing: {
      currency: typeof pricing?.currency === "string" ? pricing.currency : null,
      promptPerMillion: toNumber(pricing?.prompt_per_million) ?? null,
      completionPerMillion: toNumber(pricing?.completion_per_million) ?? null,
      cacheReadPerMillion: toNumber(pricing?.input_cache_read_per_million) ?? null,
      cacheWritePerMillion: toNumber(pricing?.input_cache_write_per_million) ?? null,
    },
    raw,
  };
}
