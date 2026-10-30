/**
 * Local OpenRouter metadata cache.
 *
 * OpenRouter enrichment must never be a hard startup dependency: a transient timeout should not
 * silently shrink the Polza catalog. The cache is versioned, written atomically, and never deleted
 * just because a fresh fetch failed.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { WORKSPACE_ROOT } from "../env.ts";
import type { OpenRouterModel } from "./openrouter.ts";

/** Bump when the persisted structure changes; older files are ignored (not deleted). */
export const OPENROUTER_CACHE_SCHEMA_VERSION = 1;

/** Consider a cache entry "stale" (still usable, but worth refreshing) after this. */
export const OPENROUTER_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * The cache is shared: a copy kept in the folder Pi was started from would otherwise be invisible
 * from every other folder, and the catalog would silently lose the models that only OpenRouter can
 * describe. Reads therefore take the freshest of the two copies; writes always go to the shared
 * location so there is one authority instead of one copy per folder.
 *
 * - project copy: `<cwd>/.pi/pi-polza-cache/openrouter.json` (legacy, still honoured)
 * - shared copy:  `<home>/.pi/pi-polza-cache/openrouter.json` (written here)
 */
export const OPENROUTER_CACHE_DIR = resolve(WORKSPACE_ROOT, ".pi", "pi-polza-cache");
export const OPENROUTER_CACHE_FILE = resolve(OPENROUTER_CACHE_DIR, "openrouter.json");
export const SHARED_OPENROUTER_CACHE_DIR = resolve(homedir(), ".pi", "pi-polza-cache");
export const SHARED_OPENROUTER_CACHE_FILE = resolve(SHARED_OPENROUTER_CACHE_DIR, "openrouter.json");

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
  return SHARED_OPENROUTER_CACHE_FILE;
}

/** Read one cache file. Corrupt or schema-mismatched files are treated as "no cache". */
function readCacheFile(file: string, now: number): LoadedOpenRouterCache | null {
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

/**
 * Read the cache: an explicit file, otherwise the freshest of the project copy and the shared copy.
 * Corrupt or schema-mismatched files are ignored (and left intact).
 */
export function readOpenRouterCache(options: CacheIO = {}): LoadedOpenRouterCache | null {
  const now = options.now ?? Date.now();
  if (options.file) return readCacheFile(options.file, now);

  const project = readCacheFile(OPENROUTER_CACHE_FILE, now);
  const shared = readCacheFile(SHARED_OPENROUTER_CACHE_FILE, now);
  if (!project) return shared;
  if (!shared) return project;
  return shared.fetchedAt > project.fetchedAt ? shared : project;
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
