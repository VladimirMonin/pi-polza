/**
 * OpenRouter model metadata — used ONLY as an enrichment source for technical capabilities
 * (limits, modalities, supported parameters).
 *
 * It is never used for Polza availability or billing. OpenRouter pricing is kept only as
 * diagnostic/reference metadata.
 *
 * Endpoint is public (no API key required): https://openrouter.ai/api/v1/models
 */
export const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

export interface OpenRouterArchitecture {
  modality?: string | null;
  input_modalities?: string[] | null;
  output_modalities?: string[] | null;
  tokenizer?: string | null;
  instruct_type?: string | null;
  [key: string]: unknown;
}

export interface OpenRouterTopProvider {
  context_length?: number | null;
  max_completion_tokens?: number | null;
  is_moderated?: boolean | null;
  [key: string]: unknown;
}

export interface OpenRouterReasoning {
  mandatory?: boolean | null;
  default_enabled?: boolean | null;
  supported_efforts?: string[] | null;
  default_effort?: string | null;
  [key: string]: unknown;
}

export interface OpenRouterModel {
  id: string;
  canonical_slug?: string | null;
  hugging_face_id?: string | null;
  name?: string | null;
  created?: number | null;
  description?: string | null;
  context_length?: number | null;
  architecture?: OpenRouterArchitecture | null;
  pricing?: Record<string, string | null> | null;
  top_provider?: OpenRouterTopProvider | null;
  per_request_limits?: unknown;
  supported_parameters?: string[] | null;
  default_parameters?: Record<string, unknown> | null;
  reasoning?: OpenRouterReasoning | null;
  [key: string]: unknown;
}

export interface OpenRouterModelsResponse {
  data: OpenRouterModel[];
  total_count?: number;
  links?: unknown;
}

export interface NormalizedOpenRouterModel {
  id: string;
  canonicalSlug: string | null;
  name: string;
  /** Preferred: top-level context_length, fallback to top_provider.context_length. */
  contextWindow: number | null;
  /** top_provider.max_completion_tokens. */
  maxCompletionTokens: number | null;
  inputModalities: string[];
  outputModalities: string[];
  supportedParameters: string[];
  /** Capability flags are `null` when supported_parameters is absent (unknown), never guessed. */
  supportsTools: boolean | null;
  supportsToolChoice: boolean | null;
  supportsReasoning: boolean | null;
  supportsReasoningEffort: boolean | null;
  supportsIncludeReasoning: boolean | null;
  supportsStructuredOutputs: boolean | null;
  supportsResponseFormat: boolean | null;
  reasoning: OpenRouterReasoning | null;
  /** Diagnostic/reference only — never used for billing. */
  referencePricing: { promptPerToken: number | null; completionPerToken: number | null } | null;
  raw: OpenRouterModel;
}

function positiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.floor(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }
  return null;
}

function numOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export async function fetchOpenRouterModels(signal?: AbortSignal): Promise<{
  models: OpenRouterModel[];
  totalCount: number | null;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("timeout")), 30_000);
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await fetch(OPENROUTER_MODELS_URL, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`OpenRouter models request failed: HTTP ${response.status}`);
    }
    const payload = (await response.json()) as OpenRouterModelsResponse;
    const models = Array.isArray(payload.data) ? payload.data : [];
    return { models, totalCount: typeof payload.total_count === "number" ? payload.total_count : null };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}

/** Index models by exact OpenRouter id. */
export function indexOpenRouterById(models: OpenRouterModel[]): Map<string, OpenRouterModel> {
  const map = new Map<string, OpenRouterModel>();
  for (const model of models) map.set(model.id, model);
  return map;
}

export function normalizeOpenRouterModel(raw: OpenRouterModel): NormalizedOpenRouterModel {
  const params = Array.isArray(raw.supported_parameters) ? raw.supported_parameters : null;
  const has = (name: string): boolean => params?.includes(name) ?? false;
  const capability = (name: string): boolean | null => (params === null ? null : has(name));

  const pricing = raw.pricing ?? null;

  return {
    id: raw.id,
    canonicalSlug: typeof raw.canonical_slug === "string" ? raw.canonical_slug : null,
    name: typeof raw.name === "string" && raw.name ? raw.name : raw.id,
    contextWindow: positiveInt(raw.context_length) ?? positiveInt(raw.top_provider?.context_length),
    maxCompletionTokens: positiveInt(raw.top_provider?.max_completion_tokens),
    inputModalities: Array.isArray(raw.architecture?.input_modalities) ? raw.architecture!.input_modalities! : [],
    outputModalities: Array.isArray(raw.architecture?.output_modalities) ? raw.architecture!.output_modalities! : [],
    supportedParameters: params ?? [],
    supportsTools: params === null ? null : has("tools"),
    supportsToolChoice: params === null ? null : has("tool_choice"),
    supportsReasoning: capability("reasoning"),
    supportsReasoningEffort: capability("reasoning_effort"),
    supportsIncludeReasoning: capability("include_reasoning"),
    supportsStructuredOutputs: capability("structured_outputs"),
    supportsResponseFormat: capability("response_format"),
    reasoning: raw.reasoning ?? null,
    referencePricing: pricing
      ? {
          promptPerToken: numOrNull(pricing.prompt),
          completionPerToken: numOrNull(pricing.completion),
        }
      : null,
    raw,
  };
}
