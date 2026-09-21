/**
 * Import accounting written by a completed background child into the root session.
 *
 * A background child runs in a detached process with its own `pi-polza` instance, so its billed
 * responses land in its own session JSONL instead of the parent's. This module reads that file
 * read-only, keeps only records that carry a stable monetary identity, and copies them into the
 * root session so the total survives the child's temporary artifacts.
 *
 * Legacy records without an `eventId` are deliberately NOT imported: the same copied history would
 * be indistinguishable from new spend. Only the current schema with an identity is trusted.
 */
import { readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import {
  POLZA_COST_ENTRY,
  POLZA_COST_SCHEMA_VERSION,
  coerceRecord,
  type PolzaCostAccumulator,
  type PolzaUsageRecord,
} from "../accounting.ts";

/** Roots a child session file may live under. Anything else is refused unread. */
const ALLOWED_ROOTS = [resolve(join(homedir(), ".pi", "agent")), resolve(tmpdir())];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Accept only an absolute `.jsonl` path inside a known session root.
 *
 * Child identity comes from runtime metadata, but a mis-reported or hostile path must never turn
 * this reader into an arbitrary-file reader, so containment is checked before any I/O.
 */
export function isAllowedChildSessionPath(candidate: string): boolean {
  if (typeof candidate !== "string") return false;
  const raw = candidate.trim();
  if (!raw) return false;
  if (!isAbsolute(raw)) return false;
  if (raw.split(/[\\/]/).includes("..")) return false;

  const resolved = resolve(raw).toLowerCase();
  if (!resolved.endsWith(".jsonl")) return false;

  return ALLOWED_ROOTS.some((root) => {
    const rootLower = root.toLowerCase();
    return resolved === rootLower || resolved.startsWith(rootLower + sep);
  });
}

/** Parse a child session JSONL body, skipping blank, broken and unfinished lines. */
function parseChildRecords(text: string): PolzaUsageRecord[] {
  const out: PolzaUsageRecord[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // A trailing partial line (the child may still be flushing) or a corrupt line: skip it
      // rather than fabricating a zero-cost record.
      continue;
    }
    if (!isRecord(parsed)) continue;
    if (parsed.customType !== POLZA_COST_ENTRY) continue;
    const record = coerceRecord(parsed.data);
    if (record) out.push(record);
  }
  return out;
}

/** Read `polza-cost` records from one child session file. Pure reader; never throws. */
export function readChildRecords(sessionPath: string): PolzaUsageRecord[] {
  try {
    return parseChildRecords(readFileSync(sessionPath, "utf8"));
  } catch {
    return [];
  }
}

export interface ImportChildOptions {
  sessionPath: string;
  runId: string;
  agent?: string;
  accumulator: PolzaCostAccumulator;
  appendEntry: (record: PolzaUsageRecord) => void;
}

export interface ImportChildResult {
  imported: number;
  skippedDuplicate: number;
  skippedLegacy: number;
  /** The child log was missing, unreadable or the path was refused. */
  unavailable: boolean;
}

/**
 * Reconcile one completed background child into the root accounting.
 *
 * Already-known `eventId`s are skipped, so a repeated completion notification, a reopen or a fork
 * cannot add the same spend twice. New records are persisted to the root session before they join
 * the in-memory accumulator, and the child's own identity is preserved verbatim.
 */
export function importChildAccounting(options: ImportChildOptions): ImportChildResult {
  const result: ImportChildResult = {
    imported: 0,
    skippedDuplicate: 0,
    skippedLegacy: 0,
    unavailable: false,
  };

  if (!isAllowedChildSessionPath(options.sessionPath)) {
    result.unavailable = true;
    return result;
  }

  let text: string;
  try {
    text = readFileSync(options.sessionPath, "utf8");
  } catch {
    // Missing or unreadable child log: the total stays incomplete, never guessed.
    result.unavailable = true;
    return result;
  }

  for (const record of parseChildRecords(text)) {
    if (record.schemaVersion !== POLZA_COST_SCHEMA_VERSION || !record.eventId) {
      result.skippedLegacy += 1;
      continue;
    }
    if (options.accumulator.hasEventId(record.eventId)) {
      result.skippedDuplicate += 1;
      continue;
    }

    const enriched: PolzaUsageRecord = { ...record, runId: options.runId, origin: "background-subagent" };
    if (options.agent) enriched.agentId = options.agent;

    // Persist first so the spend is durable even if the child's temporary file disappears.
    try {
      options.appendEntry(enriched);
    } catch {
      // No active session (e.g. ephemeral mode) — keep the runtime record only.
    }
    options.accumulator.add(enriched);
    result.imported += 1;
  }

  return result;
}
