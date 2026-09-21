/**
 * Pricing rules (ТЗ v2 §14):
 *
 *   Polza catalog price      → estimated / reference price (native RUB)
 *   usage.cost_rub           → ACTUAL request billing (native RUB)   [authoritative]
 *   /api/v2/balance          → wallet state
 *
 * There is NO RUB→USD conversion and NO "OpenRouter price × markup" formula anywhere.
 * Pi's per-model `cost` (USD/1M) is intentionally zero — see mapper.ts PI_COST_POLICY.
 */
import type { ResolvedModel } from "./metadata/types.ts";
import type { NormalizedUsage } from "./usage.ts";

export interface CatalogEstimateRub {
  input: number | null;
  output: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  total: number | null;
  /** True only when every price needed for the observed usage was available. */
  complete: boolean;
}

const perMillion = (rate: number | null, tokens: number): number | null =>
  rate === null ? null : (rate * tokens) / 1_000_000;

/**
 * Estimate cost from the Polza catalog RUB price. This is a reference number, NOT the charge.
 * Returns `complete: false` (with null components) when a required rate is missing, instead of
 * pretending a partial sum is the total.
 */
export function estimateCatalogCostRub(model: ResolvedModel, usage: NormalizedUsage): CatalogEstimateRub {
  const price = model.pricing.polzaRUB;

  const input = perMillion(price.promptPerMillion, usage.input);
  const output = perMillion(price.completionPerMillion, usage.output);
  const cacheRead = usage.cacheRead > 0 ? perMillion(price.cacheReadPerMillion, usage.cacheRead) : 0;
  const cacheWrite = usage.cacheWrite > 0 ? perMillion(price.cacheWritePerMillion, usage.cacheWrite) : 0;

  const complete = input !== null && output !== null && cacheRead !== null && cacheWrite !== null;
  const total = complete ? input! + output! + cacheRead! + cacheWrite! : null;

  return { input, output, cacheRead, cacheWrite, total, complete };
}

/**
 * The actual billed RUB for a request. Prefers Polza's `usage.cost_rub`; falls back to the raw
 * `usage.cost` only when `cost_rub` is absent. Never converts currency.
 */
export function actualCostRub(usage: NormalizedUsage): number | null {
  return usage.costRub ?? usage.costRaw;
}
