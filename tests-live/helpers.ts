/**
 * Shared helpers for LIVE tests.
 *
 * Live tests hit Polza for real. They are never part of `npm test`; run them with `npm run test:live`.
 * A hard request budget keeps an accidental loop from burning the balance.
 */
import { fetchCatalog, rankUsableChatModelsByPromptPrice } from "../.pi/extensions/pi-polza/catalog.ts";
import { loadDotEnv } from "../.pi/extensions/pi-polza/env.ts";

export const MAX_LIVE_REQUESTS = Number(process.env.POLZA_LIVE_MAX_REQUESTS ?? 6);
/** Keep outputs tiny so each live test costs a fraction of a ruble. */
export const LIVE_MAX_TOKENS = Number(process.env.POLZA_LIVE_MAX_TOKENS ?? 16);

let used = 0;
let spendRub = 0;

/** Call before every billed request. Throws when the budget is exhausted. */
export function chargeRequest(): void {
  if (used >= MAX_LIVE_REQUESTS) {
    throw new Error(`Live budget exhausted: ${used}/${MAX_LIVE_REQUESTS} requests (raise POLZA_LIVE_MAX_REQUESTS to continue).`);
  }
  used += 1;
}

export function addCost(costRub: number | null | undefined): void {
  if (typeof costRub === "number" && Number.isFinite(costRub)) spendRub += costRub;
}

export function liveReport(): string {
  return `LIVE summary: requests=${used}/${MAX_LIVE_REQUESTS}  actual cost_rub=${spendRub.toFixed(8)}`;
}

export function hasLiveKey(): boolean {
  loadDotEnv();
  return Boolean(process.env.POLZA_API_KEY?.trim());
}

let cachedModel: string | null = null;

/** Cheapest usable chat model, unless POLZA_TEST_MODEL is set. Cached across tests. */
export async function cheapLiveModel(): Promise<string> {
  const override = process.env.POLZA_TEST_MODEL?.trim();
  if (override) return override;
  if (cachedModel) return cachedModel;
  const { models } = await fetchCatalog({ limit: 100 });
  const chosen = rankUsableChatModelsByPromptPrice(models)[0];
  if (!chosen) throw new Error("No usable chat model found.");
  cachedModel = chosen.id;
  return chosen.id;
}
