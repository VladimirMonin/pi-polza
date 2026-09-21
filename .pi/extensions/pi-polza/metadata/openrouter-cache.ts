/**
 * Local OpenRouter metadata cache.
 *
 * OpenRouter enrichment must never be a hard startup dependency: a transient timeout should not
 * silently shrink the Polza catalog. The cache is versioned, written atomically, and never deleted
 * just because a fresh fetch failed.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PROJECT_ROOT } from "../env.ts";
import type { OpenRouterModel } from "./openrouter.ts";

/** Bump when the persisted structure changes; older files are ignored (not deleted). */
export const OPENROUTER_CACHE_SCHEMA_VERSION = 1;

/** Consider a cache entry "stale" (still usable, but worth refreshing) after this. */
export const OPENROUTER_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export const OPENROUTER_CACHE_DIR = resolve(PROJECT_ROOT, ".pi", "pi-polza-cache");
export const OPENROUTER_CACHE_FILE = resolve(OPENROUTER_CACHE_DIR, "openrouter.json");

export interface OpenRouterCacheFile {
  schemaVersion: number;
  fetchedAt: number;
  models: OpenRouterModel[];
}

export interface LoadedOpenRouterCache {
  models: OpenRouterModel[];
  fetchedAt: number;
  ageMs: number;
}

export type OpenRouterCacheState = "fresh" | "stale" | "none";

export interface CacheIO {
  now?: number;
  file?: string;
}

function defaultFile(): string {
  return OPENROUTER_CACHE_FILE;
}

/** Read the cache. Corrupt or schema-mismatched files are treated as "no cache" (and left intact). */
export function readOpenRouterCache(options: CacheIO = {}): LoadedOpenRouterCache | null {
  const file = options.file ?? defaultFile();
  const now = options.now ?? Date.now();
  try {
    if (!existsSync(file)) return null;
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<OpenRouterCacheFile>;
    if (parsed?.schemaVersion !== OPENROUTER_CACHE_SCHEMA_VERSION) return null;
    if (!Array.isArray(parsed.models) || parsed.models.length === 0) return null;
    const fetchedAt = typeof parsed.fetchedAt === "number" ? parsed.fetchedAt : 0;
    return { models: parsed.models, fetchedAt, ageMs: Math.max(0, now - fetchedAt) };
  } catch {
    return null;
  }
}

/** Atomically write the cache (temp file + rename). Returns false on any failure. */
export function writeOpenRouterCache(models: OpenRouterModel[], options: CacheIO = {}): boolean {
  const file = options.file ?? defaultFile();
  const now = options.now ?? Date.now();
  try {
    mkdirSync(resolve(file, ".."), { recursive: true });
    const payload: OpenRouterCacheFile = {
      schemaVersion: OPENROUTER_CACHE_SCHEMA_VERSION,
      fetchedAt: now,
      models,
    };
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(payload));
    renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}

export function describeCacheState(cache: LoadedOpenRouterCache | null, now = Date.now(), ttlMs = OPENROUTER_CACHE_TTL_MS): OpenRouterCacheState {
  if (!cache) return "none";
  return now - cache.fetchedAt >= ttlMs ? "stale" : "fresh";
}
