/**
 * Pi eligibility after enrichment.
 *
 * A model becomes eligible only when, after Polza + OpenRouter resolution, Pi's required fields
 * are actually known. No placeholder values (4096, 8192, 1, 999999, ...) are ever fabricated.
 *
 * Ineligible models are NOT deleted from the internal registry — the rejection reasons are kept.
 */
import { CHAT_COMPLETIONS_ENDPOINT } from "../catalog.ts";
import type { EligibilityReason, ResolvedModel } from "./types.ts";
import type { NormalizedPolzaModel } from "./polza.ts";

export interface EligibilityInput {
  polza: NormalizedPolzaModel;
  limits: ResolvedModel["limits"];
  modalities: ResolvedModel["modalities"];
}

export function evaluateEligibility(input: EligibilityInput): { eligible: boolean; reasons: EligibilityReason[] } {
  const reasons: EligibilityReason[] = [];
  const { polza, limits, modalities } = input;

  if (polza.type !== "chat") reasons.push("not_chat_model");

  if (!polza.endpoints.includes(CHAT_COMPLETIONS_ENDPOINT)) reasons.push("no_chat_completions_endpoint");

  const outputModalities = modalities.output.value;
  if (outputModalities === null) {
    reasons.push("missing_output_modalities");
  } else if (outputModalities.length > 0) {
    const hasText = outputModalities.includes("text");
    if (!hasText) {
      if (outputModalities.includes("embeddings")) reasons.push("embeddings_only");
      reasons.push("unsupported_output_modality");
    }
  }

  const inputModalities = modalities.input.value;
  if (inputModalities === null) {
    reasons.push("missing_input_modalities");
  } else if (inputModalities.length > 0 && !inputModalities.includes("text")) {
    // Known capability that Pi cannot represent as a native chat input (e.g. audio-only STT).
    reasons.push("unsupported_input_modality");
  }

  // `unsupported_by_pi` is reserved for a *known* capability that Pi has no representation for
  // at all. It is intentionally not used for unknown metadata (see the missing_* reasons above).

  if (limits.contextWindow.value === null) reasons.push("missing_context_window");
  if (limits.maxCompletionTokens.value === null) reasons.push("missing_max_completion_tokens");

  return { eligible: reasons.length === 0, reasons };
}
