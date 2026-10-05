/** Exact installed bundle + production entry/helper. Synthetic SSE only; no Pi CLI or network. */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { test, before, after } from "node:test";
import { PolzaCostAccumulator, coerceRecord, type PolzaUsageRecord } from "../.pi/extensions/pi-polza/accounting.ts";
import { PolzaStatusController, BALANCE_TTL_MS } from "../.pi/extensions/pi-polza/status.ts";

// Override points to the installed coding-agent package root, not to credentials or a profile.
const sdkOverride = process.env.PI_POLZA_TEST_SDK_ROOT?.trim();
if (sdkOverride && !isAbsolute(sdkOverride)) throw new Error("PI_POLZA_TEST_SDK_ROOT must be absolute");
const packageName = "@earendil-works/pi-coding-agent";
const roots = sdkOverride ? [sdkOverride] : [
  join(process.cwd(), "node_modules", packageName),
  ...(process.env.APPDATA ? [join(process.env.APPDATA, "npm", "node_modules", packageName)] : []),
  join(dirname(process.execPath), "node_modules", packageName),
  join(dirname(process.execPath), "..", "lib", "node_modules", packageName),
];
const lazyFile = "chunk-7JGR3GZN.js";
const sdkRoot = roots.find((root) => {
  try {
    if (JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version !== "1.0.2") return false;
    const chunks = readdirSync(join(root, "dist", "bundle", "chunks"));
    return chunks.includes(lazyFile) && chunks.some((name) => /^openai-completions-.*\.js$/.test(name));
  } catch {
    return false;
  }
});
const sdkVersion = sdkRoot ? JSON.parse(readFileSync(join(sdkRoot, "package.json"), "utf8")).version : undefined;
const bundleDir = sdkRoot ? join(sdkRoot, "dist", "bundle", "chunks") : "";
const files = bundleDir && existsSync(bundleDir) ? readdirSync(bundleDir) : [];
const transportFile = files.find((name) => /^openai-completions-.*\.js$/.test(name));
const skipReason = sdkVersion !== "1.0.2" ? "Installed Pi 1.0.2 SDK not found; set PI_POLZA_TEST_SDK_ROOT to its package root"
  : !transportFile || !files.includes(lazyFile) ? "Expected Pi 1.0.2 native bundle chunks unavailable" : false;
const available = skipReason === false;
let createPolzaApiStreams: typeof import("../.pi/extensions/pi-polza/stream.ts").createPolzaApiStreams;
if (available) {
  // Only substitute virtual-module resolution. The factory uses the REAL bundled lazyApi and
  // REAL bundled transport (the same factory expression as the installed compat export).
  const transportUrl = pathToFileURL(`${bundleDir}/${transportFile}`).href;
  const lazyUrl = pathToFileURL(`${bundleDir}/${lazyFile}`).href;
  const shim = `import {lazyApi} from ${JSON.stringify(lazyUrl)}; export const openAICompletionsApi = () => lazyApi(() => import(${JSON.stringify(transportUrl)}));`;
  const hooks = registerHooks({ resolve(specifier, ctx, next) {
    return specifier === "@earendil-works/pi-ai/compat"
      ? { url: `data:text/javascript,${encodeURIComponent(shim)}`, shortCircuit: true } : next(specifier, ctx);
  } });
  try { ({ createPolzaApiStreams } = await import("../.pi/extensions/pi-polza/stream.ts")); }
  finally { hooks.deregister(); }
}
const originalFetch = globalThis.fetch;
before(() => { globalThis.fetch = async () => { throw new Error("Network fetch forbidden in offline native tests"); }; });
after(() => { globalThis.fetch = originalFetch; });
const model = { id: "offline/model", name: "Offline", api: "openai-completions", provider: "polza", baseUrl: "https://offline.invalid/v1", reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 64 };
const context = { messages: [{ role: "user", content: "synthetic", timestamp: 1 }] };
const encoder = new TextEncoder();
const line = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const textChunk = { choices: [{ delta: { content: "ok" }, finish_reason: null }] };
const finish = { choices: [{ delta: {}, finish_reason: "stop" }] };
const usageChunk = (usage: unknown) => ({ choices: [], usage });
const usage = (cost_rub: unknown) => ({ prompt_tokens: 10, completion_tokens: 2, cost_rub, prompt_tokens_details: { cached_tokens: 3 } });
const opts = { skip: skipReason, timeout: 2000 };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function body(chunks: unknown[], ending: "eof" | "done-eof" | "delayed" | "open" = "done-eof") {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let closed = false;
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const close = () => { if (!closed && !cancelled) { closed = true; controller.close(); } };
  const response = new Response(new ReadableStream<Uint8Array>({ start(c) {
    controller = c;
    const payload = chunks.map(line).join("") + (ending === "eof" ? "" : "data: [DONE]\n\n");
    c.enqueue(encoder.encode(payload));
    if (ending === "eof" || ending === "done-eof") close();
    if (ending === "delayed") timer = setTimeout(close, 60);
  }, cancel() { cancelled = true; clearTimeout(timer); } }), { headers: { "content-type": "text/event-stream" } });
  return { response, isClosed: () => closed, cleanup: () => { clearTimeout(timer); close(); } };
}

for (const method of ["stream", "streamSimple"] as const) {
  for (const ending of ["eof", "done-eof", "delayed", "open"] as const) {
    test(`native ${method}: ${ending}, last usage once before consumer terminal; result leaves queue intact`, opts, async () => {
      const b = body([textChunk, usageChunk(usage(0.1)), finish, usageChunk(usage(0.25))], ending);
      const records: PolzaUsageRecord[] = [];
      let fetches = 0;
      const s = createPolzaApiStreams((r) => records.push(r))[method](model as any, context as any, {
        apiKey: "offline-placeholder", fetch: async () => { fetches++; return b.response; },
      });
      const originalResult = s.result;
      try {
        const result = await s.result();
        assert.equal(result.stopReason, "stop");
        assert.equal(result.usage.cost.total, 0, "RUB never enters the USD field");
        assert.deepEqual(records.map((r) => r.costRub), [0.25]);
        assert.equal(records[0].promptTokens, 10);
        assert.equal(fetches, 1);
        assert.equal(s.result, originalResult);
        if (ending === "open" || ending === "delayed") assert.equal(b.isClosed(), false, "accounting must not wait for EOF");
        const events = [];
        for await (const event of s) {
          events.push(event.type);
          if (event.type === "done") assert.equal(records.length, 1);
        }
        assert.equal(events[0], "start", "result() did not consume queued events");
        assert.ok(events.includes("text_delta"));
        assert.equal(events.at(-1), "done");
        await s.result();
        assert.equal(records.length, 1, "result + iterator cannot duplicate accounting");
        assert.equal(coerceRecord(JSON.parse(JSON.stringify(records[0])))?.eventId, records[0].eventId);
      } finally { b.cleanup(); }
    });
  }

  for (const [label, finalUsage, cost] of [
    ["missing usage", undefined, null], ["missing cost", {}, null], ["malformed string", usage("bad"), null],
    ["malformed usage", "bad", null], ["null usage", null, null], ["malformed empty", usage(""), null],
    ["zero", usage(0), 0], ["decimal string", usage("0.25"), 0.25],
  ] as const) {
    test(`native ${method}: ${label} is honest terminal cost`, opts, async () => {
      const chunks = finalUsage === undefined ? [textChunk, finish] : [textChunk, usageChunk(usage(1)), finish, usageChunk(finalUsage)];
      const b = body(chunks);
      const records: PolzaUsageRecord[] = [];
      try {
        const s = createPolzaApiStreams((r) => records.push(r))[method](model as any, context as any, { apiKey: "offline-placeholder", fetch: async () => b.response });
        assert.equal((await s.result()).stopReason, "stop");
        assert.deepEqual(records.map((r) => r.costRub), [cost]);
      } finally { b.cleanup(); }
    });
  }

  for (const failure of ["error", "abort", "incomplete"] as const) {
    for (const afterUsage of [false, true]) {
      test(`native ${method}: ${failure} ${afterUsage ? "after" : "before"} usage is unknown`, opts, async () => {
        const controller = new AbortController();
        const chunks = [textChunk, ...(afterUsage ? [usageChunk(usage(9))] : [])];
        if (failure === "error") chunks.push({ error: { message: "synthetic transport failure", type: "offline" } } as any);
        if (failure === "abort") chunks.push(finish);
        const b = body(chunks);
        const records: PolzaUsageRecord[] = [];
        try {
          const s = createPolzaApiStreams((r) => records.push(r))[method](model as any, context as any, {
            apiKey: "offline-placeholder", signal: controller.signal, fetch: async () => b.response,
            onProviderStreamEvent: (chunk: any) => {
              if (failure === "abort" && (afterUsage ? chunk.usage : chunk.choices?.[0]?.delta?.content)) controller.abort();
            },
          });
          assert.equal((await s.result()).stopReason, failure === "abort" ? "aborted" : "error");
          assert.deepEqual(records.map((r) => r.costRub), [null]);
        } finally { b.cleanup(); }
      });
    }
  }

  test(`native ${method}: synchronous caller receives raw chunks in order and snapshot precedes mutation`, opts, async () => {
    const b = body([textChunk, usageChunk(usage(0.1)), finish, usageChunk(usage(0.25))]);
    const seen: unknown[] = [];
    const records: PolzaUsageRecord[] = [];
    try {
      const s = createPolzaApiStreams((r) => records.push(r))[method](model as any, context as any, {
        apiKey: "offline-placeholder", fetch: async () => b.response,
        onProviderStreamEvent: (chunk: any, eventModel) => {
          assert.equal(eventModel, model);
          seen.push(chunk.usage?.cost_rub ?? chunk.choices?.[0]?.finish_reason ?? "text");
          if (chunk.usage) chunk.usage.cost_rub = 999;
        },
      });
      assert.equal((await s.result()).stopReason, "stop");
      assert.deepEqual(seen, ["text", 0.1, "stop", 0.25]);
      assert.deepEqual(records.map((r) => r.costRub), [0.25]);
    } finally { b.cleanup(); }
  });

  test(`native ${method}: async callback awaited, snapshot precedes caller mutation, sink precedes waiting terminal consumer`, opts, async () => {
    const b = body([textChunk, finish, usageChunk(usage(0.25))], "open");
    const records: PolzaUsageRecord[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let entered = false;
    const s = createPolzaApiStreams((r) => records.push(r))[method](model as any, context as any, {
      apiKey: "offline-placeholder", fetch: async () => b.response,
      onProviderStreamEvent: async (chunk: any, callbackModel) => {
        assert.equal(callbackModel, model);
        if (chunk.usage) {
          entered = true;
          chunk.usage.cost_rub = 999;
          chunk.usage.prompt_tokens_details.cached_tokens = 999;
          await gate;
        }
      },
    });
    let settled = false;
    const result = s.result().then((r) => { settled = true; return r; });
    const consumer = (async () => {
      for await (const event of s) if (event.type === "done") assert.deepEqual(records.map((r) => r.costRub), [0.25]);
    })();
    try {
      await tick();
      assert.equal(entered, true);
      assert.equal(settled, false);
      assert.equal(records.length, 0);
      release();
      assert.equal((await result).stopReason, "stop");
      await consumer;
      assert.equal(records[0].cachedTokens, 3, "nested snapshot, not a retained reference");
    } finally { release(); b.cleanup(); }
  });

  for (const asyncThrow of [false, true]) {
    test(`native ${method}: caller ${asyncThrow ? "async rejection" : "sync throw"} fails response, not swallowed`, opts, async () => {
      const b = body([textChunk, finish, usageChunk(usage(1))]);
      const records: PolzaUsageRecord[] = [];
      try {
        const fail = () => { throw new Error("synthetic caller failure"); };
        const s = createPolzaApiStreams((r) => records.push(r))[method](model as any, context as any, {
          apiKey: "offline-placeholder", fetch: async () => b.response,
          onProviderStreamEvent: (chunk: any) => { if (chunk.usage) return asyncThrow ? Promise.reject(new Error("synthetic caller failure")) : fail(); },
        });
        const result = await s.result();
        assert.equal(result.stopReason, "error");
        assert.match(result.errorMessage, /synthetic caller failure/);
        assert.deepEqual(records.map((r) => r.costRub), [null]);
      } finally { b.cleanup(); }
    });
  }

  test(`native ${method}: throwing/rejecting sinks cannot damage successful response`, opts, async () => {
    for (const asyncThrow of [false, true]) {
      const b = body([textChunk, finish, usageChunk(usage(1))]);
      let calls = 0;
      try {
        const s = createPolzaApiStreams(() => {
          calls++;
          if (asyncThrow) return Promise.reject(new Error("synthetic sink failure"));
          throw new Error("synthetic sink failure");
        })[method](model as any, context as any, { apiKey: "offline-placeholder", fetch: async () => b.response });
        assert.equal((await s.result()).stopReason, "stop");
        for await (const event of s) assert.notEqual(event.type, "error");
        await tick();
        assert.equal(calls, 1);
      } finally { b.cleanup(); }
    }
  });
}

test("native completion -> production accumulator/persistence -> requestCompleted TTL refresh before terminal", opts, async () => {
  const accumulator = new PolzaCostAccumulator();
  const persisted: PolzaUsageRecord[] = [];
  let now = 1_000_000;
  let balanceFetches = 0;
  const status = new PolzaStatusController({
    now: () => now,
    setStatus: () => {},
    getSessionCost: () => { const s = accumulator.summary(); return { requests: s.requests, costRub: s.actualCostRub }; },
    fetchBalance: async () => { balanceFetches++; return { amount: 10, available: 10, spentAmount: 0, reservedAmount: 0, currency: "RUB" }; },
  });
  status.activate();
  await tick();
  now += BALANCE_TTL_MS;
  const b = body([textChunk, finish, usageChunk(usage(0.25))], "open");
  try {
    const s = createPolzaApiStreams((r) => {
      accumulator.add(r);
      persisted.push(JSON.parse(JSON.stringify(r)));
      status.requestCompleted();
    }).stream(model as any, context as any, { apiKey: "offline-placeholder", fetch: async () => b.response });
    for await (const event of s) if (event.type === "done") {
      assert.equal(accumulator.summary().actualCostRub, 0.25);
      assert.equal(persisted.length, 1);
      assert.equal(balanceFetches, 2);
    }
    await s.result();
    assert.equal(persisted.length, 1);
  } finally { b.cleanup(); }
});
