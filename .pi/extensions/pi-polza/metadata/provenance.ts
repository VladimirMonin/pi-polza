/**
 * Provenance primitives.
 *
 * Every resolved technical field carries where its value came from, so provenance survives
 * normalization instead of being flattened away.
 *
 * Priority (highest first): polza → openrouter → override → unknown.
 */

export type MetadataSource = "polza" | "openrouter" | "override" | "unknown";

export interface Provenanced<T> {
  value: T | null;
  source: MetadataSource;
}

export function fromPolza<T>(value: T | null | undefined): Provenanced<T> {
  return { value: value ?? null, source: value === null || value === undefined ? "unknown" : "polza" };
}

export function fromOpenRouter<T>(value: T | null | undefined): Provenanced<T> {
  return { value: value ?? null, source: value === null || value === undefined ? "unknown" : "openrouter" };
}

export function fromOverride<T>(value: T | null | undefined): Provenanced<T> {
  return { value: value ?? null, source: value === null || value === undefined ? "unknown" : "override" };
}

export function unknown<T>(): Provenanced<T> {
  return { value: null, source: "unknown" };
}

export function isKnown<T>(field: Provenanced<T>): field is { value: T; source: MetadataSource } {
  return field.value !== null && field.source !== "unknown";
}
