/**
 * Metadata conflict tracking.
 *
 * When both Polza and OpenRouter provide a value and they differ, Polza WINS. The disagreement
 * is still recorded for diagnostics (e.g. to study how literally Polza mirrors OpenRouter).
 */
import type { MetadataSource, Provenanced } from "./provenance.ts";

export interface MetadataConflict {
  field: string;
  polza: unknown;
  openrouter: unknown;
}

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => equal(item, b[i]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ak = Object.keys(a as Record<string, unknown>);
    const bk = Object.keys(b as Record<string, unknown>);
    return ak.length === bk.length && ak.every((k) => equal((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

/**
 * Resolve a field with Polza priority, recording a conflict when both sources carry
 * a (different) concrete value.
 */
export function resolveWithConflict<T>(
  field: string,
  polza: Provenanced<T>,
  openrouter: Provenanced<T>,
  conflicts: MetadataConflict[],
): Provenanced<T> {
  if (polza.value !== null && openrouter.value !== null && !equal(polza.value, openrouter.value)) {
    conflicts.push({ field, polza: polza.value, openrouter: openrouter.value });
  }
  if (polza.value !== null) return polza;
  if (openrouter.value !== null) return openrouter;
  return { value: null, source: "unknown" };
}

export interface ConflictSummary {
  total: number;
  contextWindow: number;
  maxCompletionTokens: number;
  modalities: number;
  capabilities: number;
  other: number;
}

export function summarizeConflicts(conflicts: MetadataConflict[]): ConflictSummary {
  const summary: ConflictSummary = {
    total: conflicts.length,
    contextWindow: 0,
    maxCompletionTokens: 0,
    modalities: 0,
    capabilities: 0,
    other: 0,
  };
  for (const conflict of conflicts) {
    if (conflict.field === "contextWindow") summary.contextWindow += 1;
    else if (conflict.field === "maxCompletionTokens") summary.maxCompletionTokens += 1;
    else if (conflict.field.startsWith("input") || conflict.field.startsWith("output")) summary.modalities += 1;
    else if (conflict.field.startsWith("supports")) summary.capabilities += 1;
    else summary.other += 1;
  }
  return summary;
}

export type { MetadataSource };
