/**
 * Build the Pi-facing Polza catalog.
 *
 * Combines: Polza catalog (authoritative availability) + OpenRouter enrichment (technical
 * metadata) → resolved models → Pi ProviderModelConfig (via mapper).
 *
 * OpenRouter failure is non-fatal: the catalog is still built from Polza alone.
 */
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { fetchCatalog } from "./catalog.ts";
import { fetchOpenRouterModels, indexOpenRouterById } from "./metadata/openrouter.ts";
import { resolveModels } from "./metadata/resolver.ts";
import { toProviderModelConfigs } from "./mapper.ts";
import { VERIFIED_TOOL_SUPPORT } from "./verified.ts";
import type { ResolvedModel } from "./metadata/types.ts";

export interface CatalogBuildResult {
  /** Pi-eligible models (only ones with real, non-fabricated limits). */
  models: ProviderModelConfig[];
  /** Full internal registry, including ineligible models and their rejection reasons. */
  resolved: ResolvedModel[];
  polzaCount: number;
  openRouterMatched: number;
  eligible: number;
  openRouterError: string | null;
  fetchedAt: number;
}

export interface BuildOptions {
  signal?: AbortSignal;
  /** When false, skip the OpenRouter enrichment request (offline / cache-only startup). */
  allowOpenRouter?: boolean;
  /** Page size for the Polza catalog. */
  pageLimit?: number;
}

export async function buildPolzaCatalog(options: BuildOptions = {}): Promise<CatalogBuildResult> {
  const { models: polzaModels } = await fetchCatalog({ limit: options.pageLimit ?? 100, signal: options.signal });

  let openRouterById = new Map<string, import("./metadata/openrouter.ts").OpenRouterModel>();
  let openRouterError: string | null = null;
  if (options.allowOpenRouter !== false) {
    try {
      const { models: openRouterModels } = await fetchOpenRouterModels(options.signal);
      openRouterById = indexOpenRouterById(openRouterModels);
    } catch (error) {
      openRouterError = error instanceof Error ? error.message : String(error);
    }
  }

  const resolved = resolveModels(polzaModels, openRouterById, { verifiedToolSupportById: VERIFIED_TOOL_SUPPORT });
  const models = toProviderModelConfigs(resolved);

  return {
    models,
    resolved,
    polzaCount: polzaModels.length,
    openRouterMatched: resolved.filter((r) => r.openRouterId !== null).length,
    eligible: models.length,
    openRouterError,
    fetchedAt: Date.now(),
  };
}
