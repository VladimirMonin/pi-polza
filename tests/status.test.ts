/**
 * Footer/status formatting and balance-cache behaviour (no network).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { PolzaBalance } from "../.pi/extensions/pi-polza/balance.ts";
import {
  BALANCE_TTL_MS,
  PLAIN_STATUS_THEME,
  PolzaStatusController,
  formatBalanceStatus,
  formatRubCompact,
  polzaStatusModel,
  renderPolzaStatus,
  type BalanceSnapshot,
  type PolzaStatusModel,
  type StatusTheme,
} from "../.pi/extensions/pi-polza/status.ts";

function balance(available: number): PolzaBalance {
  return { amount: available, available, reservedAmount: 0, spentAmount: 0, currency: "RUB" };
}

function snap(value: number | null, state: BalanceSnapshot["state"], fetchedAt = 0): BalanceSnapshot {
  return { value, state, fetchedAt };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Collect footer output exactly as Pi would render it with no colors. */
const pushPlain = (statuses: Array<string | undefined>) => (model: PolzaStatusModel | undefined) =>
  statuses.push(model ? renderPolzaStatus(PLAIN_STATUS_THEME, model) : undefined);

/** Theme stub that records which semantic role each fragment was rendered with. */
function recordingTheme(): { theme: StatusTheme; calls: Array<{ color: string; text: string }> } {
  const calls: Array<{ color: string; text: string }> = [];
  return {
    calls,
    theme: {
      fg: (color, text) => {
        calls.push({ color, text });
        return `[${color}]${text}`;
      },
      bold: (text) => text,
    },
  };
}

test("formatRubCompact adapts precision to magnitude", () => {
  assert.equal(formatRubCompact(43.5429743), "43.54 ₽");
  assert.equal(formatRubCompact(0.611), "0.61 ₽");
  assert.equal(formatRubCompact(0.00704003), "0.0070 ₽");
  assert.equal(formatRubCompact(0), "0.00 ₽");
  assert.equal(formatRubCompact(null), "?");
});

test("formatBalanceStatus covers fresh, stale, unavailable and empty session", () => {
  assert.equal(formatBalanceStatus(snap(43.54, "fresh"), { requests: 8, costRub: 0.611 }), "Polza 43.54 ₽ | Spent 0.61 ₽");
  assert.equal(formatBalanceStatus(snap(43.54, "stale"), { requests: 1, costRub: 0.5 }), "Polza 43.54 ₽ | Spent 0.50 ₽");
  assert.equal(formatBalanceStatus(snap(null, "unavailable"), { requests: 1, costRub: 0.5 }), "Polza ? | Spent 0.50 ₽");
  assert.equal(formatBalanceStatus(snap(null, "unavailable"), { requests: 0, costRub: null }), "Polza ? | Spent 0.00 ₽");
  assert.equal(formatBalanceStatus(snap(10, "fresh"), { requests: 2, costRub: null }), "Polza 10.00 ₽ | Spent ?");
});

test("footer labels the amount as Spent, never as the whole session", () => {
  const text = formatBalanceStatus(snap(43.54, "fresh"), { requests: 1, costRub: 0.61 });
  assert.match(text, /Spent 0\.61 ₽/);
  assert.doesNotMatch(text, /Session/);
});

test("footer marks a partial subtotal only when some requests carried no cost", () => {
  const partial = formatBalanceStatus(snap(43.54, "fresh"), { requests: 3, costRub: 0.61, unpricedRequests: 1 });
  assert.match(partial, /Spent 0\.61 ₽ partial/);

  const complete = formatBalanceStatus(snap(43.54, "fresh"), { requests: 3, costRub: 0.61, unpricedRequests: 0 });
  assert.doesNotMatch(complete, /partial/);

  // Absent count means "not reported", which must not be silently treated as incomplete.
  const unspecified = formatBalanceStatus(snap(43.54, "fresh"), { requests: 3, costRub: 0.61 });
  assert.doesNotMatch(unspecified, /partial/);
});

function makeController(overrides: Partial<Parameters<typeof buildController>[0]> = {}) {
  return buildController({ available: 43.5, ...overrides });
}

function buildController(opts: { available?: number; fail?: boolean; session?: { requests: number; costRub: number | null } } = {}) {
  const statuses: Array<string | undefined> = [];
  let now = 1_000_000;
  const controller = new PolzaStatusController({
    setStatus: pushPlain(statuses),
    fetchBalance: async () => {
      if (opts.fail) throw new Error("network down");
      return balance(opts.available ?? 43.5);
    },
    getSessionCost: () => opts.session ?? { requests: 1, costRub: 0.61 },
    now: () => now,
  });
  return {
    controller,
    statuses,
    advance: (ms: number) => {
      now += ms;
    },
    last: () => statuses[statuses.length - 1],
  };
}

test("controller renders '?' first, then fresh balance after activation fetch", async () => {
  const h = makeController();
  h.controller.activate();
  assert.equal(h.last(), "Polza ? | Spent 0.61 ₽");
  await tick();
  assert.equal(h.last(), "Polza 43.50 ₽ | Spent 0.61 ₽");
  assert.equal(h.controller.snapshot.state, "fresh");
});

test("balance failure keeps the session cost and shows unknown balance", async () => {
  const h = buildController({ fail: true });
  h.controller.activate();
  await tick();
  assert.equal(h.last(), "Polza ? | Spent 0.61 ₽");
  assert.equal(h.controller.snapshot.state, "unavailable");
});

test("a known balance that later fails is shown as stale, not lost", async () => {
  const statuses: Array<string | undefined> = [];
  let failing = false;
  let now = 1_000_000;
  const controller = new PolzaStatusController({
    setStatus: pushPlain(statuses),
    fetchBalance: async () => {
      if (failing) throw new Error("down");
      return balance(43.5);
    },
    getSessionCost: () => ({ requests: 1, costRub: 0.61 }),
    now: () => now,
  });
  controller.activate();
  await tick();
  assert.equal(statuses[statuses.length - 1], "Polza 43.50 ₽ | Spent 0.61 ₽");

  failing = true;
  now += BALANCE_TTL_MS + 1;
  await controller.refreshBalance();
  assert.equal(controller.snapshot.state, "stale");
  assert.equal(statuses[statuses.length - 1], "Polza 43.50 ₽ | Spent 0.61 ₽");
});

test("requestCompleted refreshes only when the TTL expired", async () => {
  const h = makeController();
  h.controller.activate();
  await tick();
  let fetches = 0;
  // replace fetch counter via a fresh controller for clarity
  const statuses: Array<string | undefined> = [];
  let now = 1_000_000;
  const controller = new PolzaStatusController({
    setStatus: pushPlain(statuses),
    fetchBalance: async () => {
      fetches += 1;
      return balance(10);
    },
    getSessionCost: () => ({ requests: 1, costRub: 1 }),
    now: () => now,
  });
  controller.activate();
  await tick();
  assert.equal(fetches, 1);

  now += 5_000; // within TTL
  controller.requestCompleted();
  await tick();
  assert.equal(fetches, 1, "no refresh within TTL");

  now += BALANCE_TTL_MS + 1;
  controller.requestCompleted();
  await tick();
  assert.equal(fetches, 2, "refresh after TTL");
});

test("requestCompleted re-renders a partial subtotal without waiting for the TTL", async () => {
  const statuses: Array<string | undefined> = [];
  let unpriced = 0;
  let now = 1_000_000;
  const controller = new PolzaStatusController({
    setStatus: pushPlain(statuses),
    fetchBalance: async () => balance(43.5),
    getSessionCost: () => ({ requests: 2, costRub: 0.61, unpricedRequests: unpriced }),
    now: () => now,
  });
  controller.activate();
  await tick();
  assert.equal(statuses[statuses.length - 1], "Polza 43.50 ₽ | Spent 0.61 ₽");

  unpriced = 1;
  now += 5_000; // still inside the balance TTL: no refetch, but the marker must appear
  controller.requestCompleted();
  assert.equal(statuses[statuses.length - 1], "Polza 43.50 ₽ | Spent 0.61 ₽ partial");
});

test("deactivate clears the status and stops refreshes", () => {
  const h = makeController();
  h.controller.activate();
  h.controller.deactivate();
  assert.equal(h.last(), undefined);
  assert.equal(h.controller.isActive, false);
  h.advance(BALANCE_TTL_MS + 1);
  h.controller.requestCompleted();
  assert.equal(h.last(), undefined);
});

test("renderPolzaStatus uses muted labels, a dim separator, normal values and warns only on failure", () => {
  const ok = recordingTheme();
  renderPolzaStatus(ok.theme, polzaStatusModel(snap(43.54, "fresh"), { requests: 1, costRub: 0.61 }));
  assert.ok(ok.calls.some((c) => c.color === "muted" && c.text === "Polza"));
  assert.ok(ok.calls.some((c) => c.color === "dim" && c.text === " | "));
  assert.ok(ok.calls.some((c) => c.color === "text" && c.text === "43.54 ₽"));
  assert.ok(ok.calls.some((c) => c.color === "muted" && c.text === "Spent"));
  assert.ok(ok.calls.some((c) => c.color === "text" && c.text === "0.61 ₽"));
  assert.equal(ok.calls.some((c) => c.color === "warning"), false);
  assert.equal(ok.calls.some((c) => c.text === "partial"), false, "complete spend carries no marker");

  const failed = recordingTheme();
  renderPolzaStatus(failed.theme, polzaStatusModel(snap(null, "unavailable"), { requests: 0, costRub: null }));
  assert.ok(failed.calls.some((c) => c.color === "warning" && c.text === "?"));
});

test("renderPolzaStatus marks a partial subtotal faintly, not as a warning", () => {
  const { theme, calls } = recordingTheme();
  renderPolzaStatus(theme, polzaStatusModel(snap(43.54, "fresh"), { requests: 2, costRub: 0.61, unpricedRequests: 1 }));
  assert.ok(calls.some((c) => c.color === "dim" && c.text === "partial"));
  assert.equal(calls.some((c) => c.color === "warning" && c.text === "partial"), false);
});
