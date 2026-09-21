/**
 * Tests for the incremental, transparent response tap (no network, no money).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { SseUsageScanner, extractUsageFromSse } from "../.pi/extensions/pi-polza/accounting.ts";
import { tapResponseForUsage } from "../.pi/extensions/pi-polza/tap.ts";
import type { RawUsageLike } from "../.pi/extensions/pi-polza/usage.ts";

const encoder = new TextEncoder();

function sse(payloads: string[], contentType = "text/event-stream"): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const payload of payloads) controller.enqueue(encoder.encode(payload));
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": contentType } });
}

const USAGE = `{"prompt_tokens":10,"completion_tokens":2,"cost_rub":0.000123}`;
const USAGE_LINE = `data: {"choices":[],"usage":${USAGE}}`;

test("SseUsageScanner keeps only the last usage chunk", () => {
  const scanner = new SseUsageScanner();
  scanner.push("data: {\"usage\":{\"cost_rub\":1}}\n");
  scanner.push("data: {\"usage\":{\"cost_rub\":2}}\n");
  scanner.push("data: [DONE]\n");
  assert.equal((scanner.flush() as { cost_rub: number }).cost_rub, 2);
});

test("SseUsageScanner handles CRLF, keep-alives and a partial trailing line", () => {
  const scanner = new SseUsageScanner();
  scanner.push(": keep-alive\r\n");
  scanner.push(`${USAGE_LINE}\r`);
  scanner.push("\n");
  scanner.push("data: [DONE]");
  assert.equal((scanner.flush() as { cost_rub: number }).cost_rub, 0.000123);
  assert.equal(extractUsageFromSse(`${USAGE_LINE}\n`).cost_rub, 0.000123);
});

test("tap: SSE usage is reported exactly once, chunks pass through byte-identical", async () => {
  const seen: RawUsageLike[] = [];
  let done = 0;
  const chunks = ['data: {"choices":[{"delta":{"content":"hi"}}]}\n\n', `${USAGE_LINE}\n\n`, "data: [DONE]\n\n"];
  const tapped = tapResponseForUsage(sse(chunks), { onUsage: (u) => seen.push(u), onDone: () => done++ });

  const text = await tapped.text();

  assert.equal(seen.length, 1);
  assert.equal((seen[0] as { cost_rub: number }).cost_rub, 0.000123);
  assert.equal(done, 1);
  assert.equal(text, chunks.join(""), "body must be forwarded unchanged");
});

test("tap: does not report before the body has produced usage, and TTFT is not delayed", async () => {
  const seen: RawUsageLike[] = [];
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"first"}}]}\n\n'));
      // deliberately not closed yet: TTFT must be observable now
    },
  });
  const tapped = tapResponseForUsage(new Response(stream, { headers: { "content-type": "text/event-stream" } }), {
    onUsage: (u) => seen.push(u),
  });

  const reader = tapped.body!.getReader();
  const first = await reader.read();
  assert.equal(first.done, false);
  assert.ok(decoderText(first.value!).includes("first"), "first chunk must arrive before completion");
  assert.equal(seen.length, 0, "usage must not be reported before the usage chunk");
  await reader.cancel();
});

test("tap: non-SSE JSON body is parsed at completion", async () => {
  const seen: RawUsageLike[] = [];
  const body = JSON.stringify({ choices: [], usage: { prompt_tokens: 1, cost_rub: 0.5 } });
  const tapped = tapResponseForUsage(sse([body], "application/json"), { onUsage: (u) => seen.push(u) });
  await tapped.text();
  assert.equal(seen.length, 1);
  assert.equal((seen[0] as { cost_rub: number }).cost_rub, 0.5);
});

test("tap: response without usage reports nothing and still completes", async () => {
  const seen: RawUsageLike[] = [];
  let done = 0;
  const tapped = tapResponseForUsage(sse(['data: {"choices":[]}\n\n', "data: [DONE]\n\n"]), {
    onUsage: (u) => seen.push(u),
    onDone: () => done++,
  });
  await tapped.text();
  assert.equal(seen.length, 0);
  assert.equal(done, 1);
});

test("tap: multibyte characters split across chunk boundaries are not corrupted", async () => {
  const payload = `data: {"choices":[{"delta":{"content":"привет"}}]}\n\n`;
  const bytes = encoder.encode(payload);
  const splitAt = bytes.indexOf(0xd0) + 1; // inside a 2-byte Cyrillic sequence
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, splitAt));
      controller.enqueue(bytes.slice(splitAt));
      controller.close();
    },
  });
  const tapped = tapResponseForUsage(new Response(stream, { headers: { "content-type": "text/event-stream" } }), {
    onUsage: () => {},
  });
  const text = await tapped.text();
  assert.equal(text, payload);
});

test("tap: response without body is returned as-is", () => {
  const response = new Response(null, { status: 204 });
  const tapped = tapResponseForUsage(response, { onUsage: () => {} });
  assert.equal(tapped, response);
});

function decoderText(chunk: Uint8Array): string {
  return new TextDecoder().decode(chunk);
}
