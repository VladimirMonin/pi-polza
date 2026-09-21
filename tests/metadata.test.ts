/**
 * Metadata resolution: Polza priority, OpenRouter enrichment, provenance, conflicts, unknown.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolveModel, resolveModels } from "../.pi/extensions/pi-polza/metadata/resolver.ts";
import type { PolzaCatalogModel } from "../.pi/extensions/pi-polza/types.ts";
import type { OpenRouterModel } from "../.pi/extensions/pi-polza/metadata/openrouter.ts";
import { openRouterModel, polzaModel } from "./fixtures.ts";

function readJson(relative: string): unknown {
  return JSON.parse(readFileSync(new URL(relative, import.meta.url), "utf8"));
}

test("Polza complete: OpenRouter never replaces Polza values", () => {
  const polza = polzaModel({
    id: "vendor/complete",
    contextLength: 1000,
    maxCompletionTokens: 100,
    supportedParameters: ["tools", "reasoning"],
  });
  const or = openRouterModel({
    id: "vendor/complete",
    contextLength: 2000, // different on purpose
    maxCompletionTokens: 200, // different on purpose
    supportedParameters: ["max_tokens"], // declares no tools on purpose
  });

  const resolved = resolveModel(polza, or);

  assert.equal(resolved.limits.contextWindow.value, 1000);
  assert.equal(resolved.limits.contextWindow.source, "polza");
  assert.equal(resolved.limits.maxCompletionTokens.value, 100);
  assert.equal(resolved.limits.maxCompletionTokens.source, "polza");
  // Polza is positive-only: absence of "tools" in Polza's own list is unknown; here it is present.
  assert.equal(resolved.capabilities.tools.value, true);
  assert.equal(resolved.capabilities.tools.source, "polza");
  assert.equal(resolved.capabilities.reasoning.value, true);

  // Conflicts are recorded even though Polza wins.
  const fields = resolved.conflicts.map((c) => c.field);
  assert.ok(fields.includes("contextWindow"));
  assert.ok(fields.includes("maxCompletionTokens"));
  assert.ok(fields.includes("supportsTools"));
});

test("Polza incomplete: missing values are taken from OpenRouter", () => {
  const polza = polzaModel({
    id: "vendor/incomplete",
    contextLength: null,
    maxCompletionTokens: null,
    inputModalities: [], // Polza silent -> OpenRouter provides modalities
    supportedParameters: ["max_tokens"], // sparse list -> capabilities unknown, not false
  });
  const or = openRouterModel({
    id: "vendor/incomplete",
    contextLength: 8192,
    maxCompletionTokens: 4096,
    inputModalities: ["text", "image"],
    supportedParameters: ["tools", "tool_choice", "reasoning"],
  });

  const resolved = resolveModel(polza, or);

  assert.equal(resolved.limits.contextWindow.value, 8192);
  assert.equal(resolved.limits.contextWindow.source, "openrouter");
  assert.equal(resolved.limits.maxCompletionTokens.value, 4096);
  assert.equal(resolved.limits.maxCompletionTokens.source, "openrouter");
  assert.equal(resolved.capabilities.tools.value, true);
  assert.equal(resolved.capabilities.tools.source, "openrouter");
  assert.equal(resolved.capabilities.reasoning.value, true);
  assert.equal(resolved.modalities.input.source, "openrouter");
  assert.equal(resolved.capabilities.vision.value, true);
  assert.deepEqual(resolved.conflicts, []);
});

test("Polza sparse capability list is not an authoritative negative", () => {
  const polza = polzaModel({
    id: "vendor/sparse",
    contextLength: 100,
    maxCompletionTokens: 10,
    supportedParameters: ["max_tokens"],
  });
  const resolved = resolveModel(polza, null);
  assert.equal(resolved.capabilities.tools.value, null);
  assert.equal(resolved.capabilities.tools.source, "unknown");
  assert.equal(resolved.declaredToolSupport, false);
});

test("Unknown when neither source has a value", () => {
  const polza = polzaModel({ id: "vendor/unknown", contextLength: null, maxCompletionTokens: null });
  const resolved = resolveModel(polza, openRouterModel({ id: "vendor/unknown", contextLength: null, maxCompletionTokens: null, supportedParameters: null }));

  assert.equal(resolved.limits.contextWindow.value, null);
  assert.equal(resolved.limits.contextWindow.source, "unknown");
  assert.equal(resolved.limits.maxCompletionTokens.value, null);
  assert.equal(resolved.capabilities.tools.value, null);
  assert.equal(resolved.piEligibility.eligible, false);
  assert.ok(resolved.piEligibility.reasons.includes("missing_context_window"));
  assert.ok(resolved.piEligibility.reasons.includes("missing_max_completion_tokens"));
});

test("Fake chat embedding is rejected", () => {
  const polza = polzaModel({
    id: "baai/bge-base-en-v1.5",
    contextLength: 512,
    maxCompletionTokens: 460,
    outputModalities: ["embeddings"],
  });
  const resolved = resolveModel(polza, null);
  assert.equal(resolved.piEligibility.eligible, false);
  assert.ok(resolved.piEligibility.reasons.includes("embeddings_only"));
  assert.ok(resolved.piEligibility.reasons.includes("unsupported_output_modality"));
});

test("Explicit verified override wins over Polza and OpenRouter", () => {
  const polza = polzaModel({ id: "vendor/override", contextLength: 1000, maxCompletionTokens: 100 });
  const or = openRouterModel({ id: "vendor/override", contextLength: 9000, maxCompletionTokens: 3000 });
  const resolved = resolveModel(polza, or, { overrides: { contextWindow: 4096, maxCompletionTokens: 2048 } });

  assert.equal(resolved.limits.contextWindow.value, 4096);
  assert.equal(resolved.limits.contextWindow.source, "override");
  assert.equal(resolved.limits.maxCompletionTokens.value, 2048);
  assert.equal(resolved.limits.maxCompletionTokens.source, "override");
  // The Polza/OpenRouter disagreement is still recorded.
  assert.ok(resolved.conflicts.some((c) => c.field === "contextWindow"));
});

test("Override applies to a single field only", () => {
  const polza = polzaModel({ id: "vendor/surgical", contextLength: 1000, maxCompletionTokens: 100 });
  const resolved = resolveModel(polza, null, { overrides: { maxCompletionTokens: 512 } });
  assert.equal(resolved.limits.contextWindow.source, "polza");
  assert.equal(resolved.limits.maxCompletionTokens.value, 512);
  assert.equal(resolved.limits.maxCompletionTokens.source, "override");
});

test("Missing modalities produce dedicated reasons, not unsupported_by_pi", () => {
  const polza = polzaModel({
    id: "vendor/nomodal",
    contextLength: 1000,
    maxCompletionTokens: 100,
    inputModalities: [],
    outputModalities: [],
  });
  const resolved = resolveModel(polza, null);
  assert.ok(resolved.piEligibility.reasons.includes("missing_input_modalities"));
  assert.ok(resolved.piEligibility.reasons.includes("missing_output_modalities"));
  assert.ok(!resolved.piEligibility.reasons.includes("unsupported_by_pi"));
});

test("verified tool support is unknown until a real tool loop confirms it", () => {
  const polza = polzaModel({ id: "vendor/tools", contextLength: 1000, maxCompletionTokens: 100, supportedParameters: ["tools"] });
  const before = resolveModel(polza, null);
  assert.equal(before.declaredToolSupport, true);
  assert.equal(before.verifiedToolSupport, "unknown");

  const after = resolveModel(polza, null, { verifiedToolSupportById: { "vendor/tools": true } });
  assert.equal(after.declaredToolSupport, true);
  assert.equal(after.verifiedToolSupport, true);
});

test("Integration: enrichment recovers limits from OpenRouter snapshots", () => {
  const enrichment = readJson("../artifacts/enrichment-sample.json") as { polzaModels: PolzaCatalogModel[] };
  const orSample = readJson("../artifacts/openrouter-sample.json") as { models: OpenRouterModel[] };
  const byId = new Map(orSample.models.map((m) => [m.id, m]));

  const resolved = resolveModels(enrichment.polzaModels, byId);
  const gemini = resolved.find((r) => r.id === "google/gemini-2.5-flash");
  assert.ok(gemini, "gemini-2.5-flash should be present in the enrichment snapshot");
  assert.equal(gemini.limits.contextWindow.source, "polza");
  assert.equal(gemini.limits.maxCompletionTokens.source, "openrouter");
  assert.equal(gemini.limits.maxCompletionTokens.value, 65535);
  assert.equal(gemini.capabilities.tools.value, true);
  assert.equal(gemini.capabilities.tools.source, "openrouter");
  assert.equal(gemini.piEligibility.eligible, true);

  const gpt52 = resolved.find((r) => r.id === "openai/gpt-5.2");
  assert.ok(gpt52);
  assert.equal(gpt52.limits.maxCompletionTokens.source, "openrouter");
  assert.equal(gpt52.capabilities.tools.value, true);
});

test("Integration: aiesa-mini stays ineligible without invented limits", () => {
  const catalog = readJson("../artifacts/catalog-sample.json") as { models: PolzaCatalogModel[] };
  const resolved = resolveModels(catalog.models, new Map());
  const aiesa = resolved.find((r) => r.id === "aiesa/aiesa-mini");
  assert.ok(aiesa);
  assert.equal(aiesa.limits.contextWindow.value, null);
  assert.equal(aiesa.limits.maxCompletionTokens.value, null);
  assert.equal(aiesa.piEligibility.eligible, false);
});
