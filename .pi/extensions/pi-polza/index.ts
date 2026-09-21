/**
 * pi-polza — dynamic Polza AI model provider for Pi.
 *
 * Registers the `polza` provider as a **complete pi-ai provider** (`createProvider`) so Pi owns
 * authentication: the key is entered once via `/login polza` and stored by Pi. `POLZA_API_KEY`
 * (environment or `.env`) remains an explicit fallback for CI/headless use.
 *
 * The model list is built from the live Polza catalog, enriched with OpenRouter technical metadata
 * for missing fields. Native RUB accounting taps `usage.cost_rub` from each raw response and
 * persists it as custom session entries. Pi's USD cost stays 0 on purpose (compatibility placeholder).
 */
import { createProvider, type Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { PolzaCostAccumulator, recordsFromEntries } from "./accounting.ts";
import { polzaApiKeyAuth } from "./auth.ts";
import { fetchBalance } from "./balance.ts";
import { registerPolzaCommands } from "./commands.ts";
import { hasPolzaApiKey, loadDotEnv } from "./env.ts";
import { POLZA_API_V1, setRuntimePolzaApiKey } from "./http.ts";
import { buildPolzaCatalog, POLZA_PROVIDER_ID, toPiModels, type CatalogBuildResult, type OpenRouterMode } from "./provider.ts";
import type { ResolvedModel } from "./metadata/types.ts";
import { PolzaStatusController, POLZA_STATUS_KEY } from "./status.ts";
import { createPolzaApiStreams } from "./stream.ts";

interface SessionStartContextLike {
  sessionManager: { getEntries(): Iterable<unknown> };
}

export default async function piPolza(pi: ExtensionAPI): Promise<void> {
  // Pi does not auto-load a project .env; do it here so the native auth resolve() can see it.
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

  /** Ask Pi for the resolved Polza credential so non-stream HTTP paths share it. */
  const installCredentialFromRegistry = async (ctx: ExtensionContext): Promise<void> => {
    try {
      const key = await ctx.modelRegistry.getApiKeyForProvider(POLZA_PROVIDER_ID);
      if (key) setRuntimePolzaApiKey(key);
    } catch {
      // Unconfigured providers are expected; leave the runtime key untouched.
    }
  };

  const syncStatusForContext = (ctx: ExtensionContext): void => {
    activeCtx = ctx;
    if (ctx.mode === "tui" && ctx.model?.provider === POLZA_PROVIDER_ID) {
      void (async () => {
        await installCredentialFromRegistry(ctx);
        status.activate(ctx.signal);
      })();
    } else {
      status.deactivate();
    }
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

  const buildCatalog = async (
    apiKey: string | undefined,
    mode: OpenRouterMode,
    signal?: AbortSignal,
  ): Promise<Model<"openai-completions">[]> => {
    const build = await buildPolzaCatalog({ openRouter: mode, signal, apiKey });
    lastBuild = build;
    registry = build.resolved;
    return toPiModels(build.models);
  };

  // Baseline models for env/.env users; native-credential users get theirs on the post-login refresh.
  let initialModels: Model<"openai-completions">[] = [];
  if (hasPolzaApiKey()) {
    try {
      initialModels = await buildCatalog(undefined, "cache-first");
    } catch {
      // Non-fatal: the provider registers with an empty baseline and refreshModels can retry.
    }
  }

  pi.registerProvider(
    createProvider<"openai-completions">({
      id: POLZA_PROVIDER_ID,
      name: "Polza AI",
      baseUrl: POLZA_API_V1,
      // Pi owns credential storage and the /login flow; we only describe the key source.
      auth: { apiKey: polzaApiKeyAuth },
      models: initialModels,
      // Dynamic overlay: Pi persists it and restores it on the next start, even offline.
      fetchModels: async (context) => {
        const credentialKey =
          context.credential?.type === "api_key" ? context.credential.key : undefined;
        if (credentialKey) setRuntimePolzaApiKey(credentialKey);
        // OpenRouter stays off the critical path on startup; only an explicit force goes live.
        return buildCatalog(credentialKey, context.force ? "live" : "cache-first", context.signal);
      },
      // Tap raw responses for usage.cost_rub without touching Pi's transport.
      api: createPolzaApiStreams(onUsageRecord),
    }),
  );

  registerPolzaCommands(pi, {
    getRegistry: () => registry,
    getLastBuildInfo: () =>
      lastBuild
        ? {
            polzaCount: lastBuild.polzaCount,
            eligible: lastBuild.eligible,
            openRouterError: lastBuild.openRouterError,
            openRouterSource: lastBuild.openRouterSource,
            fetchedAt: lastBuild.fetchedAt,
          }
        : null,
    getUsageRecords: () => accounting.all,
    getStatusController: () => status,
  });
}
