/**
 * Native RUB accounting: usage extraction (SSE/JSON), record building, accumulator.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PolzaCostAccumulator, POLZA_COST_SCHEMA_VERSION, coerceRecord, extractUsageFromBody, extractUsageFromJson, extractUsageFromSse, recordFromUsage, recordsFromEntries, summarizeRecords } from "../.pi/extensions/pi-polza/accounting.ts";

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

// --- Schema v2: event identity and attribution ------------------------------------------------

test("recordFromUsage stamps schema v2 and a fresh eventId per observation", () => {
  const first = recordFromUsage("a/b", { prompt_tokens: 1, completion_tokens: 1, cost_rub: 0.01 });
  const second = recordFromUsage("a/b", { prompt_tokens: 1, completion_tokens: 1, cost_rub: 0.01 });

  assert.equal(first.schemaVersion, POLZA_COST_SCHEMA_VERSION);
  assert.equal(typeof first.eventId, "string");
  assert.ok(first.eventId && first.eventId.length > 0);
  // Two genuine observations must not share an identity, even with identical usage and cost.
  assert.notEqual(first.eventId, second.eventId);
});

test("eventId and attribution survive serialize -> coerceRecord round-trip", () => {
  const original = recordFromUsage("a/b", { prompt_tokens: 10, completion_tokens: 2, cost_rub: 0.02 }, 123, {
    eventId: "evt-imported-1",
    agentId: "scout",
    runId: "run-42",
    origin: "background-subagent",
  });
  const serialized = JSON.parse(JSON.stringify(original));

  const restored = coerceRecord(serialized);
  assert.ok(restored);
  assert.equal(restored!.schemaVersion, POLZA_COST_SCHEMA_VERSION);
  assert.equal(restored!.eventId, "evt-imported-1");
  assert.equal(restored!.agentId, "scout");
  assert.equal(restored!.runId, "run-42");
  assert.equal(restored!.origin, "background-subagent");
  assert.equal(restored!.timestamp, 123);
  assert.equal(restored!.costRub, 0.02);
});

test("coerceRecord preserves anomalies written by normalization", () => {
  const restored = coerceRecord({
    modelId: "a/b",
    timestamp: 1,
    promptTokens: 1,
    cachedTokens: 0,
    cacheWriteTokens: 0,
    completionTokens: 1,
    reasoningTokens: 0,
    costRub: null,
    anomalies: ["cost_rub missing"],
  });
  assert.deepEqual(restored!.anomalies, ["cost_rub missing"]);
});

test("recordsFromEntries keeps attribution across a simulated reopen", () => {
  const entries = [
    {
      type: "custom",
      customType: "polza-cost",
      data: {
        schemaVersion: 2,
        eventId: "evt-keep",
        timestamp: 5,
        modelId: "a/b",
        provider: "polza",
        promptTokens: 3,
        cachedTokens: 0,
        cacheWriteTokens: 0,
        completionTokens: 1,
        reasoningTokens: 0,
        costRub: 0.03,
        agentId: "worker",
        runId: "run-7",
        origin: "background-subagent",
      },
    },
  ];
  const records = recordsFromEntries(entries);
  assert.equal(records.length, 1);
  assert.equal(records[0]!.eventId, "evt-keep");
  assert.equal(records[0]!.agentId, "worker");
  assert.equal(records[0]!.runId, "run-7");
  assert.equal(records[0]!.origin, "background-subagent");
});

test("legacy v1 record without eventId still reads and sums as before", () => {
  const records = recordsFromEntries([
    {
      type: "custom",
      customType: "polza-cost",
      data: { modelId: "legacy/m", timestamp: 1, promptTokens: 10, completionTokens: 1, cachedTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, costRub: 0.04 },
    },
  ]);
  assert.equal(records.length, 1);
  assert.equal(records[0]!.eventId, undefined);
  assert.equal(records[0]!.schemaVersion, undefined);
  assert.equal(summarizeRecords(records).actualCostRub, 0.04);
});

// --- Deduplication ----------------------------------------------------------------------------

test("accumulator counts one eventId exactly once across repeated adds", () => {
  const accumulator = new PolzaCostAccumulator();
  const record = recordFromUsage("a/b", { prompt_tokens: 10, completion_tokens: 1, cost_rub: 0.02 }, 1, { eventId: "evt-once" });

  accumulator.add(record);
  accumulator.add(record);
  accumulator.add({ ...record });

  assert.equal(accumulator.all.length, 1);
  const summary = accumulator.summary();
  assert.equal(summary.requests, 1);
  assert.ok(Math.abs(summary.actualCostRub! - 0.02) < 1e-12);
});

test("two different eventIds with identical tokens and cost stay two charges", () => {
  const accumulator = new PolzaCostAccumulator();
  const usage = { prompt_tokens: 100, completion_tokens: 10, cost_rub: 0.05 };
  accumulator.add(recordFromUsage("same/model", usage, 1, { eventId: "evt-a" }));
  accumulator.add(recordFromUsage("same/model", usage, 1, { eventId: "evt-b" }));

  const summary = accumulator.summary();
  assert.equal(summary.requests, 2);
  assert.ok(Math.abs(summary.actualCostRub! - 0.1) < 1e-12);
});

test("legacy records without eventId are never collapsed into one another", () => {
  const accumulator = new PolzaCostAccumulator();
  const legacy = recordFromUsage("a/b", { prompt_tokens: 10, completion_tokens: 1, cost_rub: 0.02 }, 1);
  delete legacy.eventId;
  delete legacy.schemaVersion;

  accumulator.add(legacy);
  accumulator.add({ ...legacy });

  assert.equal(accumulator.all.length, 2);
  assert.ok(Math.abs(accumulator.summary().actualCostRub! - 0.04) < 1e-12);
});

test("reset clears identity index so a rebuild is idempotent", () => {
  const accumulator = new PolzaCostAccumulator();
  const record = recordFromUsage("a/b", { prompt_tokens: 10, completion_tokens: 1, cost_rub: 0.02 }, 1, { eventId: "evt-reopen" });
  accumulator.add(record);
  const first = accumulator.summary();

  accumulator.reset();
  accumulator.add(record);
  assert.deepEqual(accumulator.summary(), first);
});

// --- Coverage counters ------------------------------------------------------------------------

test("pricedRequests and unpricedRequests separate known cost from unknown", () => {
  const summary = summarizeRecords([
    recordFromUsage("a/b", { prompt_tokens: 1, completion_tokens: 1, cost_rub: 0.02 }),
    recordFromUsage("a/b", { prompt_tokens: 1, completion_tokens: 1 }),
    recordFromUsage("a/b", { prompt_tokens: 1, completion_tokens: 1 }),
  ]);

  assert.equal(summary.requests, 3);
  assert.equal(summary.pricedRequests, 1);
  assert.equal(summary.unpricedRequests, 2);
  assert.ok(Math.abs(summary.actualCostRub! - 0.02) < 1e-12);
});

test("an all-unpriced set reports zero priced requests and null cost", () => {
  const summary = summarizeRecords([recordFromUsage("a/b", { prompt_tokens: 1, completion_tokens: 1 })]);
  assert.equal(summary.pricedRequests, 0);
  assert.equal(summary.unpricedRequests, 1);
  assert.equal(summary.actualCostRub, null);
});
