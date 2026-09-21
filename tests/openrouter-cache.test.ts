/**
 * Local OpenRouter cache: schema versioning, atomic writes, fresh/stale/none handling.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  OPENROUTER_CACHE_SCHEMA_VERSION,
  OPENROUTER_CACHE_TTL_MS,
  describeCacheState,
  readOpenRouterCache,
  writeOpenRouterCache,
} from "../.pi/extensions/pi-polza/metadata/openrouter-cache.ts";
import type { OpenRouterModel } from "../.pi/extensions/pi-polza/metadata/openrouter.ts";

const MODEL: OpenRouterModel = { id: "vendor/model" };
const dir = mkdtempSync(join(tmpdir(), "polza-or-cache-"));
const file = join(dir, "openrouter.json");

test("write then read round-trips with schemaVersion and fetchedAt", () => {
  assert.equal(writeOpenRouterCache([MODEL], { file, now: 1_000 }), true);
  const raw = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(raw.schemaVersion, OPENROUTER_CACHE_SCHEMA_VERSION);
  assert.equal(raw.fetchedAt, 1_000);

  const loaded = readOpenRouterCache({ file, now: 5_000 });
  assert.equal(loaded?.models.length, 1);
  assert.equal(loaded?.fetchedAt, 1_000);
  assert.equal(loaded?.ageMs, 4_000);
});

test("missing cache reports none", () => {
  assert.equal(readOpenRouterCache({ file: join(dir, "absent.json") }), null);
  assert.equal(describeCacheState(null), "none");
});

test("schema mismatch is ignored and the old file is preserved", () => {
  const oldFile = join(dir, "old.json");
  writeFileSync(oldFile, JSON.stringify({ schemaVersion: 0, fetchedAt: 1, models: [MODEL] }));
  assert.equal(readOpenRouterCache({ file: oldFile }), null);
  // not deleted
  assert.equal(JSON.parse(readFileSync(oldFile, "utf8")).schemaVersion, 0);
});

test("corrupt cache is ignored and preserved", () => {
  const badFile = join(dir, "bad.json");
  writeFileSync(badFile, "{ not json");
  assert.equal(readOpenRouterCache({ file: badFile }), null);
  assert.equal(readFileSync(badFile, "utf8"), "{ not json");
});

test("fresh vs stale uses the TTL", () => {
  writeOpenRouterCache([MODEL], { file, now: 10_000 });
  const cache = readOpenRouterCache({ file, now: 10_000 })!;
  assert.equal(describeCacheState(cache, 10_000), "fresh");
  assert.equal(describeCacheState(cache, 10_000 + OPENROUTER_CACHE_TTL_MS), "stale");
});

test("empty model list is treated as no cache", () => {
  const emptyFile = join(dir, "empty.json");
  writeFileSync(emptyFile, JSON.stringify({ schemaVersion: OPENROUTER_CACHE_SCHEMA_VERSION, fetchedAt: 1, models: [] }));
  assert.equal(readOpenRouterCache({ file: emptyFile }), null);
});
