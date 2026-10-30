/**
 * Thinking-level mapping derived from the Polza catalog.
 *
 * This module answers one narrow question: which reasoning levels does Polza DECLARE for a model,
 * and how must Pi name them on the wire? A map built here is a statement about the CATALOG, not a
 * proof that a level has any effect. The verification policy in `reasoning.ts` stays in force: the
 * UI still labels level control "not verified", and an unknown gateway vocabulary produces a refusal
 * (a hidden level), never a silent substitution of behaviour.
 *
 * Two catalog surfaces are read, most-specific first:
 *  1. `top_provider.reasoning.supported_efforts` / top-level `reasoning.supported_efforts` — the
 *     published allow-list. Only here can `xhigh`/`max` be offered on published data, and every level
 *     the list omits is hidden (`null`) rather than guessed.
 *  2. `supported_parameters` containing `reasoning_effort` — the control is declared but the accepted
 *     values are not, so Pi level names are passed through unchanged. `off` is hidden because the
 *     catalog never confirms that `off` disables reasoning.
 */

export type PiThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type ThinkingLevelMap = Partial<Record<PiThinkingLevel, string | null>>;

/** Pi levels, in Pi's own ascending order. */
export const PI_THINKING_LEVELS: readonly PiThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/**
 * Values Polza is known to publish in `supported_efforts`. `off` is accepted too because the
 * allow-list is the authority for the off mapping (see `resolveThinkingLevelMap`).
 */
const KNOWN_EFFORTS = new Set(["none", "off", "minimal", "low", "medium", "high", "xhigh", "max"]);

/**
 * Normalize a raw `supported_efforts` value: keep strings, lowercase, drop empty/unknown entries,
 * deduplicate in first-seen order. An empty result is `null` — an unreadable list is unknown, not an
 * empty allow-list.
 */
export function normalizeSupportedEfforts(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const normalized = entry.trim().toLowerCase();
    if (!normalized || !KNOWN_EFFORTS.has(normalized)) continue;
    if (!out.includes(normalized)) out.push(normalized);
  }
  return out.length > 0 ? out : null;
}

export interface ThinkingLevelInput {
  /** The resolved reasoning capability. A non-reasoning model never gets a map. */
  reasoning: boolean;
  /** `supported_parameters` includes `reasoning_effort`. */
  controlDeclared: boolean;
  /** Normalized published allow-list, or `null` when Polza does not publish one. */
  supportedEfforts: string[] | null;
}

/**
 * Build the Pi `thinkingLevelMap` for a model.
 *
 * Returns `undefined` when there is nothing to declare (non-reasoning, or neither a published
 * allow-list nor a declared `reasoning_effort` control). When a map is returned it covers every Pi
 * level explicitly: a level absent from the published list is `null` (hidden), never a guessed value.
 */
export function resolveThinkingLevelMap(input: ThinkingLevelInput): ThinkingLevelMap | undefined {
  if (!input.reasoning) return undefined;

  if (input.supportedEfforts !== null) {
    const efforts = new Set(input.supportedEfforts);
    const map: ThinkingLevelMap = {};
    for (const level of PI_THINKING_LEVELS) {
      if (level === "off") {
        // `off` is the Pi level that switches reasoning off; the catalog names it `none` (or `off`).
        map.off = efforts.has("none") ? "none" : efforts.has("off") ? "off" : null;
        continue;
      }
      map[level] = efforts.has(level) ? level : null;
    }
    return map;
  }

  if (input.controlDeclared) {
    // The control is declared but its vocabulary is not: Pi level names pass through unchanged.
    // `off` stays hidden — the catalog never confirms it disables reasoning.
    return {
      off: null,
      minimal: "minimal",
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: "max",
    };
  }

  return undefined;
}
