/**
 * Footer/status formatting and balance-cache behaviour (no network).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { PolzaBalance } from "../.pi/extensions/pi-polza/balance.ts";
import {
  BALANCE_TTL_MS,
  PolzaStatusController,
  formatBalanceStatus,
  formatRubCompact,
  type BalanceSnapshot,
} from "../.pi/extensions/pi-polza/status.ts";

function balance(available: number): PolzaBalance {
  return { amount: available, available, reservedAmount: 0, spentAmount: 0, currency: "RUB" };
}

function snap(value: number | null, state: BalanceSnapshot["state"], fetchedAt = 0): BalanceSnapshot {
  return { value, state, fetchedAt };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("formatRubCompact adapts precision to magnitude", () => {
  assert.equal(formatRubCompact(43.5429743), "43.54 ₽");
  assert.equal(formatRubCompact(0.611), "0.61 ₽");
  assert.equal(formatRubCompact(0.00704003), "0.0070 ₽");
  assert.equal(formatRubCompact(0), "0.00 ₽");
  assert.equal(formatRubCompact(null), "?");
});

test("formatBalanceStatus covers fresh, stale, unavailable and empty session", () => {
  assert.equal(formatBalanceStatus(snap(43.54, "fresh"), { requests: 8, costRub: 0.611 }), "Polza 43.54 ₽ | Session 0.61 ₽");
  assert.equal(formatBalanceStatus(snap(43.54, "stale"), { requests: 1, costRub: 0.5 }), "Polza 43.54 ₽ | Session 0.50 ₽");
  assert.equal(formatBalanceStatus(snap(null, "unavailable"), { requests: 1, costRub: 0.5 }), "Polza ? | Session 0.50 ₽");
  assert.equal(formatBalanceStatus(snap(null, "unavailable"), { requests: 0, costRub: null }), "Polza ? | Session 0.00 ₽");
  assert.equal(formatBalanceStatus(snap(10, "fresh"), { requests: 2, costRub: null }), "Polza 10.00 ₽ | Session ?");
});

function makeController(overrides: Partial<Parameters<typeof buildController>[0]> = {}) {
  return buildController({ available: 43.5, ...overrides });
}

function buildController(opts: { available?: number; fail?: boolean; session?: { requests: number; costRub: number | null } } = {}) {
  const statuses: Array<string | undefined> = [];
  let now = 1_000_000;
  const controller = new PolzaStatusController({
    setStatus: (text) => statuses.push(text),
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
  assert.equal(h.last(), "Polza ? | Session 0.61 ₽");
  await tick();
  assert.equal(h.last(), "Polza 43.50 ₽ | Session 0.61 ₽");
  assert.equal(h.controller.snapshot.state, "fresh");
});

test("balance failure keeps the session cost and shows unknown balance", async () => {
  const h = buildController({ fail: true });
  h.controller.activate();
  await tick();
  assert.equal(h.last(), "Polza ? | Session 0.61 ₽");
  assert.equal(h.controller.snapshot.state, "unavailable");
});

test("a known balance that later fails is shown as stale, not lost", async () => {
  const statuses: Array<string | undefined> = [];
  let failing = false;
  let now = 1_000_000;
  const controller = new PolzaStatusController({
    setStatus: (t) => statuses.push(t),
    fetchBalance: async () => {
      if (failing) throw new Error("down");
      return balance(43.5);
    },
    getSessionCost: () => ({ requests: 1, costRub: 0.61 }),
    now: () => now,
  });
  controller.activate();
  await tick();
  assert.equal(statuses[statuses.length - 1], "Polza 43.50 ₽ | Session 0.61 ₽");

  failing = true;
  now += BALANCE_TTL_MS + 1;
  await controller.refreshBalance();
  assert.equal(controller.snapshot.state, "stale");
  assert.equal(statuses[statuses.length - 1], "Polza 43.50 ₽ | Session 0.61 ₽");
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
    setStatus: (t) => statuses.push(t),
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
