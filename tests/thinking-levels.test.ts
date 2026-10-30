/**
 * Catalog-derived thinking-level mapping: only what Polza declares, no guesses (no network).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeSupportedEfforts,
  resolveThinkingLevelMap,
} from "../.pi/extensions/pi-polza/metadata/thinking-levels.ts";

test("normalizeSupportedEfforts lowercases, trims, dedupes and drops unknown/empty", () => {
  assert.deepEqual(normalizeSupportedEfforts(["LOW", "low", "", "bogus", " xhigh "]), ["low", "xhigh"]);
  assert.deepEqual(normalizeSupportedEfforts(["none", "none", "high"]), ["none", "high"]);
  assert.equal(normalizeSupportedEfforts([]), null);
  assert.equal(normalizeSupportedEfforts(["bogus"]), null);
  assert.equal(normalizeSupportedEfforts("low"), null);
  assert.equal(normalizeSupportedEfforts(null), null);
});

test("published list containing xhigh makes xhigh selectable; omitted levels are hidden", () => {
  const map = resolveThinkingLevelMap({
    reasoning: true,
    controlDeclared: true,
    supportedEfforts: ["none", "low", "medium", "high", "xhigh"],
  });
  assert.ok(map);
  assert.equal(map.xhigh, "xhigh");
  assert.equal(map.high, "high");
  assert.equal(map.minimal, null, "not published -> hidden, not guessed");
  assert.equal(map.max, null, "not published -> hidden, not guessed");
  assert.equal(map.off, "none");
});

test("published list without xhigh hides xhigh and max", () => {
  const map = resolveThinkingLevelMap({
    reasoning: true,
    controlDeclared: true,
    supportedEfforts: ["none", "low", "medium", "high"],
  });
  assert.ok(map);
  assert.equal(map.xhigh, null);
  assert.equal(map.max, null);
  assert.equal(map.high, "high");
});

test("off maps to 'none' when published, or to 'off' when the list uses 'off'", () => {
  const withNone = resolveThinkingLevelMap({
    reasoning: true,
    controlDeclared: false,
    supportedEfforts: ["none", "low"],
  });
  assert.equal(withNone?.off, "none");
  const withOff = resolveThinkingLevelMap({
    reasoning: true,
    controlDeclared: false,
    supportedEfforts: ["off", "low"],
  });
  assert.equal(withOff?.off, "off");
});

test("no published list but reasoning_effort declared passes Pi level names through", () => {
  const map = resolveThinkingLevelMap({ reasoning: true, controlDeclared: true, supportedEfforts: null });
  assert.ok(map);
  assert.equal(map.minimal, "minimal");
  assert.equal(map.low, "low");
  assert.equal(map.medium, "medium");
  assert.equal(map.high, "high");
  assert.equal(map.xhigh, "xhigh");
  assert.equal(map.max, "max");
  assert.equal(map.off, null, "off is unconfirmed -> hidden");
});

test("no list and no declared control yields no map at all", () => {
  assert.equal(
    resolveThinkingLevelMap({ reasoning: true, controlDeclared: false, supportedEfforts: null }),
    undefined,
  );
});

test("a non-reasoning model never gets a map, even with a published list", () => {
  assert.equal(
    resolveThinkingLevelMap({
      reasoning: false,
      controlDeclared: true,
      supportedEfforts: ["none", "low", "xhigh"],
    }),
    undefined,
  );
});
