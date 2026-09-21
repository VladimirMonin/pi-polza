/**
 * Override registry: surgical, documented, per-field (no network).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MODEL_OVERRIDES,
  buildOverrideMap,
  overridesFor,
  validateOverrides,
  type ModelOverride,
} from "../.pi/extensions/pi-polza/overrides/models.ts";
import { resolveModels } from "../.pi/extensions/pi-polza/metadata/resolver.ts";
import { polzaModel } from "./fixtures.ts";

const GOOD: ModelOverride = {
  modelId: "vendor/model",
  field: "contextWindow",
  value: 123456,
  reason: "Polza reports a stale window for this model",
  source: "vendor docs 2026-09",
  verifiedAt: "2026-09-21",
};

test("the shipped override list is empty and valid", () => {
  assert.equal(MODEL_OVERRIDES.length, 0);
  assert.deepEqual(validateOverrides(MODEL_OVERRIDES), []);
});

test("validation rejects entries missing provenance", () => {
  const bad: ModelOverride[] = [
    { ...GOOD, reason: "" },
    { ...GOOD, source: "" },
    { ...GOOD, verifiedAt: "" },
    { ...GOOD, modelId: "" },
  ];
  const errors = validateOverrides(bad);
  assert.equal(errors.length, 4);
  assert.ok(errors.some((e) => /reason/.test(e)));
  assert.ok(errors.some((e) => /source/.test(e)));
  assert.ok(errors.some((e) => /verifiedAt/.test(e)));
  assert.ok(errors.some((e) => /modelId/.test(e)));
});

test("override map groups several fields for one model", () => {
  const map = buildOverrideMap([
    GOOD,
    { ...GOOD, field: "maxCompletionTokens", value: 4096 },
    { ...GOOD, modelId: "other/model", field: "supportsTools", value: false },
  ]);
  assert.equal(map.size, 2);
  assert.equal(map.get("vendor/model")?.contextWindow, 123456);
  assert.equal(map.get("vendor/model")?.maxCompletionTokens, 4096);
  assert.equal(map.get("other/model")?.supportsTools, false);
});

test("per-model override applies to exactly one model and wins with source 'override'", () => {
  const models = [
    polzaModel({ id: "a/b", contextLength: 1000, maxCompletionTokens: 100 }),
    polzaModel({ id: "c/d", contextLength: 2000, maxCompletionTokens: 200 }),
  ];
  const resolved = resolveModels(models, new Map(), { overridesById: buildOverrideMap([{ ...GOOD, modelId: "a/b" }]) });

  assert.equal(resolved[0]!.limits.contextWindow.value, 123456);
  assert.equal(resolved[0]!.limits.contextWindow.source, "override");
  assert.equal(resolved[0]!.limits.maxCompletionTokens.value, 100, "other fields untouched");
  assert.equal(resolved[1]!.limits.contextWindow.value, 2000, "other model untouched");
});

test("overridesFor returns only the requested model's entries", () => {
  const list: ModelOverride[] = [GOOD, { ...GOOD, modelId: "other/model", field: "supportsTools", value: true }];
  assert.equal(overridesFor("vendor/model", list).length, 1);
  assert.equal(overridesFor("missing/model", list).length, 0);
});
