/**
 * pi-polza — dynamic Polza AI model provider for Pi.
 *
 * Registers the `polza` provider (OpenAI-compatible chat completions) whose model list is built
 * from the live Polza catalog, enriched with OpenRouter technical metadata for missing fields.
 *
 * Native RUB accounting: catalog RUB prices are reference only; actual billed cost is
 * `usage.cost_rub`, tapped from each raw response by `stream.ts` and persisted as custom session
 * entries. Pi's USD cost stays 0 on purpose (compatibility placeholder).
 */
import type { ExtensionAPI, ExtensionContext, ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { PolzaCostAccumulator, recordsFromEntries } from "./accounting.ts";
import { fetchBalance } from "./balance.ts";
import { registerPolzaCommands } from "./commands.ts";
import { hasPolzaApiKey, loadDotEnv } from "./env.ts";
import { POLZA_API_V1 } from "./http.ts";
import { buildPolzaCatalog, type CatalogBuildResult } from "./provider.ts";
import type { ResolvedModel } from "./metadata/types.ts";
import { PolzaStatusController, POLZA_STATUS_KEY } from "./status.ts";
import { createPolzaStreamSimple } from "./stream.ts";

interface RefreshModelsContextLike {
  allowNetwork: boolean;
  signal: AbortSignal;
}

interface SessionStartContextLike {
  sessionManager: { getEntries(): Iterable<unknown> };
}

export default async function piPolza(pi: ExtensionAPI): Promise<void> {
  // Pi does not auto-load a project .env; do it here as a development/bootstrap fallback.
  loadDotEnv();

  let registry: ResolvedModel[] = [];
  let lastBuild: CatalogBuildResult | null = null;
  const accounting = new PolzaCostAccumulator();
  let activeCtx: ExtensionContext | null = null;

  // Persistent footer: `Polza <balance> ₽ | Session <cost> ₽`, rendered by Pi's native status bar.
  const status = new PolzaStatusController({
    setStatus: (text) => {
      try {
        activeCtx?.ui.setStatus(POLZA_STATUS_KEY, text);
      } catch {
        // Status bar is best-effort; never break the runtime.
      }
    },
    fetchBalance: (signal) => fetchBalance(signal),
    getSessionCost: () => {
      const summary = accounting.summary();
      return { requests: summary.requests, costRub: summary.actualCostRub };
    },
  });

  const syncStatusForContext = (ctx: ExtensionContext): void => {
    activeCtx = ctx;
    if (ctx.mode === "tui" && ctx.model?.provider === "polza") status.activate(ctx.signal);
    else status.deactivate();
  };

  // Capture native RUB per request: in-memory accumulator + custom session entry.
  const onUsageRecord = (record: Parameters<PolzaCostAccumulator["add"]>[0]): void => {
    accounting.add(record);
    try {
      pi.appendEntry("polza-cost", record);
    } catch {
      // No active session (e.g. ephemeral mode) — keep the runtime record only.
    }
    // Update the footer as soon as a billed request lands.
    status.requestCompleted(activeCtx?.signal);
  };

  // Rebuild the accumulator from the session on start/resume so accounting survives restarts.
  pi.on("session_start", (_event, ctx) => {
    accounting.reset();
    const sessionCtx = ctx as unknown as SessionStartContextLike;
    try {
      accounting.addMany(recordsFromEntries(sessionCtx.sessionManager.getEntries()));
    } catch {
      // Session entries unavailable; keep an empty accumulator.
    }
    syncStatusForContext(ctx);
  });

  pi.on("model_select", (_event, ctx) => {
    syncStatusForContext(ctx);
  });

  pi.on("agent_end", (_event, ctx) => {
    activeCtx = ctx;
    status.requestCompleted(ctx.signal);
  });

  pi.on("session_shutdown", () => {
    status.deactivate();
  });

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
    // Tap raw responses for usage.cost_rub without touching Pi's transport.
    streamSimple: createPolzaStreamSimple(onUsageRecord),
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
    getUsageRecords: () => accounting.all,
    getStatusController: () => status,
  });
}
