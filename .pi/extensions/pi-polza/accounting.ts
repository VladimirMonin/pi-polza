/**
 * Native RUB accounting core (framework-agnostic, unit-testable).
 *
 * Captures Polza's authoritative `usage.cost_rub` per request. The value is NEVER recomputed from
 * tokens × catalog price: if the runtime response lacks it, the record's cost is `null` (unknown).
 */
import { normalizeUsage, type RawUsageLike } from "./usage.ts";

/** customType used for `pi.appendEntry` session entries. */
export const POLZA_COST_ENTRY = "polza-cost";

export interface PolzaUsageRecord {
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
  /** Optional future attribution. Not set until subagents are implemented. */
  agentId?: string;
  /** Diagnostics from usage normalization, when any. */
  anomalies?: string[];
}

/** Build a record from a raw Polza usage object. */
export function recordFromUsage(modelId: string, raw: RawUsageLike, timestamp = Date.now()): PolzaUsageRecord {
  const usage = normalizeUsage(raw);
  const record: PolzaUsageRecord = {
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

function coerceRecord(data: unknown): PolzaUsageRecord | null {
  if (!data || typeof data !== "object") return null;
  const value = data as Record<string, unknown>;
  if (typeof value.modelId !== "string") return null;
  const num = (key: string): number => (typeof value[key] === "number" && Number.isFinite(value[key]) ? (value[key] as number) : 0);
  const costRub = typeof value.costRub === "number" && Number.isFinite(value.costRub) ? value.costRub : null;
  return {
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

  add(record: PolzaUsageRecord): void {
    this.records.push(record);
  }

  addMany(records: readonly PolzaUsageRecord[]): void {
    this.records.push(...records);
  }

  reset(): void {
    this.records = [];
  }

  get all(): readonly PolzaUsageRecord[] {
    return this.records;
  }

  summary(): PolzaCostSummary {
    return summarizeRecords(this.records);
  }
}
