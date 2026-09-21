/**
 * Extension commands: /polza-model-info, /polza-balance, /polza-cost, /polza-refresh.
 *
 * Values carry their provenance; unknown values read as `unknown`, never `0`. Presentation is
 * grouped and themed (see `presentation.ts`); in the TUI it is shown as a scrollable native
 * component, because Pi's `notify(..., "info")` forces the whole message to `dim`.
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { PolzaUsageRecord } from "./accounting.ts";
import type { PolzaStatusController } from "./status.ts";
import {
  balancePanel,
  costPanel,
  modelInfoPanel,
  renderPanel,
  renderPanelPlain,
  type Panel,
} from "./presentation.ts";
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

/** Render a panel through the active theme (TUI) or as plain text (other modes). */
async function showPanel(ctx: ExtensionCommandContext, panel: Panel): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify(renderPanelPlain(panel).join("\n"), "info");
    return;
  }

  const [{ Container, Text, matchesKey }, { DynamicBorder }] = await Promise.all([
    import("@earendil-works/pi-tui"),
    import("@earendil-works/pi-coding-agent"),
  ]);

  await ctx.ui.custom((_tui, theme, _kb, done) => {
    const container = new Container();
    const border = new DynamicBorder((s: string) => theme.fg("accent", s));
    container.addChild(border);
    for (const line of renderPanel(theme, panel)) container.addChild(new Text(line, 1, 0));
    container.addChild(new Text(theme.fg("dim", "Press Enter or Esc to close"), 1, 0));
    container.addChild(border);
    return {
      render: (width: number) => container.render(width),
      invalidate: () => container.invalidate(),
      handleInput: (data: string) => {
        if (matchesKey(data, "enter") || matchesKey(data, "escape") || data === "q") done(undefined);
      },
    };
  });
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
      await showPanel(ctx, modelInfoPanel(resolved));
    },
  });

  pi.registerCommand("polza-cost", {
    description: "Show actual Polza cost for the current session in native RUB",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      await showPanel(ctx, costPanel(deps.getUsageRecords()));
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
        await showPanel(ctx, balancePanel(balance));
      } catch (error) {
        ctx.ui.notify(`Failed to fetch Polza balance: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    },
  });

  pi.registerCommand("polza-refresh", {
    description: "Refresh the Polza catalog and OpenRouter enrichment now",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      const theme = ctx.ui.theme;
      const authStatus = ctx.modelRegistry.getProviderAuthStatus("polza");
      if (authStatus && !authStatus.configured) {
        ctx.ui.notify("Polza is not configured. Run /login polza first.", "warning");
        return;
      }
      try {
        const result = await ctx.modelRegistry.refresh({ providers: ["polza"], force: true });
        const error = result.errors.get("polza");
        if (error) {
          ctx.ui.notify(`⚠ Polza refresh failed: ${error.message}`, "warning");
          return;
        }
        ctx.ui.notify(theme.fg("success", "✓ Polza catalog refreshed"), "info");
      } catch (error) {
        ctx.ui.notify(`⚠ Polza refresh failed: ${error instanceof Error ? error.message : String(error)}`, "warning");
      }
    },
  });
}
