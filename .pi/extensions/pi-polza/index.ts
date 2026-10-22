/**
 * pi-polza — dynamic Polza AI model provider for Pi.
 *
 * Registers the `polza` provider as a **complete pi-ai provider** (`createProvider`) so Pi owns
 * authentication: the key is entered once via `/login polza` and stored by Pi. `POLZA_API_KEY`
 * (environment or `.env`) remains an explicit fallback for CI/headless use.
 *
 * The model list is built from the live Polza catalog, enriched with OpenRouter technical metadata
 * for missing fields. Native RUB accounting observes `usage.cost_rub` before normalization and
 * persists it as custom session entries. Pi's USD cost stays 0 on purpose (compatibility placeholder).
 */
import { createProvider, type Model } from "@earendil-works/pi-ai";
import { readStoredCredential, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { PolzaCostAccumulator, recordsFromEntries } from "./accounting.ts";
import { polzaApiKeyAuth, resolvePolzaKey } from "./auth.ts";
import { fetchBalance } from "./balance.ts";
import { registerPolzaCommands } from "./commands.ts";
import { loadDotEnv } from "./env.ts";
import { POLZA_API_V1, PolzaHttpError, setRuntimePolzaApiKey } from "./http.ts";
import { importChildAccounting } from "./integrations/child-import.ts";
import { createSubagentsBridge } from "./integrations/subagents.ts";
import { buildPolzaCatalog, POLZA_PROVIDER_ID, toPiModels, type CatalogBuildResult, type OpenRouterMode } from "./provider.ts";
import type { ResolvedModel } from "./metadata/types.ts";
import { PolzaStatusController, POLZA_STATUS_KEY, renderPolzaStatus, type PolzaStatusModel } from "./status.ts";
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

  // Persistent footer: `Polza <balance> ₽ | Spent <cost> ₽`, rendered by Pi's native status bar.
  const status = new PolzaStatusController({
    setStatus: (model: PolzaStatusModel | undefined) => {
      try {
        const theme = activeCtx?.ui.theme;
        activeCtx?.ui.setStatus(POLZA_STATUS_KEY, model && theme ? renderPolzaStatus(theme, model) : undefined);
      } catch {
        // Status bar is best-effort; never break the runtime.
      }
    },
    fetchBalance: (signal) => fetchBalance(signal),
    getSessionCost: () => {
      const summary = accounting.summary();
      return { requests: summary.requests, costRub: summary.actualCostRub, unpricedRequests: summary.unpricedRequests };
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
  pi.on("session_start", (_event, ctx) => {    accounting.reset();
    const sessionCtx = ctx as unknown as SessionStartContextLike;
    try {
      accounting.addMany(recordsFromEntries(sessionCtx.sessionManager.getEntries()));
    } catch {
      // Session entries unavailable; keep an empty accumulator.
    }
    syncStatusForContext(ctx);
  });

  // Background children run in a detached process with their own pi-polza instance, so their
  // billed responses land in their own session JSONL. Reconcile them once the run completes.
  const subagentsBridge = createSubagentsBridge(pi, {
    onChildCompleted: (child) => {
      if (!child.sessionPath) return;
      importChildAccounting({
        sessionPath: child.sessionPath,
        runId: child.runId,
        agent: child.agent,
        accumulator: accounting,
        appendEntry: (record) => {
          try {
            pi.appendEntry("polza-cost", record);
          } catch {
            // No active session (e.g. ephemeral mode) — keep the runtime record only.
          }
        },
      });
      status.requestCompleted(activeCtx?.signal);
    },
  });

  pi.on("model_select", (_event, ctx) => {
    syncStatusForContext(ctx);
  });

  pi.on("agent_end", (_event, ctx) => {
    activeCtx = ctx;
    status.requestCompleted(ctx.signal);
  });

  pi.on("session_shutdown", () => {
    subagentsBridge.dispose();
    status.deactivate();
  });

  const buildCatalog = async (
    apiKey: string | undefined,
    mode: OpenRouterMode,
    signal?: AbortSignal,
  ): Promise<Model<"openai-completions">[]> => {
    try {
      const build = await buildPolzaCatalog({ openRouter: mode, signal, apiKey });
      lastBuild = build;
      registry = build.resolved;
      if (build.models.length === 0) throw new Error("Polza catalog contains no Pi-compatible models.");
      return toPiModels(build.models);
    } catch (error) {
      // Fixed diagnostics: neither an echoed HTTP credential nor an arbitrary response body
      // belongs in startup output. Native refresh retains the last published models on failure.
      if (error instanceof PolzaHttpError && (error.status === 401 || error.status === 403)) {
        throw new Error("Polza authorization rejected. Run /login polza to replace the API key.");
      }
      if (error instanceof Error && error.message === "Polza catalog contains no Pi-compatible models.") throw error;
      throw new Error("Polza catalog unavailable (network or service failure). Pi can retain its saved catalog; retry /polza-refresh.");
    }
  };

  // Pi 1.4 registers extensions only AFTER ModelRuntime.create(); registration and service
  // initialization restore the native models-store with allowNetwork:false. fetchModels is
  // therefore NOT called before initial model selection (nor by credential synchronization).
  // Use Pi's public credential accessor to seed the baseline before registering the provider.
  // Pi still owns storage, login, subsequent auth resolution and dynamic catalog publication.
  const credential = readStoredCredential(POLZA_PROVIDER_ID);
  const initialKey = resolvePolzaKey({
    credentialKey: credential?.type === "api_key" ? credential.key : undefined,
    envKey: process.env.POLZA_API_KEY,
  });
  setRuntimePolzaApiKey(initialKey?.apiKey);
  let initialModels: Model<"openai-completions">[] = [];
  if (initialKey) {
    try {
      initialModels = await buildCatalog(initialKey.apiKey, "cache-first");
    } catch (error) {
      console.warn(`[pi-polza] Auth source: ${initialKey.source}. ${error instanceof Error ? error.message : "Polza catalog initialization failed."}`);
    }
  } else {
    console.warn("[pi-polza] Polza API key is not configured. Run /login polza, then /polza-refresh.");
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
        setRuntimePolzaApiKey(credentialKey);
        // OpenRouter stays off the critical path on startup; only an explicit force goes live.
        return buildCatalog(credentialKey, context.force ? "live" : "cache-first", context.signal);
      },
      // Observe native provider events and account once on terminal completion.
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
