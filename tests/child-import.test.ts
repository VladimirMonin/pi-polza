/**
 * Background child accounting import: path containment, schema filtering, dedup, attribution.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PolzaCostAccumulator, POLZA_COST_ENTRY } from "../.pi/extensions/pi-polza/accounting.ts";
import {
  importChildAccounting,
  isAllowedChildSessionPath,
  readChildRecords,
} from "../.pi/extensions/pi-polza/integrations/child-import.ts";

function withTempDir<T>(run: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "polza-child-import-"));
  try {
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

interface ChildRecordOverrides {
  eventId?: string | null;
  schemaVersion?: number | null;
  costRub?: number | null;
  modelId?: string;
}

/** One `polza-cost` session entry as a child would append it. */
function childEntry(overrides: ChildRecordOverrides = {}): string {
  const data: Record<string, unknown> = {
    timestamp: 1789989126500,
    modelId: overrides.modelId ?? "openai/gpt-oss-20b",
    provider: "polza",
    promptTokens: 2737,
    cachedTokens: 0,
    cacheWriteTokens: 0,
    completionTokens: 214,
    reasoningTokens: 189,
    costRub: overrides.costRub === undefined ? 0.01318728 : overrides.costRub,
  };
  const schemaVersion = overrides.schemaVersion === undefined ? 2 : overrides.schemaVersion;
  if (schemaVersion !== null) data.schemaVersion = schemaVersion;
  const eventId = overrides.eventId === undefined ? "evt-child-1" : overrides.eventId;
  if (eventId !== null) data.eventId = eventId;
  return JSON.stringify({ type: "custom", customType: POLZA_COST_ENTRY, data, id: "entry-1", parentId: null, timestamp: 1 });
}

function writeChild(dir: string, name: string, lines: string[]): string {
  const path = join(dir, name);
  writeFileSync(path, lines.join("\n"), "utf8");
  return path;
}

function importing(sessionPath: string, accumulator: PolzaCostAccumulator, agent?: string) {
  const appended: unknown[] = [];
  const result = importChildAccounting({
    sessionPath,
    runId: "run-1",
    agent,
    accumulator,
    appendEntry: (record) => appended.push(record),
  });
  return { result, appended };
}

test("imports v2 child records and preserves the child's eventId", () => {
  withTempDir((dir) => {
    const path = writeChild(dir, "session.jsonl", [childEntry({ eventId: "evt-a" }), childEntry({ eventId: "evt-b", costRub: 0.02 })]);
    const accumulator = new PolzaCostAccumulator();

    const { result, appended } = importing(path, accumulator, "scout");

    assert.equal(result.imported, 2);
    assert.equal(result.skippedDuplicate, 0);
    assert.equal(result.skippedLegacy, 0);
    assert.equal(result.unavailable, false);
    assert.equal(appended.length, 2);

    const ids = accumulator.all.map((record) => record.eventId).sort();
    assert.deepEqual(ids, ["evt-a", "evt-b"]);
    assert.ok(Math.abs(accumulator.summary().actualCostRub! - 0.03318728) < 1e-12);
  });
});

test("imported records carry runId, origin and the reported agent", () => {
  withTempDir((dir) => {
    const path = writeChild(dir, "session.jsonl", [childEntry({ eventId: "evt-a" })]);
    const accumulator = new PolzaCostAccumulator();

    importing(path, accumulator, "scout");

    const record = accumulator.all[0];
    assert.equal(record.runId, "run-1");
    assert.equal(record.origin, "background-subagent");
    assert.equal(record.agentId, "scout");
  });
});

test("omits agentId when the runtime reported no agent", () => {
  withTempDir((dir) => {
    const path = writeChild(dir, "session.jsonl", [childEntry({ eventId: "evt-a" })]);
    const accumulator = new PolzaCostAccumulator();

    const { result } = importing(path, accumulator);

    assert.equal(result.imported, 1);
    assert.equal(accumulator.all[0].agentId, undefined);
    assert.equal(accumulator.all[0].runId, "run-1");
  });
});

test("re-importing the same child does not add spend twice", () => {
  withTempDir((dir) => {
    const path = writeChild(dir, "session.jsonl", [childEntry({ eventId: "evt-a" }), childEntry({ eventId: "evt-b", costRub: 0.02 })]);
    const accumulator = new PolzaCostAccumulator();

    importing(path, accumulator, "scout");
    const first = accumulator.summary();

    const { result, appended } = importing(path, accumulator, "scout");

    assert.equal(result.imported, 0);
    assert.equal(result.skippedDuplicate, 2);
    assert.equal(appended.length, 0);
    assert.deepEqual(accumulator.summary(), first);
  });
});

test("legacy child records without eventId are skipped, not imported", () => {
  withTempDir((dir) => {
    const path = writeChild(dir, "session.jsonl", [
      childEntry({ eventId: null }),
      childEntry({ eventId: null, schemaVersion: null, costRub: 0.05 }),
      childEntry({ eventId: "evt-new" }),
    ]);
    const accumulator = new PolzaCostAccumulator();

    const { result } = importing(path, accumulator, "scout");

    assert.equal(result.skippedLegacy, 2);
    assert.equal(result.imported, 1);
    assert.equal(accumulator.all.length, 1);
    assert.equal(accumulator.all[0].eventId, "evt-new");
  });
});

test("two distinct requests with identical tokens and cost are both imported", () => {
  withTempDir((dir) => {
    const path = writeChild(dir, "session.jsonl", [childEntry({ eventId: "evt-a" }), childEntry({ eventId: "evt-b" })]);
    const accumulator = new PolzaCostAccumulator();

    const { result } = importing(path, accumulator, "scout");

    assert.equal(result.imported, 2);
    assert.equal(result.skippedDuplicate, 0);
    assert.ok(Math.abs(accumulator.summary().actualCostRub! - 0.02637456) < 1e-12);
  });
});

test("a missing child file reports unavailable without throwing", () => {
  withTempDir((dir) => {
    const accumulator = new PolzaCostAccumulator();

    const { result } = importing(join(dir, "does-not-exist.jsonl"), accumulator, "scout");

    assert.equal(result.unavailable, true);
    assert.equal(result.imported, 0);
    assert.equal(accumulator.all.length, 0);
  });
});

test("a truncated trailing line is skipped while complete records still import", () => {
  withTempDir((dir) => {
    const truncated = '{"type":"custom","customType":"polza-cost","data":{"modelId":"x/y","cos';
    const path = writeChild(dir, "session.jsonl", [childEntry({ eventId: "evt-a" }), truncated]);
    const accumulator = new PolzaCostAccumulator();

    const { result } = importing(path, accumulator, "scout");

    assert.equal(result.imported, 1);
    assert.equal(result.unavailable, false);
    assert.equal(accumulator.all.length, 1);
    assert.equal(accumulator.all[0].eventId, "evt-a");
  });
});

test("a corrupt complete line does not abort the rest of the file", () => {
  withTempDir((dir) => {
    const path = writeChild(dir, "session.jsonl", [childEntry({ eventId: "evt-a" }), "{ definitely not json }", childEntry({ eventId: "evt-b" })]);
    const accumulator = new PolzaCostAccumulator();

    const { result } = importing(path, accumulator, "scout");

    assert.equal(result.imported, 2);
    assert.deepEqual(accumulator.all.map((record) => record.eventId), ["evt-a", "evt-b"]);
  });
});

test("non polza-cost entries in the child log are ignored", () => {
  withTempDir((dir) => {
    const message = JSON.stringify({ type: "message", id: "m1", content: "hello" });
    const otherCustom = JSON.stringify({ type: "custom", customType: "other-plugin", data: { costRub: 99 } });
    const path = writeChild(dir, "session.jsonl", [message, otherCustom, childEntry({ eventId: "evt-a" })]);
    const accumulator = new PolzaCostAccumulator();

    const { result } = importing(path, accumulator, "scout");

    assert.equal(result.imported, 1);
    assert.equal(result.skippedLegacy, 0);
  });
});

test("readChildRecords is a pure reader that returns records without side effects", () => {
  withTempDir((dir) => {
    const path = writeChild(dir, "session.jsonl", [childEntry({ eventId: "evt-a" })]);

    const records = readChildRecords(path);

    assert.equal(records.length, 1);
    assert.equal(records[0].eventId, "evt-a");
    assert.equal(readChildRecords(join(dir, "absent.jsonl")).length, 0);
  });
});

// --- Path containment -------------------------------------------------------------------------

test("refuses paths outside the known session roots", () => {
  assert.equal(isAllowedChildSessionPath("C:\\Windows\\System32\\evil.jsonl"), false);
  assert.equal(isAllowedChildSessionPath("/etc/passwd.jsonl"), false);
  assert.equal(isAllowedChildSessionPath("relative/session.jsonl"), false);
  assert.equal(isAllowedChildSessionPath(""), false);
  assert.equal(isAllowedChildSessionPath("C:\\PY\\pi-polza-connection-plugin\\session.jsonl"), false);
});

test("refuses traversal and non-jsonl paths", () => {
  const insideRoot = join(tmpdir(), "session.jsonl");
  assert.equal(isAllowedChildSessionPath(insideRoot), true);
  assert.equal(isAllowedChildSessionPath(join(tmpdir(), "..", "..", "Windows", "evil.jsonl")), false);
  assert.equal(isAllowedChildSessionPath(join(tmpdir(), "session.txt")), false);
});

test("refuses an outside path without reading it", () => {
  const accumulator = new PolzaCostAccumulator();
  const appended: unknown[] = [];

  const result = importChildAccounting({
    sessionPath: "C:\\Windows\\System32\\drivers\\etc\\hosts.jsonl",
    runId: "run-1",
    accumulator,
    appendEntry: (record) => appended.push(record),
  });

  assert.equal(result.unavailable, true);
  assert.equal(result.imported, 0);
  assert.equal(appended.length, 0);
  assert.equal(accumulator.all.length, 0);
});

test("refuses a directory masquerading as a session file", () => {
  withTempDir((dir) => {
    const accumulator = new PolzaCostAccumulator();

    const { result } = importing(dir, accumulator, "scout");

    assert.equal(result.unavailable, true);
    assert.equal(accumulator.all.length, 0);
  });
});
