/**
 * Mapper: ResolvedModel → Pi ProviderModelConfig, and the pricing rule (RUB is never USD).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PI_COST_POLICY, extractInternalCapabilities, mapInputModalitiesToPi, toProviderModelConfig, toProviderModelConfigs } from "../.pi/extensions/pi-polza/mapper.ts";
import { resolveModel } from "../.pi/extensions/pi-polza/metadata/resolver.ts";
import { openRouterModel, polzaModel } from "./fixtures.ts";

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

test("eligible model projects real limits and zero USD cost", () => {
  const resolved = resolveModel(
    polzaModel({
      id: "google/gemini-2.5-flash",
      contextLength: 1048576,
      maxCompletionTokens: null,
      inputModalities: [], // Polza silent -> image comes from OpenRouter
      supportedParameters: ["max_tokens"],
      promptPerMillion: "5.8835",
      completionPerMillion: "23.534",
    }),
    openRouterModel({ id: "google/gemini-2.5-flash", contextLength: 1048576, maxCompletionTokens: 65535, inputModalities: ["text", "image"], supportedParameters: ["tools", "reasoning"] }),
  );

  const config = toProviderModelConfig(resolved);
  assert.ok(config);
  assert.equal(config.id, "google/gemini-2.5-flash");
  assert.equal(config.contextWindow, 1048576);
  assert.equal(config.maxTokens, 65535);
  assert.deepEqual(config.input, ["text", "image"]);
  assert.equal(config.reasoning, true);
  assert.deepEqual(config.cost, ZERO_COST);

  // RUB catalog price must NOT leak into Pi's USD cost.
  const costNumbers = Object.values(config.cost);
  assert.ok(costNumbers.every((n) => n === 0));
  assert.ok(!costNumbers.includes(5.8835));
  assert.ok(!costNumbers.includes(23.534));
  assert.match(PI_COST_POLICY, /never/i);
});

test("audio/video/file are not exposed as Pi-native input", () => {
  const resolved = resolveModel(
    polzaModel({ id: "amazon/nova-2-lite-v1", contextLength: 1000000, maxCompletionTokens: 65535, inputModalities: ["text", "image", "video", "file"] }),
    null,
  );
  const config = toProviderModelConfig(resolved);
  assert.ok(config);
  assert.deepEqual(config.input, ["text", "image"]);
  assert.deepEqual(extractInternalCapabilities(resolved).internalInputModalities.sort(), ["file", "video"]);
});

test("ineligible model maps to null", () => {
  const resolved = resolveModel(polzaModel({ id: "x/embed", contextLength: 512, maxCompletionTokens: 460, outputModalities: ["embeddings"] }), null);
  assert.equal(toProviderModelConfig(resolved), null);
});

test("model without max output after enrichment maps to null (no placeholder)", () => {
  const resolved = resolveModel(polzaModel({ id: "sber/gigachat", contextLength: 32000, maxCompletionTokens: null }), null);
  assert.equal(resolved.limits.maxCompletionTokens.value, null);
  assert.equal(toProviderModelConfig(resolved), null);
});

test("mapInputModalitiesToPi returns null when nothing is mappable", () => {
  assert.equal(mapInputModalitiesToPi(["audio"]), null);
  assert.equal(mapInputModalitiesToPi(null), null);
  assert.deepEqual(mapInputModalitiesToPi(["text"]), ["text"]);
});

test("toProviderModelConfigs filters ineligible models", () => {
  const good = resolveModel(polzaModel({ id: "a/good", contextLength: 1000, maxCompletionTokens: 100 }), null);
  const bad = resolveModel(polzaModel({ id: "a/bad", contextLength: null, maxCompletionTokens: null }), null);
  const configs = toProviderModelConfigs([good, bad]);
  assert.equal(configs.length, 1);
  assert.equal(configs[0]!.id, "a/good");
});

test("reasoning is only true when declared", () => {
  const noReasoning = resolveModel(polzaModel({ id: "a/plain", contextLength: 1000, maxCompletionTokens: 100, supportedParameters: ["max_tokens"] }), null);
  assert.equal(toProviderModelConfig(noReasoning)?.reasoning, false);
});
