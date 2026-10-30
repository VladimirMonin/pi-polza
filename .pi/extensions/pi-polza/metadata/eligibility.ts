/**
 * Pi eligibility after enrichment.
 *
 * A model becomes eligible unless Pi provably cannot represent it: it is not a chat model, it has
 * no chat-completions endpoint, its context window is unknown, or its KNOWN modalities exclude text.
 *
 * Unknown is never treated as a negative (see `instructions/project-rules.md` §1): a missing
 * output limit or missing modality data does NOT hide the model. The output limit falls back to the
 * context window in the mapper (a physical ceiling, not a guess), and a chat model with unknown
 * input modalities is offered as text — the only input Pi can send for such a model anyway.
 *
 * No placeholder values (4096, 8192, 1, 999999, ...) are ever fabricated.
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

  // Only a KNOWN non-text output is a rejection: embeddings-only models and friends.
  const outputModalities = modalities.output.value;
  if (outputModalities !== null && outputModalities.length > 0 && !outputModalities.includes("text")) {
    if (outputModalities.includes("embeddings")) reasons.push("embeddings_only");
    reasons.push("unsupported_output_modality");
  }

  const inputModalities = modalities.input.value;
  if (inputModalities !== null && inputModalities.length > 0 && !inputModalities.includes("text")) {
    // Known capability that Pi cannot represent as a native chat input (e.g. audio-only STT).
    reasons.push("unsupported_input_modality");
  }

  // `unsupported_by_pi` is reserved for a *known* capability that Pi has no representation for
  // at all. It is intentionally not used for unknown metadata.

  // Pi cannot represent a model without a context window at all; that is the only limit that still
  // hides a model. A missing output limit is not a reason to hide it — the mapper bounds it by the
  // context window instead (`mapper.ts`).
  if (limits.contextWindow.value === null) reasons.push("missing_context_window");

  return { eligible: reasons.length === 0, reasons };
}
