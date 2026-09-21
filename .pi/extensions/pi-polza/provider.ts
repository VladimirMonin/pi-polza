/**
 * Build the Pi-facing Polza catalog.
 *
 * Combines: Polza catalog (authoritative availability) + OpenRouter enrichment (technical
 * metadata) → resolved models → Pi ProviderModelConfig (via mapper).
 *
 * OpenRouter failure is non-fatal and must never block startup: the last successful OpenRouter
 * snapshot is cached locally and reused (with provenance unchanged), otherwise the catalog is
 * built from Polza alone.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { fetchCatalog } from "./catalog.ts";
import { fetchOpenRouterModels, indexOpenRouterById, type OpenRouterModel } from "./metadata/openrouter.ts";
import { resolveModels } from "./metadata/resolver.ts";
import { toProviderModelConfigs } from "./mapper.ts";
import { VERIFIED_TOOL_SUPPORT } from "./verified.ts";
import { PROJECT_ROOT } from "./env.ts";
import type { ResolvedModel } from "./metadata/types.ts";

const CACHE_DIR = resolve(PROJECT_ROOT, ".pi", "pi-polza-cache");
const OPENROUTER_CACHE_FILE = resolve(CACHE_DIR, "openrouter.json");

export type OpenRouterSource = "live" | "cache" | "disabled" | "unavailable";

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
  fetchedAt: number;
}

export interface BuildOptions {
  signal?: AbortSignal;
  /** When false, skip the OpenRouter enrichment request (offline / cache-only startup). */
  allowOpenRouter?: boolean;
  /** Page size for the Polza catalog. */
  pageLimit?: number;
}

interface OpenRouterCache {
  fetchedAt: number;
  models: OpenRouterModel[];
}

function loadOpenRouterCache(): OpenRouterModel[] | null {
  try {
    if (!existsSync(OPENROUTER_CACHE_FILE)) return null;
    const parsed = JSON.parse(readFileSync(OPENROUTER_CACHE_FILE, "utf8")) as OpenRouterCache;
    return Array.isArray(parsed.models) && parsed.models.length > 0 ? parsed.models : null;
  } catch {
    return null;
  }
}

function saveOpenRouterCache(models: OpenRouterModel[]): void {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    const payload: OpenRouterCache = { fetchedAt: Date.now(), models };
    writeFileSync(OPENROUTER_CACHE_FILE, JSON.stringify(payload));
  } catch {
    // Cache is best-effort; never fail the build because of it.
  }
}

export async function buildPolzaCatalog(options: BuildOptions = {}): Promise<CatalogBuildResult> {
  const { models: polzaModels } = await fetchCatalog({ limit: options.pageLimit ?? 100, signal: options.signal });

  let openRouterModels: OpenRouterModel[] = [];
  let openRouterError: string | null = null;
  let openRouterSource: OpenRouterSource = "disabled";

  if (options.allowOpenRouter !== false) {
    try {
      const { models } = await fetchOpenRouterModels(options.signal);
      openRouterModels = models;
      openRouterSource = "live";
      saveOpenRouterCache(models);
    } catch (error) {
      openRouterError = error instanceof Error ? error.message : String(error);
      const cached = loadOpenRouterCache();
      if (cached) {
        openRouterModels = cached;
        openRouterSource = "cache";
      } else {
        openRouterSource = "unavailable";
      }
    }
  }

  const resolved = resolveModels(polzaModels, indexOpenRouterById(openRouterModels), {
    verifiedToolSupportById: VERIFIED_TOOL_SUPPORT,
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
    fetchedAt: Date.now(),
  };
}
