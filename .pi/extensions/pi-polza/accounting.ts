/**
 * Native RUB accounting core (framework-agnostic, unit-testable).
 *
 * Captures Polza's authoritative `usage.cost_rub` per request. The value is NEVER recomputed from
 * tokens × catalog price: if the runtime response lacks it, the record's cost is `null` (unknown).
 */
import { randomUUID } from "node:crypto";
import { normalizeUsage, type RawUsageLike } from "./usage.ts";

/** customType used for `pi.appendEntry` session entries. */
export const POLZA_COST_ENTRY = "polza-cost";

/** Schema version for records that carry a stable monetary event identity. */
export const POLZA_COST_SCHEMA_VERSION = 2;

/** Attribution origin for records imported from a completed background child. */
export type PolzaCostOrigin = "background-subagent";

export interface PolzaUsageRecord {
  /** Absent on legacy v1 records written before event identities existed. */
  schemaVersion?: 2;
  /**
   * Stable identity of ONE observed billed response, generated when the usage is observed and
   * preserved verbatim across import. Never regenerate on read/import: a fork that copies an
   * entry must keep the same id so the copy is not counted as new spend.
   */
  eventId?: string;
  timestamp: number;
  modelId: string;
  provider: "polza";
  /** Full input tokens as reported (`prompt_tokens`). */
  promptTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  /** Authoritative billed cost in native RUB; null = unknown (never recomputed). */
  costRub: number | null;
  /** Subagent attribution, known only when the runtime reported it. */
  agentId?: string;
  /** pi-subagents run identity for imported background spend. */
  runId?: string;
  /** How this record entered the root session; absent for ordinary in-session capture. */
  origin?: PolzaCostOrigin;
  /** Diagnostics from usage normalization, when any. */
  anomalies?: string[];
}

/** Optional attribution/identity passed in when building a record. */
export interface RecordFromUsageOptions {
  /** Reuse an existing identity instead of generating a new one (import and tests). */
  eventId?: string;
  agentId?: string;
  runId?: string;
  origin?: PolzaCostOrigin;
}

/**
 * Build a record from a raw Polza usage object.
 *
 * The `eventId` is generated HERE, at the moment the usage is observed — not at import and not at
 * read time. Callers that already hold an identity (the child importer) pass it in via `options`.
 */
export function recordFromUsage(
  modelId: string,
  raw: RawUsageLike,
  timestamp = Date.now(),
  options?: RecordFromUsageOptions,
): PolzaUsageRecord {
  const usage = normalizeUsage(raw);
  const record: PolzaUsageRecord = {
    schemaVersion: POLZA_COST_SCHEMA_VERSION,
    eventId: options?.eventId ?? randomUUID(),
    timestamp,
    modelId,
    provider: "polza",
    promptTokens: usage.promptTotal,
    cachedTokens: usage.cacheRead,
    cacheWriteTokens: usage.cacheWrite,
    completionTokens: usage.output,
    reasoningTokens: usage.reasoning,
    costRub: usage.costRub,
  };
  if (options?.agentId !== undefined) record.agentId = options.agentId;
  if (options?.runId !== undefined) record.runId = options.runId;
  if (options?.origin !== undefined) record.origin = options.origin;
  if (usage.anomalies.length > 0) record.anomalies = usage.anomalies;
  return record;
}

function isUsageLike(value: unknown): value is RawUsageLike {
  return Boolean(value) && typeof value === "object";
}

/**
 * Incremental SSE usage scanner.
 *
 * Feed decoded text as it arrives; it keeps only the trailing partial line, parses complete
 * `data:` lines, and remembers the LAST chunk carrying `usage` (the final chunk before `[DONE]`).
 * Memory stays bounded by one SSE line, so the full response body is never retained.
 */
export class SseUsageScanner {
  private carry = "";
  private last: RawUsageLike | null = null;

  push(text: string): void {
    if (!text) return;
    this.carry += text;
    let index = this.carry.indexOf("\n");
    while (index !== -1) {
      this.consume(this.carry.slice(0, index));
      this.carry = this.carry.slice(index + 1);
      index = this.carry.indexOf("\n");
    }
  }

  /** Flush the trailing partial line and return the last usage seen (or null). */
  flush(): RawUsageLike | null {
    if (this.carry) {
      this.consume(this.carry);
      this.carry = "";
    }
    return this.last;
  }

  get usage(): RawUsageLike | null {
    return this.last;
  }

  private consume(rawLine: string): void {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    const trimmed = line.trimStart();
    if (!trimmed.startsWith("data:")) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    try {
      const parsed = JSON.parse(payload) as { usage?: unknown };
      if (isUsageLike(parsed.usage)) this.last = parsed.usage;
    } catch {
      // ignore non-JSON keep-alive lines
    }
  }
}

/**
 * Extract the authoritative usage from a streaming SSE body.
 * Scans all `data:` JSON chunks and keeps the LAST one that carries `usage` (the final chunk
 * before `[DONE]`), ignoring the `[DONE]` sentinel.
 */
export function extractUsageFromSse(body: string): RawUsageLike | null {
  const scanner = new SseUsageScanner();
  scanner.push(body);
  return scanner.flush();
}

/** Extract usage from a non-streaming JSON body. */
export function extractUsageFromJson(body: string): RawUsageLike | null {
  try {
    const parsed = JSON.parse(body) as { usage?: unknown };
    return isUsageLike(parsed.usage) ? parsed.usage : null;
  } catch {
    return null;
  }
}

/** Extract usage from either a streaming SSE body or a non-streaming JSON body. */
export function extractUsageFromBody(body: string): RawUsageLike | null {
  return extractUsageFromSse(body) ?? extractUsageFromJson(body);
}

export interface SessionCustomEntryLike {
  type?: string;
  customType?: string;
  data?: unknown;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function coerceRecord(data: unknown): PolzaUsageRecord | null {
  if (!data || typeof data !== "object") return null;
  const value = data as Record<string, unknown>;
  if (typeof value.modelId !== "string") return null;
  const num = (key: string): number => (typeof value[key] === "number" && Number.isFinite(value[key]) ? (value[key] as number) : 0);
  const costRub = typeof value.costRub === "number" && Number.isFinite(value.costRub) ? value.costRub : null;
  const record: PolzaUsageRecord = {
    timestamp: num("timestamp"),
    modelId: value.modelId,
    provider: "polza",
    promptTokens: num("promptTokens"),
    cachedTokens: num("cachedTokens"),
    cacheWriteTokens: num("cacheWriteTokens"),
    completionTokens: num("completionTokens"),
    reasoningTokens: num("reasoningTokens"),
    costRub,
  };

  // Identity and attribution must survive serialize → reopen, or a rebuilt session silently loses
  // per-agent attribution. Legacy v1 records simply have none of these fields.
  if (value.schemaVersion === POLZA_COST_SCHEMA_VERSION) record.schemaVersion = POLZA_COST_SCHEMA_VERSION;
  const eventId = nonEmptyString(value.eventId);
  if (eventId) record.eventId = eventId;
  const agentId = nonEmptyString(value.agentId);
  if (agentId) record.agentId = agentId;
  const runId = nonEmptyString(value.runId);
  if (runId) record.runId = runId;
  if (value.origin === "background-subagent") record.origin = "background-subagent";
  if (Array.isArray(value.anomalies) && value.anomalies.length > 0) {
    const anomalies = value.anomalies.filter((item): item is string => typeof item === "string");
    if (anomalies.length > 0) record.anomalies = anomalies;
  }

  return record;
}

/** Rebuild records from session entries (custom entries written by `pi.appendEntry`). */
export function recordsFromEntries(entries: Iterable<unknown>): PolzaUsageRecord[] {
  const out: PolzaUsageRecord[] = [];
  for (const entry of entries) {
    const candidate = entry as SessionCustomEntryLike | null;
    if (!candidate || candidate.type !== "custom" || candidate.customType !== POLZA_COST_ENTRY) continue;
    const record = coerceRecord(candidate.data);
    if (record) out.push(record);
  }
  return out;
}

export interface ModelCostSummary {
  modelId: string;
  requests: number;
  costRub: number | null;
}

export interface PolzaCostSummary {
  requests: number;
  /** Requests that carried an authoritative cost. */
  pricedRequests: number;
  /** Requests whose cost is unknown (`costRub === null`); never folded into zero. */
  unpricedRequests: number;
  promptTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  /** Sum of authoritative `cost_rub`; null when no record carried a cost. */
  actualCostRub: number | null;
  models: ModelCostSummary[];
}

export function summarizeRecords(records: readonly PolzaUsageRecord[]): PolzaCostSummary {
  const summary: PolzaCostSummary = {
    requests: records.length,
    pricedRequests: 0,
    unpricedRequests: 0,
    promptTokens: 0,
    cachedTokens: 0,
    cacheWriteTokens: 0,
    completionTokens: 0,
    reasoningTokens: 0,
    actualCostRub: null,
    models: [],
  };

  let totalCost = 0;
  let sawCost = false;
  const byModel = new Map<string, { requests: number; costRub: number; sawCost: boolean }>();

  for (const record of records) {
    if (record.costRub === null) summary.unpricedRequests += 1;
    else summary.pricedRequests += 1;
    summary.promptTokens += record.promptTokens;
    summary.cachedTokens += record.cachedTokens;
    summary.cacheWriteTokens += record.cacheWriteTokens;
    summary.completionTokens += record.completionTokens;
    summary.reasoningTokens += record.reasoningTokens;

    const model = byModel.get(record.modelId) ?? { requests: 0, costRub: 0, sawCost: false };
    model.requests += 1;
    if (record.costRub !== null) {
      model.costRub += record.costRub;
      model.sawCost = true;
      totalCost += record.costRub;
      sawCost = true;
    }
    byModel.set(record.modelId, model);
  }

  if (sawCost) summary.actualCostRub = totalCost;
  summary.models = [...byModel.entries()]
    .map(([modelId, value]) => ({ modelId, requests: value.requests, costRub: value.sawCost ? value.costRub : null }))
    .sort((a, b) => (b.costRub ?? 0) - (a.costRub ?? 0));

  return summary;
}

/** Extension-owned session accumulator. */
export class PolzaCostAccumulator {
  private records: PolzaUsageRecord[] = [];
  /**
   * Identity index. A completed background run can be reconciled more than once (repeated
   * completion notification, reopen, fork), so the same `eventId` must not add spend twice.
   */
  private seenEventIds = new Set<string>();

  /**
   * Add one record. Records carrying an `eventId` are counted once per identity; legacy records
   * without one are always kept (two genuinely identical requests must stay two charges).
   */
  add(record: PolzaUsageRecord): void {
    const eventId = record.eventId;
    if (eventId) {
      if (this.seenEventIds.has(eventId)) return;
      this.seenEventIds.add(eventId);
    }
    this.records.push(record);
  }

  addMany(records: readonly PolzaUsageRecord[]): void {
    for (const record of records) this.add(record);
  }

  /** True when this identity was already counted (used to avoid re-appending duplicates). */
  hasEventId(eventId: string): boolean {
    return this.seenEventIds.has(eventId);
  }

  reset(): void {
    this.records = [];
    this.seenEventIds = new Set();
  }

  get all(): readonly PolzaUsageRecord[] {
    return this.records;
  }

  summary(): PolzaCostSummary {
    return summarizeRecords(this.records);
  }
}
