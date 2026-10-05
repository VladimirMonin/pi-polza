/** Mock injection checks wiring/identity only; native transport evidence lives in stream-native. */
import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { createPolzaAccountingStreams } from "../.pi/extensions/pi-polza/stream-accounting.ts";
import type { PolzaUsageRecord } from "../.pi/extensions/pi-polza/accounting.ts";

const originalFetch = globalThis.fetch;
before(() => { globalThis.fetch = async () => { throw new Error("Network fetch forbidden in offline wiring tests"); }; });
after(() => { globalThis.fetch = originalFetch; });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

for (const method of ["stream", "streamSimple"] as const) {
  test(`${method} wiring: original stream/result, callback return, custom fetch and options preserved`, async () => {
    let resolve!: (message: any) => void;
    const result = new Promise<any>((r) => { resolve = r; });
    let resultCalls = 0;
    const original = { result: () => { resultCalls++; return result; }, [Symbol.asyncIterator]: () => { throw new Error("Observer must never consume events"); } };
    const model = { id: "offline/model" };
    const context = { messages: [] };
    const response = new Response("synthetic");
    const input = "https://offline.invalid";
    const init = { method: "POST", body: JSON.stringify({ messages: ["private prompt"], reasoning_effort: "high" }) };
    let fetches = 0;
    const fetch = async (i: any, o: any) => { assert.equal(i, input); assert.equal(o, init); fetches++; return response; };
    const callbackReturn = Promise.resolve();
    let observed = 0;
    let received: any;
    const api = {
      [method]: (m: any, c: any, o: any) => { assert.equal(m, model); assert.equal(c, context); received = o; return original; },
      [method === "stream" ? "streamSimple" : "stream"]: () => { throw new Error("Wrong entry point"); },
    };
    const records: PolzaUsageRecord[] = [];
    const streams = createPolzaAccountingStreams(api as any, (r) => records.push(r));
    const signal = new AbortController().signal;
    const onPayload = () => {};
    const options = { fetch, signal, onPayload, reasoning: "high", temperature: 0.2, onProviderStreamEvent: (d: any, m: any) => {
      assert.equal(m, model); observed++; d.usage.cost_rub = 999; return callbackReturn;
    } };
    const s = streams[method](model as any, context, options as any);
    assert.equal(s, original);
    assert.equal(s.result, original.result);
    assert.equal(resultCalls, 1, "continuation registered before return");
    assert.equal(received.signal, signal);
    assert.equal(received.onPayload, onPayload);
    assert.equal(received.reasoning, "high");
    assert.equal(received.temperature, 0.2);
    assert.equal(await received.fetch(input, init), response, "response is not wrapped/tapped");
    assert.equal(fetches, 1);
    const d = { usage: { cost_rub: 0.25 } };
    assert.equal(received.onProviderStreamEvent(d, model), callbackReturn, "original callback promise, no swallowed errors");
    assert.equal(observed, 1);
    assert.equal(d.usage.cost_rub, 999);
    assert.equal(records.length, 0);
    resolve({ stopReason: "stop" });
    await result;
    assert.deepEqual(records.map((r) => r.costRub), [0.25]);
    assert.equal(s.result(), result);
    await tick();
    assert.equal(records.length, 1);
  });

  test(`${method} wiring: pending/rejected completion and uncloneable usage stay unknown`, async () => {
    for (const terminal of ["pending", "rejected", "uncloneable"] as const) {
      const records: PolzaUsageRecord[] = [];
      let received: any;
      let resolve!: (message: any) => void;
      let reject!: (error: any) => void;
      const result = new Promise<any>((r, e) => { resolve = r; reject = e; });
      const original = { result: () => result };
      const start = (_m: any, _c: any, o: any) => { received = o; return original; };
      const s = createPolzaAccountingStreams({ stream: start, streamSimple: start } as any, (r) => records.push(r))[method]({ id: "offline/model" } as any, { messages: [] });
      received.onProviderStreamEvent({ usage: terminal === "uncloneable" ? { cost_rub: 9, fn: () => {} } : { cost_rub: 9 } }, {});
      if (terminal === "rejected") reject(new Error("synthetic rejected result"));
      else resolve({ stopReason: terminal === "pending" ? "pending" : "stop" });
      await s.result().catch(() => {});
      assert.deepEqual(records.map((r) => r.costRub), [null]);
    }
  });
}

test("reasoning debug output remains opt-in and excludes prompt/header fields", async () => {
  const previous = process.env.POLZA_DEBUG_PAYLOAD;
  const write = process.stderr.write;
  const output: string[] = [];
  let options: any;
  const api = { stream: (_m: any, _c: any, o: any) => { options = o; return { result: () => new Promise(() => {}) }; }, streamSimple: () => { throw new Error("wrong method"); } };
  const init = { body: JSON.stringify({ reasoning_effort: "high", chat_template_kwargs: { enable_thinking: true }, messages: ["private prompt"], headers: { authorization: "private placeholder" } }) };
  try {
    process.stderr.write = ((s: any) => { output.push(String(s)); return true; }) as any;
    process.env.POLZA_DEBUG_PAYLOAD = "1";
    createPolzaAccountingStreams(api as any, () => {}).stream({ id: "x" } as any, { messages: [] }, { fetch: async () => new Response("ok") });
    await options.fetch("https://offline.invalid", init);
    assert.deepEqual(output, ['[polza-payload] {"reasoning_effort":"high","chat_template_kwargs":{"enable_thinking":true}}\n']);
    process.env.POLZA_DEBUG_PAYLOAD = "0";
    await options.fetch("https://offline.invalid", init);
    assert.equal(output.length, 1);
  } finally {
    process.stderr.write = write;
    if (previous === undefined) delete process.env.POLZA_DEBUG_PAYLOAD;
    else process.env.POLZA_DEBUG_PAYLOAD = previous;
  }
});
