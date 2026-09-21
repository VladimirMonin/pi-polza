/**
 * Polza account balance (v2).
 *
 * `GET https://polza.ai/api/v2/balance`
 *
 * IMPORTANT: balance is *global account/organization* state and can change due to concurrent
 * requests. It must never be treated as "cost of the current session". Per-request cost comes
 * from `usage.cost_rub` of concrete chat completions.
 *
 * Observed response (2026-09, v2): all amounts are decimal **strings** in RUB.
 *   {"amount":"43.54297430","available":"43.54297430","reservedAmount":"0.00000000",
 *    "spentAmount":"1689.05900676","updatedAt":"..."}
 */
import { POLZA_API_V2, polzaJson, toNumberSafe } from "./http.ts";

export interface PolzaBalance {
  /** Total account amount. */
  amount: number;
  /** Amount currently available (amount minus reservations). */
  available: number;
  /** Amount reserved by in-flight operations. */
  reservedAmount: number;
  /** Lifetime spent amount, NOT the current session cost. */
  spentAmount: number;
  /** When Polza last updated the balance, if provided. */
  updatedAt?: string;
  /** Polza reports RUB natively; no FX conversion is applied. */
  currency: "RUB";
}

interface RawBalance {
  amount?: unknown;
  available?: unknown;
  reservedAmount?: unknown;
  spentAmount?: unknown;
  updatedAt?: unknown;
}

export async function fetchBalance(signal?: AbortSignal): Promise<PolzaBalance> {
  const raw = await polzaJson<RawBalance>(`${POLZA_API_V2}/balance`, { signal });
  return {
    amount: toNumberSafe(raw.amount),
    available: toNumberSafe(raw.available),
    reservedAmount: toNumberSafe(raw.reservedAmount),
    spentAmount: toNumberSafe(raw.spentAmount),
    ...(typeof raw.updatedAt === "string" ? { updatedAt: raw.updatedAt } : {}),
    currency: "RUB",
  };
}

const rubFormatter = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});

export function formatRub(value: number): string {
  return rubFormatter.format(value);
}
