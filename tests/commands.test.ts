/**
 * Command formatting tests using a fake ExtensionAPI/ExtensionContext.
 * (balance is tested with a mocked fetch; no network access.)
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { registerPolzaCommands } from "../.pi/extensions/pi-polza/commands.ts";
import { recordFromUsage, type PolzaUsageRecord } from "../.pi/extensions/pi-polza/accounting.ts";
import { fetchBalance } from "../.pi/extensions/pi-polza/balance.ts";
import { PolzaStatusController } from "../.pi/extensions/pi-polza/status.ts";
import { resolveModel } from "../.pi/extensions/pi-polza/metadata/resolver.ts";
import type { ResolvedModel } from "../.pi/extensions/pi-polza/metadata/types.ts";
import { polzaModel } from "./fixtures.ts";

type Handler = (args: string, ctx: unknown) => Promise<void>;

function collectCommands(): { handlers: Map<string, Handler>; notify: (name: string, ...args: unknown[]) => void } {
  const handlers = new Map<string, Handler>();
  const fakePi = {
    registerCommand: (name: string, options: { handler: Handler }) => handlers.set(name, options.handler),
  } as unknown as Parameters<typeof registerPolzaCommands>[0];
  const status = new PolzaStatusController({
    setStatus: () => {},
    fetchBalance: (signal) => fetchBalance(signal),
    getSessionCost: () => ({ requests: usageRecords.length, costRub: null }),
  });
  registerPolzaCommands(fakePi, {
    getRegistry: () => registry,
    getLastBuildInfo: () => null,
    getUsageRecords: () => usageRecords,
    getStatusController: () => status,
  });
  return { handlers, notify: () => {} };
}

let registry: ResolvedModel[] = [];
let usageRecords: PolzaUsageRecord[] = [];

function makeCtx(model: { provider: string; id: string } | undefined): { notifications: Array<{ message: string; type: string }>; ctx: unknown } {
  const notifications: Array<{ message: string; type: string }> = [];
  const ctx = {
    model,
    signal: undefined,
    ui: {
      notify: (message: string, type: string = "info") => notifications.push({ message, type }),
    },
  };
  return { notifications, ctx };
}

const originalFetch = globalThis.fetch;
const originalKey = process.env.POLZA_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  usageRecords = [];
  if (originalKey === undefined) delete process.env.POLZA_API_KEY;
  else process.env.POLZA_API_KEY = originalKey;
});

test("/polza-model-info shows values with provenance", async () => {
  registry = [
    resolveModel(
      polzaModel({
        id: "qwen/qwen3.5-9b",
        contextLength: 32768,
        maxCompletionTokens: 32768,
        supportedParameters: ["tools", "reasoning"],
        promptPerMillion: "1.68100000",
        completionPerMillion: "5.04300000",
        cacheReadPerMillion: null,
      }),
      null,
    ),
  ];
  const { handlers } = collectCommands();
  const handler = handlers.get("polza-model-info");
  assert.ok(handler);

  const { notifications, ctx } = makeCtx({ provider: "polza", id: "qwen/qwen3.5-9b" });
  await handler("", ctx);

  assert.equal(notifications.length, 1);
  const text = notifications[0]!.message;
  assert.match(text, /Model\s+qwen\/qwen3\.5-9b/);
  assert.match(text, /Context\s+32,768/);
  assert.match(text, /Max output\s+32,768/);
  assert.match(text, /polza/);
  assert.match(text, /Tools\s+yes/);
  assert.match(text, /Reasoning\s+declared/);
  assert.match(text, /Cache read\s+unknown/);
  assert.match(text, /usage\.cost_rub/);
});

test("/polza-model-info reports unknown instead of 0", async () => {
  registry = [resolveModel(polzaModel({ id: "vendor/sparse", contextLength: null, maxCompletionTokens: null }), null)];
  const { handlers } = collectCommands();
  const handler = handlers.get("polza-model-info")!;
  const { notifications, ctx } = makeCtx({ provider: "polza", id: "vendor/sparse" });
  await handler("", ctx);

  const text = notifications[0]!.message;
  assert.match(text, /Context\s+unknown/);
  assert.match(text, /Max output\s+unknown/);
  assert.doesNotMatch(text, /Context\s+0/);
});

test("/polza-model-info warns for a non-Polza model", async () => {
  registry = [];
  const { handlers } = collectCommands();
  const handler = handlers.get("polza-model-info")!;
  const { notifications, ctx } = makeCtx({ provider: "openai", id: "gpt-4o" });
  await handler("", ctx);
  assert.equal(notifications[0]!.type, "warning");
  assert.match(notifications[0]!.message, /not a Polza model/);
});

test("/polza-cost reports nothing for an empty session", async () => {
  registry = [];
  usageRecords = [];
  const { handlers } = collectCommands();
  const handler = handlers.get("polza-cost")!;
  const { notifications, ctx } = makeCtx(undefined);
  await handler("", ctx);
  assert.match(notifications[0]!.message, /no usage recorded yet/);
});

test("/polza-cost sums actual RUB and per-model costs", async () => {
  registry = [];
  usageRecords = [
    recordFromUsage("qwen/qwen3.5-9b", { prompt_tokens: 19, completion_tokens: 2, cost_rub: 0.00004203 }, 1),
    recordFromUsage("openai/gpt-5-nano", { prompt_tokens: 4026, completion_tokens: 0, cost_rub: 0.02368697 }, 2),
    recordFromUsage("openai/gpt-5-nano", { prompt_tokens: 4026, completion_tokens: 0, cost_rub: 0.00267582 }, 3),
  ];
  const { handlers } = collectCommands();
  const handler = handlers.get("polza-cost")!;
  const { notifications, ctx } = makeCtx(undefined);
  await handler("", ctx);

  const text = notifications[0]!.message;
  assert.match(text, /Actual cost/);
  assert.match(text, /Requests\s+3/);
  assert.match(text, /Input\s+8,071/);
  assert.match(text, /qwen\/qwen3\.5-9b/);
  assert.match(text, /openai\/gpt-5-nano/);
});

test("/polza-cost marks unknown cost when cost_rub is absent", async () => {
  registry = [];
  usageRecords = [recordFromUsage("qwen/qwen3.5-9b", { prompt_tokens: 10, completion_tokens: 1 }, 1)];
  const { handlers } = collectCommands();
  const handler = handlers.get("polza-cost")!;
  const { notifications, ctx } = makeCtx(undefined);
  await handler("", ctx);
  assert.match(notifications[0]!.message, /Actual cost\s+unknown/);
  assert.match(notifications[0]!.message, /cost is unknown, not estimated/);
});

test("/polza-balance prints native RUB fields and does not call it session cost", async () => {
  process.env.POLZA_API_KEY = "test-key";
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        amount: "43.54297430",
        available: "43.54297430",
        reservedAmount: "0.00000000",
        spentAmount: "1689.05900676",
        updatedAt: "2026-09-20T13:38:28.039Z",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as typeof fetch;

  registry = [];
  const { handlers } = collectCommands();
  const handler = handlers.get("polza-balance")!;
  const { notifications, ctx } = makeCtx(undefined);
  await handler("", ctx);

  const text = notifications[0]!.message;
  assert.match(text, /Available/);
  assert.match(text, /Reserved/);
  assert.match(text, /Lifetime spent/);
  assert.match(text, /not the current session cost/);
});

test("/polza-refresh refreshes the polza provider and reports success", async () => {
  registry = [];
  const { handlers } = collectCommands();
  const handler = handlers.get("polza-refresh")!;
  let refreshed = 0;
  const notifications: Array<{ message: string; type: string }> = [];
  const ctx = {
    ui: {
      notify: (message: string, type: string = "info") => notifications.push({ message, type }),
      theme: { fg: (_c: string, t: string) => t, bold: (t: string) => t },
    },
    modelRegistry: {
      getProviderAuthStatus: () => ({ configured: true }),
      refresh: async (options: { providers?: readonly string[] }) => {
        refreshed += 1;
        assert.deepEqual(options.providers, ["polza"]);
        return { aborted: false, errors: new Map() };
      },
    },
  };
  await handler("", ctx);
  assert.equal(refreshed, 1);
  assert.equal(notifications[0]!.type, "info");
  assert.match(notifications[0]!.message, /refreshed/i);
});

test("/polza-refresh tells the user to log in when Polza is unconfigured", async () => {
  registry = [];
  const { handlers } = collectCommands();
  const handler = handlers.get("polza-refresh")!;
  const notifications: Array<{ message: string; type: string }> = [];
  const ctx = {
    ui: { notify: (message: string, type: string = "info") => notifications.push({ message, type }) },
    modelRegistry: {
      getProviderAuthStatus: () => ({ configured: false }),
      refresh: async () => {
        throw new Error("should not be called");
      },
    },
  };
  await handler("", ctx);
  assert.equal(notifications[0]!.type, "warning");
  assert.match(notifications[0]!.message, /login/);
});
