/**
 * Pricing: catalog RUB estimate vs actual billed RUB; no FX anywhere.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { actualCostRub, estimateCatalogCostRub } from "../.pi/extensions/pi-polza/pricing.ts";
import { resolveModel } from "../.pi/extensions/pi-polza/metadata/resolver.ts";
import { normalizeUsage } from "../.pi/extensions/pi-polza/usage.ts";
import { polzaModel } from "./fixtures.ts";

const model = resolveModel(
  polzaModel({
    id: "qwen/qwen3.5-9b",
    contextLength: 32768,
    maxCompletionTokens: 32768,
    promptPerMillion: "1.68100000",
    completionPerMillion: "5.04300000",
    cacheReadPerMillion: null,
    cacheWritePerMillion: null,
  }),
  null,
);

test("catalog estimate matches the live qwen request", () => {
  const usage = normalizeUsage({ prompt_tokens: 19, completion_tokens: 2, total_tokens: 21, cost_rub: 0.00004203 });
  const estimate = estimateCatalogCostRub(model, usage);
  assert.equal(estimate.input, (1.681 * 19) / 1_000_000);
  assert.equal(estimate.output, (5.043 * 2) / 1_000_000);
  assert.equal(estimate.cacheRead, 0);
  assert.equal(estimate.cacheWrite, 0);
  assert.equal(estimate.complete, true);
  assert.ok(Math.abs(estimate.total! - 0.000042025) < 1e-12);
});

test("estimate is incomplete when a needed cache rate is missing", () => {
  const usage = normalizeUsage({
    prompt_tokens: 1000,
    completion_tokens: 10,
    prompt_tokens_details: { cached_tokens: 500 },
  });
  const estimate = estimateCatalogCostRub(model, usage);
  assert.equal(estimate.cacheRead, null); // cache rate unknown -> not fabricated
  assert.equal(estimate.complete, false);
  assert.equal(estimate.total, null);
});

test("actual cost prefers cost_rub and never converts currency", () => {
  const usage = normalizeUsage({ prompt_tokens: 1, completion_tokens: 1, cost_rub: 0.5, cost: 0.4 });
  assert.equal(actualCostRub(usage), 0.5);
});

test("actual cost falls back to raw cost only when cost_rub is absent", () => {
  const usage = normalizeUsage({ prompt_tokens: 1, completion_tokens: 1, cost: 0.4 });
  assert.equal(actualCostRub(usage), 0.4);
});

test("no cost when neither is reported", () => {
  const usage = normalizeUsage({ prompt_tokens: 1, completion_tokens: 1 });
  assert.equal(actualCostRub(usage), null);
});
