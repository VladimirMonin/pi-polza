/**
 * Persistent Polza footer/status bar (framework-agnostic core).
 *
 * Renders `Polza <balance> ₽ | Session <cost> ₽` via Pi's native `ctx.ui.setStatus`.
 * Balance comes from `/api/v2/balance`; Session is the sum of authoritative `usage.cost_rub`.
 * The two are independent: a failing balance endpoint never hides the session cost.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { PolzaBalance } from "./balance.ts";

/** Minimal theme surface the footer needs (keeps this module free of TUI internals). */
export type StatusTheme = Pick<Theme, "fg" | "bold">;

/** Key under which the status text is registered with Pi. */
export const POLZA_STATUS_KEY = "polza-accounting";

/** Balance is re-fetched at most this often (during activation / after a completed request). */
export const BALANCE_TTL_MS = 45_000;

export type BalanceState = "fresh" | "stale" | "unavailable";

export interface BalanceSnapshot {
  /** Available balance in RUB; null when never successfully fetched. */
  value: number | null;
  fetchedAt: number;
  state: BalanceState;
}

export interface SessionCost {
  requests: number;
  /** Sum of `usage.cost_rub`; null when records exist but none carried a cost. */
  costRub: number | null;
}

/** Compact RUB: 2 decimals for normal amounts, more precision only when the amount is tiny. */
export function formatRubCompact(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "?";
  const abs = Math.abs(value);
  if (abs === 0) return "0.00 ₽";
  if (abs >= 0.1) return `${value.toFixed(2)} ₽`;
  if (abs >= 0.001) return `${value.toFixed(4)} ₽`;
  return `${value.toFixed(6)} ₽`;
}

function balanceCell(balance: BalanceSnapshot): string {
  if (balance.value === null) return "?";
  return formatRubCompact(balance.value);
}

function sessionCell(session: SessionCost): string {
  if (session.requests === 0) return formatRubCompact(0);
  return formatRubCompact(session.costRub);
}

/** `Polza 43.54 ₽ | Session 0.61 ₽` (or `Polza ? ₽ | Session 0.61 ₽` on balance failure). */
export function formatBalanceStatus(balance: BalanceSnapshot, session: SessionCost): string {
  return renderPolzaStatus(PLAIN_STATUS_THEME, polzaStatusModel(balance, session));
}

/** Structured footer content, so the caller can theme it without parsing a string. */
export interface PolzaStatusModel {
  balance: string;
  session: string;
  balanceState: BalanceState;
}

export function polzaStatusModel(balance: BalanceSnapshot, session: SessionCost): PolzaStatusModel {
  return { balance: balanceCell(balance), session: sessionCell(session), balanceState: balance.state };
}

/** No-op theme used for plain-text output (tests, non-TUI fallback). */
export const PLAIN_STATUS_THEME: StatusTheme = {
  fg: (_color, text) => text,
  bold: (text) => text,
};

/**
 * Calm, low-noise styling: labels are muted, the separator is dim, values are normal text.
 * An unavailable balance is the only thing that draws attention (warning), and never the whole line.
 */
export function renderPolzaStatus(theme: StatusTheme, model: PolzaStatusModel): string {
  const balanceValue =
    model.balanceState === "unavailable" ? theme.fg("warning", model.balance) : theme.fg("text", model.balance);
  return [
    theme.fg("muted", "Polza"),
    " ",
    balanceValue,
    theme.fg("dim", " | "),
    theme.fg("muted", "Session"),
    " ",
    theme.fg("text", model.session),
  ].join("");
}

export interface StatusControllerDeps {
  /** Called with the structured footer model, or undefined to clear. */
  setStatus: (model: PolzaStatusModel | undefined) => void;
  fetchBalance: (signal?: AbortSignal) => Promise<PolzaBalance>;
  getSessionCost: () => SessionCost;
  ttlMs?: number;
  now?: () => number;
}

/**
 * Owns the balance cache and decides when to (re)fetch. Rendering is a pure function of the cache
 * and the session accumulator, so it is cheap to call after every billed request.
 */
export class PolzaStatusController {
  private balance: BalanceSnapshot = { value: null, fetchedAt: 0, state: "unavailable" };
  private lastBalance: PolzaBalance | null = null;
  private active = false;
  private refreshing = false;
  private readonly deps: StatusControllerDeps;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(deps: StatusControllerDeps) {
    this.deps = deps;
    this.ttlMs = deps.ttlMs ?? BALANCE_TTL_MS;
    this.now = deps.now ?? (() => Date.now());
  }

  get snapshot(): BalanceSnapshot {
    return this.balance;
  }

  /** Last successfully fetched balance payload (for the detailed `/polza-balance` view). */
  get current(): PolzaBalance | null {
    return this.lastBalance;
  }

  get isActive(): boolean {
    return this.active;
  }

  /** Show the status for the Polza provider; fetches balance if the cache is older than the TTL. */
  activate(signal?: AbortSignal): void {
    this.active = true;
    this.render();
    if (this.isStale()) void this.refreshBalance(signal);
  }

  /** Hide the status (provider switched away, or non-TUI mode). */
  deactivate(): void {
    this.active = false;
    this.deps.setStatus(undefined);
  }

  /** Called after a response was accounted: re-render now, refresh balance only when TTL expired. */
  requestCompleted(signal?: AbortSignal): void {
    if (!this.active) return;
    this.render();
    if (this.isStale()) void this.refreshBalance(signal);
  }

  /** Force a balance refresh (used by `/polza-balance`), bypassing the TTL. */
  async refreshBalance(signal?: AbortSignal): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      const balance = await this.deps.fetchBalance(signal);
      this.lastBalance = balance;
      this.balance = { value: balance.available, fetchedAt: this.now(), state: "fresh" };
    } catch {
      // Keep the last known value; distinguish stale (had one) from unavailable (never had one).
      this.balance = {
        value: this.balance.value,
        fetchedAt: this.balance.fetchedAt,
        state: this.balance.value === null ? "unavailable" : "stale",
      };
    } finally {
      this.refreshing = false;
    }
    this.render();
  }

  private isStale(): boolean {
    return this.now() - this.balance.fetchedAt >= this.ttlMs;
  }

  private render(): void {
    if (!this.active) {
      this.deps.setStatus(undefined);
      return;
    }
    this.deps.setStatus(polzaStatusModel(this.balance, this.deps.getSessionCost()));
  }
}
