/**
 * Normalization of raw Polza / OpenAI-compatible usage into a counted form.
 *
 * Semantics (to be confirmed against live responses in notes/usage-experiment.md):
 *  - `prompt_tokens` is the FULL input volume.
 *  - `cached_tokens` (cache read) and `cache_write_tokens` are PARTS of that input.
 *  - Therefore uncached input = prompt_tokens - cacheRead - cacheWrite.
 *    Never add `prompt_tokens + cached_tokens` (double counting).
 *  - `completion_tokens` already includes `reasoning_tokens`; reasoning is a detail, not additive.
 *
 * `cost_rub` is Polza's actually-billed per-request cost in native RUB. It is kept separate from
 * Pi's USD cost and is never converted.
 */

export interface RawUsageLike {
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  total_tokens?: unknown;
  cost?: unknown;
  cost_rub?: unknown;
  cost_usd?: unknown;
  currency?: unknown;
  cached_tokens?: unknown;
  cache_write_tokens?: unknown;
  prompt_tokens_details?: {
    cached_tokens?: unknown;
    cache_write_tokens?: unknown;
    cache_creation_tokens?: unknown;
    [key: string]: unknown;
  } | null;
  completion_tokens_details?: {
    reasoning_tokens?: unknown;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

export interface NormalizedUsage {
  /** Raw prompt_tokens as reported. */
  promptTotal: number;
  /** Uncached input = promptTotal - cacheRead - cacheWrite (clamped at 0). */
  input: number;
  /** completion_tokens as reported (already includes reasoning). */
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Detail of output, not additive. */
  reasoning: number;
  /** input + output + cacheRead + cacheWrite (matches Pi's own accounting). */
  totalTokens: number;
  /** Actually-billed per-request cost in native RUB, when Polza reports it. */
  costRub: number | null;
  /** Raw `usage.cost` if present (currency per `currency`). */
  costRaw: number | null;
  /** Currency label for `costRaw`, if reported. */
  currency: string | null;
  /** Diagnostics for inconsistent provider data (never silently swallowed). */
  anomalies: string[];
}

function num(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function numOrNull(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const parsed = num(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Normalize a raw usage object. Does not assume fields exist; missing ones become 0 (or null for costs).
 * Collects any anomaly into `anomalies` instead of producing negative/garbage numbers.
 */
export function normalizeUsage(raw: RawUsageLike | null | undefined): NormalizedUsage {
  const anomalies: string[] = [];
  const usage = raw ?? {};

  const promptTotal = num(usage.prompt_tokens);
  const output = num(usage.completion_tokens);

  const details = usage.prompt_tokens_details ?? {};
  const cacheRead = num(details.cached_tokens ?? usage.cached_tokens);
  const cacheWrite = num(
    details.cache_write_tokens ?? details.cache_creation_tokens ?? usage.cache_write_tokens,
  );

  const reasoning = num(usage.completion_tokens_details?.reasoning_tokens);

  if (cacheRead + cacheWrite > promptTotal) {
    anomalies.push(
      `cacheRead(${cacheRead}) + cacheWrite(${cacheWrite}) > prompt_tokens(${promptTotal}); input clamped to 0`,
    );
  }

  const input = Math.max(0, promptTotal - cacheRead - cacheWrite);
  const totalTokens = input + output + cacheRead + cacheWrite;

  const reportedTotal = numOrNull(usage.total_tokens);
  if (reportedTotal !== null && reportedTotal !== totalTokens) {
    anomalies.push(
      `usage.total_tokens(${reportedTotal}) != computed total(${totalTokens}); using computed`,
    );
  }

  /*
   * Polza documents `cost_rub` as the per-request RUB charge. Some responses may only expose
   * `cost`; we keep both so callers can tell which one was actually present.
   */
  const costRub = numOrNull(usage.cost_rub);
  const costRaw = numOrNull(usage.cost);
  const currency = typeof usage.currency === "string" ? usage.currency : null;

  return {
    promptTotal,
    input,
    output,
    cacheRead,
    cacheWrite,
    reasoning,
    totalTokens,
    costRub,
    costRaw,
    currency,
    anomalies,
  };
}
