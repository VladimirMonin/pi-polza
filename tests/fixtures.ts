/**
 * Small builders for metadata tests. Inline fixtures keep the resolver cases precise;
 * snapshot files are used for integration checks.
 */
import type { PolzaCatalogModel } from "../.pi/extensions/pi-polza/types.ts";
import type { OpenRouterModel } from "../.pi/extensions/pi-polza/metadata/openrouter.ts";

export interface PolzaModelOptions {
  id: string;
  name?: string;
  type?: string;
  endpoints?: string[];
  inputModalities?: string[];
  outputModalities?: string[];
  contextLength?: number | null;
  maxCompletionTokens?: number | null;
  supportedParameters?: string[] | null;
  promptPerMillion?: string | number | null;
  completionPerMillion?: string | number | null;
  cacheReadPerMillion?: string | number | null;
  cacheWritePerMillion?: string | number | null;
  currency?: string | null;
}

export function polzaModel(options: PolzaModelOptions): PolzaCatalogModel {
  return {
    id: options.id,
    name: options.name ?? options.id,
    type: options.type ?? "chat",
    endpoints: options.endpoints ?? ["/api/v1/chat/completions"],
    architecture: {
      input_modalities: options.inputModalities ?? ["text"],
      output_modalities: options.outputModalities ?? ["text"],
    },
    top_provider: {
      context_length: options.contextLength ?? null,
      max_completion_tokens: options.maxCompletionTokens ?? null,
      supported_parameters: options.supportedParameters === undefined ? [] : options.supportedParameters,
      pricing: {
        prompt_per_million: options.promptPerMillion ?? null,
        completion_per_million: options.completionPerMillion ?? null,
        input_cache_read_per_million: options.cacheReadPerMillion ?? null,
        input_cache_write_per_million: options.cacheWritePerMillion ?? null,
        currency: options.currency ?? "RUB",
      },
    },
  };
}

export interface OpenRouterModelOptions {
  id: string;
  name?: string;
  contextLength?: number | null;
  maxCompletionTokens?: number | null;
  inputModalities?: string[];
  outputModalities?: string[];
  supportedParameters?: string[] | null;
  promptPerToken?: string | null;
  completionPerToken?: string | null;
}

export function openRouterModel(options: OpenRouterModelOptions): OpenRouterModel {
  return {
    id: options.id,
    name: options.name ?? options.id,
    context_length: options.contextLength ?? null,
    top_provider: { max_completion_tokens: options.maxCompletionTokens ?? null },
    architecture: {
      input_modalities: options.inputModalities ?? ["text"],
      output_modalities: options.outputModalities ?? ["text"],
    },
    supported_parameters: options.supportedParameters === undefined ? [] : options.supportedParameters,
    pricing: {
      prompt: options.promptPerToken ?? null,
      completion: options.completionPerToken ?? null,
    },
  };
}
