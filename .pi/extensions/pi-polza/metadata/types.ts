/**
 * Shared types for the metadata resolution pipeline.
 *
 * Polza catalog → NormalizedPolzaModel → (+ OpenRouter enrichment) → ResolvedModel →
 * Pi eligibility → Pi ProviderModelConfig.
 */
import type { Provenanced } from "./provenance.ts";
import type { MetadataConflict } from "./conflicts.ts";
import type { PolzaCatalogModel } from "../types.ts";
import type { OpenRouterModel } from "./openrouter.ts";

export type { MetadataSource, Provenanced } from "./provenance.ts";
export type { MetadataConflict } from "./conflicts.ts";

export interface PolzaPricingRUB {
  currency: string | null;
  promptPerMillion: number | null;
  completionPerMillion: number | null;
  cacheReadPerMillion: number | null;
  cacheWritePerMillion: number | null;
}

export interface OpenRouterReferencePricing {
  promptPerToken: number | null;
  completionPerToken: number | null;
}

export interface ResolvedPricing {
  /**
   * Polza catalog price in native RUB. Authoritative for *estimate/reference* only;
   * the actual billed cost is always `usage.cost_rub` at runtime.
   */
  polzaRUB: PolzaPricingRUB;
  /** Diagnostic reference only. Never used for billing. */
  openRouterReference: OpenRouterReferencePricing | null;
}

export type EligibilityReason =
  | "missing_context_window"
  | "missing_max_completion_tokens"
  | "missing_input_modalities"
  | "missing_output_modalities"
  | "unsupported_input_modality"
  | "unsupported_output_modality"
  | "not_chat_model"
  | "embeddings_only"
  | "no_chat_completions_endpoint"
  | "unsupported_by_pi";

export interface PiEligibility {
  eligible: boolean;
  reasons: EligibilityReason[];
}

export interface ResolvedModel {
  id: string;
  name: string;
  openRouterId: string | null;
  availability: { polza: boolean };

  limits: {
    contextWindow: Provenanced<number>;
    maxCompletionTokens: Provenanced<number>;
  };

  modalities: {
    input: Provenanced<string[]>;
    output: Provenanced<string[]>;
  };

  capabilities: {
    vision: Provenanced<boolean>;
    tools: Provenanced<boolean>;
    toolChoice: Provenanced<boolean>;
    reasoning: Provenanced<boolean>;
    reasoningEffort: Provenanced<boolean>;
    structuredOutputs: Provenanced<boolean>;
    responseFormat: Provenanced<boolean>;
  };

  /** Declared by metadata. */
  declaredToolSupport: boolean;
  /** Only becomes true after a real tool loop through Polza. */
  verifiedToolSupport: boolean | "unknown";

  pricing: ResolvedPricing;

  conflicts: MetadataConflict[];

  piEligibility: PiEligibility;

  raw: {
    polza: PolzaCatalogModel;
    openrouter: OpenRouterModel | null;
  };
}
