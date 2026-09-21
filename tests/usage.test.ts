/**
 * Cache accounting must not be broken: `prompt_tokens` is the full input and `cached_tokens`
 * is a part of it. Never add them together.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeUsage, type RawUsageLike } from "../.pi/extensions/pi-polza/usage.ts";

test("cached_tokens is part of prompt_tokens, not additional", () => {
  // Real shape observed live from openai/gpt-5-nano request 2.
  const raw: RawUsageLike = {
    prompt_tokens: 4026,
    completion_tokens: 0,
    total_tokens: 4026,
    prompt_tokens_details: { cached_tokens: 3968, cache_write_tokens: 0 },
    completion_tokens_details: { reasoning_tokens: 0 },
    cost_rub: 0.00267582,
  };
  const usage = normalizeUsage(raw);
  assert.equal(usage.promptTotal, 4026);
  assert.equal(usage.cacheRead, 3968);
  assert.equal(usage.input, 58); // 4026 - 3968
  assert.equal(usage.totalTokens, 4026 + 0 + 0); // input + output + cacheRead + cacheWrite
  assert.equal(usage.costRub, 0.00267582);
  assert.deepEqual(usage.anomalies, []);
});

test("reasoning_tokens is a detail of output, not additive", () => {
  const usage = normalizeUsage({
    prompt_tokens: 10,
    completion_tokens: 100,
    completion_tokens_details: { reasoning_tokens: 80 },
  });
  assert.equal(usage.output, 100);
  assert.equal(usage.reasoning, 80);
  assert.equal(usage.totalTokens, 10 + 100);
});

test("cacheWrite is subtracted from input too", () => {
  const usage = normalizeUsage({
    prompt_tokens: 100,
    completion_tokens: 5,
    prompt_tokens_details: { cached_tokens: 20, cache_write_tokens: 30 },
  });
  assert.equal(usage.input, 50);
  assert.equal(usage.cacheRead, 20);
  assert.equal(usage.cacheWrite, 30);
});

test("anomaly is reported when cache counters exceed prompt_tokens (no negative input)", () => {
  const usage = normalizeUsage({
    prompt_tokens: 10,
    prompt_tokens_details: { cached_tokens: 8, cache_write_tokens: 7 },
  });
  assert.equal(usage.input, 0);
  assert.equal(usage.anomalies.length, 1);
  assert.match(usage.anomalies[0]!, /cacheRead\(8\) \+ cacheWrite\(7\) > prompt_tokens\(10\)/);
});

test("total_tokens mismatch is reported and computed total is used", () => {
  const usage = normalizeUsage({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 999 });
  assert.equal(usage.totalTokens, 15);
  assert.equal(usage.anomalies.length, 1);
});

test("missing cost_rub stays null and never becomes 0", () => {
  const usage = normalizeUsage({ prompt_tokens: 1, completion_tokens: 1 });
  assert.equal(usage.costRub, null);
  assert.equal(usage.costRaw, null);
});

test("decimal-string costs are parsed", () => {
  const usage = normalizeUsage({ cost_rub: "0.02368697" } as RawUsageLike);
  assert.equal(usage.costRub, 0.02368697);
});
