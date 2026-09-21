/**
 * Native RUB accounting: usage extraction (SSE/JSON), record building, accumulator.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PolzaCostAccumulator, extractUsageFromBody, extractUsageFromJson, extractUsageFromSse, recordFromUsage, recordsFromEntries, summarizeRecords } from "../.pi/extensions/pi-polza/accounting.ts";

const SSE_BODY = [
  'data: {"id":"x","object":"chat.completion.chunk","choices":[{"delta":{"content":"pong"}}]}',
  "",
  'data: {"id":"x","object":"chat.completion.chunk","choices":[{"delta":{}}],"usage":{"prompt_tokens":23,"completion_tokens":14,"total_tokens":37,"cost_rub":0.00010927,"prompt_tokens_details":{"cached_tokens":8,"cache_write_tokens":0},"completion_tokens_details":{"reasoning_tokens":5}}}',
  "",
  "data: [DONE]",
  "",
].join("\n");

test("extractUsageFromSse keeps the final usage chunk and ignores [DONE]", () => {
  const usage = extractUsageFromSse(SSE_BODY);
  assert.ok(usage);
  assert.equal(usage!.prompt_tokens, 23);
  assert.equal(usage!.cost_rub, 0.00010927);
});

test("extractUsageFromBody handles non-streaming JSON", () => {
  const usage = extractUsageFromBody(JSON.stringify({ usage: { prompt_tokens: 5, completion_tokens: 1, cost_rub: 0.1 } }));
  assert.ok(usage);
  assert.equal(usage!.cost_rub, 0.1);
  assert.equal(extractUsageFromJson("{ not json"), null);
  assert.equal(extractUsageFromBody(""), null);
});

test("recordFromUsage never recomputes cost", () => {
  const record = recordFromUsage("qwen/qwen3.5-9b", { prompt_tokens: 19, completion_tokens: 2, cost_rub: 0.00004203 }, 123);
  assert.equal(record.costRub, 0.00004203);
  assert.equal(record.timestamp, 123);
  assert.equal(record.modelId, "qwen/qwen3.5-9b");
  assert.equal(record.promptTokens, 19);
  assert.equal(record.completionTokens, 2);
});

test("recordFromUsage yields null cost when cost_rub is absent", () => {
  const record = recordFromUsage("x/y", { prompt_tokens: 10, completion_tokens: 1 });
  assert.equal(record.costRub, null);
});

test("accumulator sums multiple requests (multi-turn / tool loop)", () => {
  const accumulator = new PolzaCostAccumulator();
  accumulator.add(recordFromUsage("a/m1", { prompt_tokens: 100, completion_tokens: 10, cost_rub: 0.05 }));
  accumulator.add(recordFromUsage("a/m1", { prompt_tokens: 200, completion_tokens: 20, cost_rub: 0.07 }));
  accumulator.add(recordFromUsage("b/m2", { prompt_tokens: 50, completion_tokens: 5, cost_rub: 0.01 }));

  const summary = accumulator.summary();
  assert.equal(summary.requests, 3);
  assert.equal(summary.promptTokens, 350);
  assert.equal(summary.completionTokens, 35);
  assert.ok(Math.abs(summary.actualCostRub! - 0.13) < 1e-12);

  const m1 = summary.models.find((m) => m.modelId === "a/m1");
  assert.equal(m1?.requests, 2);
  assert.ok(Math.abs(m1!.costRub! - 0.12) < 1e-12);
});

test("summary actual cost is null when no record carried a cost", () => {
  const summary = summarizeRecords([recordFromUsage("x/y", { prompt_tokens: 1, completion_tokens: 1 })]);
  assert.equal(summary.actualCostRub, null);
  assert.equal(summary.models[0]!.costRub, null);
});

test("recordsFromEntries rebuilds only polza-cost custom entries", () => {
  const entries = [
    { type: "message", message: {} },
    { type: "custom", customType: "other", data: { modelId: "ignored" } },
    { type: "custom", customType: "polza-cost", data: recordFromUsage("a/b", { prompt_tokens: 3, completion_tokens: 1, cost_rub: 0.02 }) },
    { type: "custom", customType: "polza-cost", data: { modelId: "c/d", promptTokens: 5, completionTokens: 2, cachedTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, costRub: 0.03, timestamp: 9 } },
  ];
  const records = recordsFromEntries(entries);
  assert.equal(records.length, 2);
  assert.equal(records[0]!.modelId, "a/b");
  assert.equal(records[1]!.modelId, "c/d");
  assert.equal(records[1]!.costRub, 0.03);
});

test("recordsFromEntries ignores malformed data", () => {
  const records = recordsFromEntries([{ type: "custom", customType: "polza-cost", data: { nope: true } }]);
  assert.equal(records.length, 0);
});

test("rebuild from entries is idempotent — reopen never doubles accounting", () => {
  const entries = [
    { type: "custom", customType: "polza-cost", data: { modelId: "a/b", promptTokens: 10, completionTokens: 1, cachedTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, costRub: 0.02, timestamp: 1 } },
    { type: "custom", customType: "polza-cost", data: { modelId: "a/b", promptTokens: 20, completionTokens: 2, cachedTokens: 5, cacheWriteTokens: 0, reasoningTokens: 0, costRub: 0.03, timestamp: 2 } },
  ];
  const accumulator = new PolzaCostAccumulator();
  accumulator.addMany(recordsFromEntries(entries));
  const first = accumulator.summary();

  // simulate session_start on resume: reset then rebuild from the same entries
  accumulator.reset();
  accumulator.addMany(recordsFromEntries(entries));
  const second = accumulator.summary();

  assert.equal(first.requests, 2);
  assert.deepEqual(second, first);
  assert.ok(Math.abs(second.actualCostRub! - 0.05) < 1e-12);
});

test("a response without usage yields no record (dedup safety at the source)", () => {
  assert.equal(extractUsageFromBody('data: {"choices":[]}\n\ndata: [DONE]\n'), null);
  assert.equal(extractUsageFromBody("data: [DONE]\n"), null);
});
