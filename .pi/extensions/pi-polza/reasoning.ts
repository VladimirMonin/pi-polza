/**
 * Reasoning verification evidence.
 *
 * Two hard rules learned from live probes (2026-09):
 *
 * 1. `reasoning_tokens === 0` is NOT proof that reasoning is off. Claude and Gemini produced
 *    step-by-step reasoning **inside `content`** with `reasoning_tokens: 0` and no reasoning field.
 *    So absence of telemetry ≠ absence of reasoning.
 * 2. A single prompt with a differing token count does NOT prove level control. Natural variance is
 *    large; `levelControlVerified` requires a repeatable effect on standardized repeated requests.
 *
 * The evidence therefore separates independent properties, and unknown is `null`, never a guessed
 * `false` (ТЗ §15, corrected):
 *
 *   declared                 metadata says the model supports reasoning
 *   requestSupported         the API accepted our reasoning parameter (no error)
 *   reasoningPayloadObserved a provider reasoning payload/field was actually seen
 *   inlineReasoningObserved  reasoning-like content appeared inside `message.content`
 *   usageReported            reasoning_tokens > 0 was observed
 *   levelControlVerified     changing the level demonstrably changed reasoning (repeatable)
 *   offVerified              off/none demonstrably disabled reasoning (positive proof only)
 *
 * `offVerified = true` requires a channel that demonstrably reports reasoning (usageReported) AND
 * zero on that channel for off AND no inline reasoning. Otherwise it stays `null` or `false`.
 */

export interface ReasoningVerification {
  declared: boolean | null;
  requestSupported: boolean | null;
  /** A provider reasoning payload/field was actually observed. */
  reasoningPayloadObserved: boolean | null;
  /** Reasoning-like working appeared inline in `message.content`. */
  inlineReasoningObserved: boolean | null;
  usageReported: boolean | null;
  levelControlVerified: boolean | null;
  offVerified: boolean | null;
  offBehavior: "disabled" | "still-reasoning" | "unverified";
  /** Which payload fields carried reasoning, when we saw any. */
  observedReasoningFields: string[];
  source: "live-probe" | "none";
  checkedAt: string | null;
  notes?: string;
}

/** Aggregate view: did we observe reasoning anywhere (payload or inline)? null when unknown. */
export function reasoningObserved(evidence: ReasoningVerification): boolean | null {
  const payload = evidence.reasoningPayloadObserved;
  const inline = evidence.inlineReasoningObserved;
  if (payload === true || inline === true) return true;
  if (payload === null || inline === null) return null;
  return false;
}

const UNVERIFIED: ReasoningVerification = {
  declared: null,
  requestSupported: null,
  reasoningPayloadObserved: null,
  inlineReasoningObserved: null,
  usageReported: null,
  levelControlVerified: null,
  offVerified: null,
  offBehavior: "unverified",
  observedReasoningFields: [],
  source: "none",
  checkedAt: null,
};

/**
 * Exact-model-id results from live probes. Only models we actually hit are listed; everything else
 * is `unverified`. No family-wide assumption is encoded here.
 */
export const VERIFIED_REASONING: Record<string, ReasoningVerification> = {
  "openai/gpt-oss-20b": {
    declared: true,
    requestSupported: true,
    reasoningPayloadObserved: true,
    inlineReasoningObserved: null,
    usageReported: true,
    levelControlVerified: null,
    offVerified: false,
    offBehavior: "still-reasoning",
    observedReasoningFields: ["usage.completion_tokens_details.reasoning_tokens"],
    source: "live-probe",
    checkedAt: "2026-09-21",
    notes: "Reasoned with no reasoning_effort and with \"none\"; token counts were flat/non-monotonic → level control unverified.",
  },
  "deepseek/deepseek-r1-distill-llama-70b": {
    declared: true,
    requestSupported: true,
    reasoningPayloadObserved: true,
    inlineReasoningObserved: null,
    usageReported: true,
    levelControlVerified: null,
    offVerified: false,
    offBehavior: "still-reasoning",
    observedReasoningFields: ["message.reasoning", "usage.completion_tokens_details.reasoning_tokens"],
    source: "live-probe",
    checkedAt: "2026-09-21",
    notes: "Reasoned with no field and with \"none\"; ~190 tokens at every level → level control unverified.",
  },
  "anthropic/claude-haiku-4.5": {
    declared: true,
    requestSupported: true,
    reasoningPayloadObserved: false,
    inlineReasoningObserved: true,
    usageReported: false,
    levelControlVerified: null,
    offVerified: null,
    offBehavior: "unverified",
    observedReasoningFields: ["choices[].message.content (inline step-by-step)"],
    source: "live-probe",
    checkedAt: "2026-09-21",
    notes: "reasoning_tokens was 0 for every effort, but content contained explicit reasoning steps → telemetry absent, off not provable.",
  },
  "google/gemini-2.5-flash-lite": {
    declared: true,
    requestSupported: true,
    reasoningPayloadObserved: false,
    inlineReasoningObserved: true,
    usageReported: false,
    levelControlVerified: null,
    offVerified: null,
    offBehavior: "unverified",
    observedReasoningFields: ["choices[].message.content (inline step-by-step)"],
    source: "live-probe",
    checkedAt: "2026-09-21",
    notes: "reasoning_tokens was 0 for every effort including \"none\"; content had multi-method working.",
  },
  "qwen/qwen3.5-9b": {
    declared: true,
    requestSupported: true,
    reasoningPayloadObserved: false,
    inlineReasoningObserved: false,
    usageReported: false,
    levelControlVerified: null,
    offVerified: null,
    offBehavior: "unverified",
    observedReasoningFields: [],
    source: "live-probe",
    checkedAt: "2026-09-21",
    notes: "No reasoning field, no usage counter and no inline working observed — absence of observation, not proof of absence.",
  },
};

export function reasoningVerificationFor(modelId: string): ReasoningVerification {
  return VERIFIED_REASONING[modelId] ?? UNVERIFIED;
}

/**
 * Policy (ТЗ §17): do not author a `thinkingLevelMap` until level control is verified for that
 * exact model. Without a map Pi transports the raw Pi level name (e.g. `"high"`), which Polza
 * accepts — that state is "transport accepts / mapping unverified", NOT "mapped".
 */
export function resolveThinkingLevelMap(evidence: ReasoningVerification): Record<string, string | null> | undefined {
  if (evidence.levelControlVerified !== true) return undefined;
  return undefined; // no model has passed repeatable level-control verification yet
}

/** Compact multi-line report for `/polza-model-info`. */
export function describeReasoning(evidence: ReasoningVerification): string[] {
  if (evidence.source === "none") {
    return ["Reasoning: declared by metadata only", "Levels:    not verified"];
  }
  const state = (value: boolean | null): string => (value === null ? "unverified" : value ? "yes" : "no");
  return [
    `Reasoning: declared: ${state(evidence.declared)}, request accepted: ${state(evidence.requestSupported)}`,
    `           payload observed: ${state(evidence.reasoningPayloadObserved)}, inline observed: ${state(evidence.inlineReasoningObserved)}, usage counter: ${state(evidence.usageReported)}`,
    `           level control: ${state(evidence.levelControlVerified)}, off disables: ${state(evidence.offVerified)} (${evidence.offBehavior})`,
    evidence.observedReasoningFields.length > 0 ? `           observed in: ${evidence.observedReasoningFields.join(", ")}` : "           observed in: nothing",
    `           checked: ${evidence.checkedAt ?? "never"} (source: ${evidence.source})`,
  ];
}
