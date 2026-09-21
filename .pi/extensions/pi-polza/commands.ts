/**
 * Extension commands: /polza-model-info and /polza-balance.
 *
 * Values are shown with their provenance. Unknown values read as `unknown`, never `0`.
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { summarizeRecords, type PolzaUsageRecord } from "./accounting.ts";
import { formatRub, type PolzaBalance } from "./balance.ts";
import { extractInternalCapabilities } from "./mapper.ts";
import type { PolzaStatusController } from "./status.ts";
import { describeReasoning, reasoningVerificationFor } from "./reasoning.ts";
import type { Provenanced } from "./metadata/provenance.ts";
import type { ResolvedModel } from "./metadata/types.ts";

export interface CommandDeps {
  /** Current internal registry (including ineligible models). */
  getRegistry: () => ResolvedModel[];
  getLastBuildInfo: () => { polzaCount: number; eligible: number; openRouterError: string | null; openRouterSource: string; fetchedAt: number } | null;
  /** Native RUB usage records captured for the current session. */
  getUsageRecords: () => readonly PolzaUsageRecord[];
  /** Footer controller, used by `/polza-balance` to force a balance refresh. */
  getStatusController: () => PolzaStatusController;
}

function show(value: unknown): string {
  if (value === null || value === undefined) return "unknown";
  if (typeof value === "number") return value.toLocaleString("en-US");
  return String(value);
}

function withSource<T>(field: Provenanced<T>, format: (value: T) => string = show): string {
  if (field.value === null) return "unknown";
  return `${format(field.value)} (source: ${field.source})`;
}

function yesNoUnknown(value: boolean | null): string {
  if (value === null) return "unknown";
  return value ? "yes" : "no";
}

function rubPerMillion(value: number | null): string {
  return value === null ? "unknown" : `${value} RUB / 1M`;
}

function modelInfoLines(model: ResolvedModel): string[] {
  const caps = extractInternalCapabilities(model);
  const price = model.pricing.polzaRUB;
  const verified = model.verifiedToolSupport === "unknown" ? "unknown" : model.verifiedToolSupport ? "yes" : "no";

  const lines: string[] = [
    `Model:        ${model.id}`,
    `Provider:     polza (availability: ${model.availability.polza ? "yes" : "no"})`,
    "",
    `Context:      ${withSource(model.limits.contextWindow)}`,
    `Max output:   ${withSource(model.limits.maxCompletionTokens)}`,
    "",
    `Input:        ${show(model.modalities.input.value)} (source: ${model.modalities.input.source})`,
    `              Pi native: ${(model.capabilities.vision.value === null ? ["text"] : model.modalities.input.value?.filter((m) => m === "text" || m === "image") ?? ["text"]).join(", ")}`,
  ];
  if (caps.internalInputModalities.length > 0) {
    lines.push(`              internal only (not sent by Pi): ${caps.internalInputModalities.join(", ")}`);
  }
  lines.push(
    `Vision:       ${withSource(model.capabilities.vision)}`,
    "",
    `Tools:        declared: ${yesNoUnknown(caps.tools)} (source: ${model.capabilities.tools.source}), verified: ${verified}`,
    `Tool choice:  ${yesNoUnknown(caps.toolChoice)} (source: ${model.capabilities.toolChoice.source})`,
    `Reasoning:    declared: ${yesNoUnknown(model.capabilities.reasoning.value)} (source: ${model.capabilities.reasoning.source})`,
    `Reasoning eff:${yesNoUnknown(model.capabilities.reasoningEffort.value)} (source: ${model.capabilities.reasoningEffort.source})`,
    ...describeReasoning(reasoningVerificationFor(model.id)).map((line) => `              ${line}`),
    `Structured:   ${yesNoUnknown(caps.structuredOutputs)} (source: ${model.capabilities.structuredOutputs.source})`,
    "",
    "Pricing (native RUB, source: Polza catalog — reference estimate):",
    `  Input:        ${rubPerMillion(price.promptPerMillion)}`,
    `  Output:       ${rubPerMillion(price.completionPerMillion)}`,
    `  Cache read:   ${rubPerMillion(price.cacheReadPerMillion)}`,
    `  Cache write:  ${rubPerMillion(price.cacheWritePerMillion)}`,
    "  Actual billed cost comes from usage.cost_rub, not from this estimate.",
    "",
    `Pi eligible:  ${model.piEligibility.eligible ? "yes" : `no (${model.piEligibility.reasons.join(", ")})`}`,
  );

  if (model.conflicts.length > 0) {
    lines.push("", `Metadata conflicts vs OpenRouter: ${model.conflicts.length}`);
    for (const conflict of model.conflicts.slice(0, 6)) {
      lines.push(`  ${conflict.field}: polza=${JSON.stringify(conflict.polza)} openrouter=${JSON.stringify(conflict.openrouter)}`);
    }
  }

  if (model.openRouterId) lines.push(`OpenRouter id: ${model.openRouterId}`);
  return lines;
}

function rubOrUnknown(value: number | null): string {
  return value === null ? "unknown" : formatRub(value);
}

function balanceLines(balance: PolzaBalance): string[] {
  return [
    "Polza balance",
    `  Balance:         ${formatRub(balance.amount)}`,
    `  Available:       ${formatRub(balance.available)}`,
    `  Reserved:        ${formatRub(balance.reservedAmount)}`,
    `  Lifetime spent:  ${formatRub(balance.spentAmount)}`,
    balance.updatedAt ? `  Updated:         ${balance.updatedAt}` : "  Updated:         unknown",
    "",
    "`Lifetime spent` is global account spend, not the current session cost.",
  ];
}

function costLines(records: readonly PolzaUsageRecord[]): string[] {
  const summary = summarizeRecords(records);
  if (summary.requests === 0) return ["No Polza usage recorded in this session yet."];

  const lines = [
    "Current session (native RUB)",
    "",
    `Requests:          ${summary.requests}`,
    `Input tokens:      ${summary.promptTokens.toLocaleString("en-US")}`,
    `Cached:            ${summary.cachedTokens.toLocaleString("en-US")}`,
    `Cache write:       ${summary.cacheWriteTokens.toLocaleString("en-US")}`,
    `Output tokens:     ${summary.completionTokens.toLocaleString("en-US")}`,
    `Reasoning tokens:  ${summary.reasoningTokens.toLocaleString("en-US")}`,
    "",
    `Actual cost: ${rubOrUnknown(summary.actualCostRub)}  (from usage.cost_rub)`,
  ];

  if (summary.models.length > 0) {
    lines.push("", "Models");
    const width = Math.max(20, ...summary.models.map((m) => m.modelId.length));
    for (const model of summary.models) {
      lines.push(`  ${model.modelId.padEnd(width)}  ${rubOrUnknown(model.costRub)}  (${model.requests} req)`);
    }
    lines.push(`  ${"Total".padEnd(width)}  ${rubOrUnknown(summary.actualCostRub)}`);
  }

  const estimated = records.some((r) => r.costRub === null);
  if (estimated) {
    lines.push("", "Note: some requests reported no cost_rub — their cost is unknown, not estimated.");
  }
  return lines;
}

export function registerPolzaCommands(pi: ExtensionAPI, deps: CommandDeps): void {
  pi.registerCommand("polza-model-info", {
    description: "Show capabilities, limits, pricing and metadata sources for the current Polza model",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      const model = ctx.model;
      if (!model) {
        ctx.ui.notify("No active model.", "warning");
        return;
      }
      if (model.provider !== "polza") {
        ctx.ui.notify(`Current model is not a Polza model (provider: ${model.provider}).`, "warning");
        return;
      }
      const resolved = deps.getRegistry().find((entry) => entry.id === model.id);
      if (!resolved) {
        ctx.ui.notify(`No metadata for "${model.id}" in the Polza registry.`, "warning");
        return;
      }
      ctx.ui.notify(modelInfoLines(resolved).join("\n"), "info");
    },
  });

  pi.registerCommand("polza-cost", {
    description: "Show actual Polza cost for the current session in native RUB",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      ctx.ui.notify(costLines(deps.getUsageRecords()).join("\n"), "info");
    },
  });

  pi.registerCommand("polza-balance", {
    description: "Show the Polza account balance (native RUB) and refresh the footer",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      try {
        const controller = deps.getStatusController();
        await controller.refreshBalance(ctx.signal);
        const balance = controller.current;
        if (!balance) throw new Error("balance unavailable");
        ctx.ui.notify(balanceLines(balance).join("\n"), "info");
      } catch (error) {
        ctx.ui.notify(`Failed to fetch Polza balance: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    },
  });

  pi.registerCommand("polza-refresh", {
    description: "Force a refresh of the Polza catalog and OpenRouter enrichment",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      ctx.ui.notify("Reloading extensions to refresh the Polza catalog…", "info");
      await ctx.reload();
    },
  });
}
