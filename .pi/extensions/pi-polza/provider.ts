/**
 * Build the Pi-facing Polza catalog.
 *
 * Combines: Polza catalog (authoritative availability) + OpenRouter enrichment (technical
 * metadata) → resolved models → Pi ProviderModelConfig (via mapper).
 *
 * OpenRouter failure is non-fatal and must never block startup:
 *  - `"live"`        fetch now; on failure fall back to cache; else Polza-only.
 *  - `"cache-first"` use cache immediately, no network (fast startup); refresh later via refreshModels.
 *  - `"off"`         no enrichment.
 */
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { fetchCatalog } from "./catalog.ts";
import { fetchOpenRouterModels, indexOpenRouterById, type OpenRouterModel } from "./metadata/openrouter.ts";
import {
  describeCacheState,
  readOpenRouterCache,
  writeOpenRouterCache,
} from "./metadata/openrouter-cache.ts";
import { resolveModels } from "./metadata/resolver.ts";
import { buildOverrideMap } from "./overrides/models.ts";
import { toProviderModelConfigs } from "./mapper.ts";
import { VERIFIED_TOOL_SUPPORT } from "./verified.ts";
import type { ResolvedModel } from "./metadata/types.ts";

export type OpenRouterMode = "live" | "cache-first" | "off";

/** Where this build's OpenRouter metadata came from. */
export type OpenRouterSource = "live" | "cache-fresh" | "cache-stale" | "off" | "none";

export interface CatalogBuildResult {
  /** Pi-eligible models (only ones with real, non-fabricated limits). */
  models: ProviderModelConfig[];
  /** Full internal registry, including ineligible models and their rejection reasons. */
  resolved: ResolvedModel[];
  polzaCount: number;
  openRouterMatched: number;
  eligible: number;
  openRouterError: string | null;
  openRouterSource: OpenRouterSource;
  /** Age of the cache actually used, in ms (null when live/off/none). */
  openRouterCacheAgeMs: number | null;
  fetchedAt: number;
  timings: { polzaMs: number; openRouterMs: number; totalMs: number };
}

export interface BuildOptions {
  signal?: AbortSignal;
  /** Defaults to `"live"`. */
  openRouter?: OpenRouterMode;
  /** @deprecated use `openRouter: "off"`. */
  allowOpenRouter?: boolean;
  /** Page size for the Polza catalog. */
  pageLimit?: number;
}

export async function buildPolzaCatalog(options: BuildOptions = {}): Promise<CatalogBuildResult> {
  const startedAt = Date.now();

  const polzaStart = Date.now();
  const { models: polzaModels } = await fetchCatalog({ limit: options.pageLimit ?? 100, signal: options.signal });
  const polzaMs = Date.now() - polzaStart;

  const mode: OpenRouterMode = options.openRouter ?? (options.allowOpenRouter === false ? "off" : "live");

  let openRouterModels: OpenRouterModel[] = [];
  let openRouterError: string | null = null;
  let openRouterSource: OpenRouterSource = "off";
  let openRouterCacheAgeMs: number | null = null;
  const openRouterStart = Date.now();

  if (mode === "cache-first") {
    const cache = readOpenRouterCache();
    if (cache) {
      openRouterModels = cache.models;
      openRouterSource = describeCacheState(cache) === "fresh" ? "cache-fresh" : "cache-stale";
      openRouterCacheAgeMs = cache.ageMs;
    } else {
      openRouterSource = "none";
    }
  } else if (mode === "live") {
    try {
      const { models } = await fetchOpenRouterModels(options.signal);
      openRouterModels = models;
      openRouterSource = "live";
      writeOpenRouterCache(models);
    } catch (error) {
      openRouterError = error instanceof Error ? error.message : String(error);
      const cache = readOpenRouterCache();
      if (cache) {
        openRouterModels = cache.models;
        openRouterSource = describeCacheState(cache) === "fresh" ? "cache-fresh" : "cache-stale";
        openRouterCacheAgeMs = cache.ageMs;
      } else {
        openRouterSource = "none";
      }
    }
  }

  const openRouterMs = Date.now() - openRouterStart;

  const resolved = resolveModels(polzaModels, indexOpenRouterById(openRouterModels), {
    verifiedToolSupportById: VERIFIED_TOOL_SUPPORT,
    overridesById: buildOverrideMap(),
  });
  const models = toProviderModelConfigs(resolved);

  return {
    models,
    resolved,
    polzaCount: polzaModels.length,
    openRouterMatched: resolved.filter((r) => r.openRouterId !== null).length,
    eligible: models.length,
    openRouterError,
    openRouterSource,
    openRouterCacheAgeMs,
    fetchedAt: Date.now(),
    timings: { polzaMs, openRouterMs, totalMs: Date.now() - startedAt },
  };
}
