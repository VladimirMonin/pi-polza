/**
 * pi-polza — dynamic Polza AI model provider for Pi.
 *
 * Registers the `polza` provider (OpenAI-compatible chat completions) whose model list is built
 * from the live Polza catalog, enriched with OpenRouter technical metadata for missing fields.
 *
 * Native RUB accounting: catalog RUB prices are reference only; actual billed cost is
 * `usage.cost_rub` (see usage.ts / pricing.ts). Pi's USD cost stays 0 on purpose.
 */
import type { ExtensionAPI, ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { registerPolzaCommands } from "./commands.ts";
import { hasPolzaApiKey, loadDotEnv } from "./env.ts";
import { POLZA_API_V1 } from "./http.ts";
import { buildPolzaCatalog, type CatalogBuildResult } from "./provider.ts";
import type { ResolvedModel } from "./metadata/types.ts";

interface RefreshModelsContextLike {
  allowNetwork: boolean;
  signal: AbortSignal;
}

export default async function piPolza(pi: ExtensionAPI): Promise<void> {
  // Pi does not auto-load a project .env; do it here as a development/bootstrap fallback.
  loadDotEnv();

  let registry: ResolvedModel[] = [];
  let lastBuild: CatalogBuildResult | null = null;

  const refreshModels = async (context: RefreshModelsContextLike): Promise<ProviderModelConfig[]> => {
    if (!context.allowNetwork) {
      // Offline / cache-only startup: never hit the network here.
      return lastBuild?.models ?? [];
    }
    const build = await buildPolzaCatalog({ allowOpenRouter: true, signal: context.signal });
    lastBuild = build;
    registry = build.resolved;
    return build.models;
  };

  let initialModels: ProviderModelConfig[] = [];
  if (hasPolzaApiKey()) {
    try {
      const build = await buildPolzaCatalog({ allowOpenRouter: true });
      lastBuild = build;
      registry = build.resolved;
      initialModels = build.models;
    } catch {
      // Non-fatal: registration continues with an empty list; refreshModels can retry later.
    }
  }

  pi.registerProvider("polza", {
    name: "Polza AI",
    baseUrl: POLZA_API_V1,
    apiKey: "$POLZA_API_KEY",
    api: "openai-completions",
    models: initialModels,
    refreshModels,
  });

  registerPolzaCommands(pi, {
    getRegistry: () => registry,
    getLastBuildInfo: () =>
      lastBuild
        ? {
            polzaCount: lastBuild.polzaCount,
            eligible: lastBuild.eligible,
            openRouterError: lastBuild.openRouterError,
            fetchedAt: lastBuild.fetchedAt,
          }
        : null,
  });
}
