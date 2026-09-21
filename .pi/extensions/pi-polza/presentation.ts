/**
 * Presentation layer for `/polza-*` command output.
 *
 * Pure and framework-agnostic: builders return a structured `Panel`, and `renderPanel` themes it
 * with the active Pi theme. This keeps UI semantics testable without asserting ANSI codes, and it
 * avoids dumping a uniform diagnostic blob into the one-line `notify` status (which Pi forces to
 * `dim` and which was the reason the old output read as one flat intensity).
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { summarizeRecords, type PolzaUsageRecord } from "./accounting.ts";
import { formatRub, type PolzaBalance } from "./balance.ts";
import { extractInternalCapabilities } from "./mapper.ts";
import { overridesFor } from "./overrides/models.ts";
import { describeReasoning, reasoningVerificationFor } from "./reasoning.ts";
import type { ResolvedModel } from "./metadata/types.ts";

/** Minimal theme surface we depend on (keeps builders free of TUI internals). */
export type ThemeLike = Pick<Theme, "fg" | "bold">;

/** Semantic role of a value; maps to a theme color. */
export type ValueRole = "value" | "accent" | "success" | "warning" | "muted" | "dim" | "unknown";

export interface PanelRow {
  label: string;
  value: string;
  role?: ValueRole;
  /** Secondary text (source/provenance) rendered faintly after the value. */
  hint?: string;
}

export interface PanelSection {
  title?: string;
  rows: PanelRow[];
  /** Faint explanatory line after the rows. */
  note?: string;
}

export interface Panel {
  title: string;
  sections: PanelSection[];
  footer?: string;
}

const ROLE_COLOR: Record<ValueRole, "text" | "accent" | "success" | "warning" | "muted" | "dim"> = {
  value: "text",
  accent: "accent",
  success: "success",
  warning: "warning",
  muted: "muted",
  dim: "dim",
  unknown: "dim",
};

/** Theme a value according to its semantic role. */
export function colorize(theme: ThemeLike, role: ValueRole, text: string): string {
  return theme.fg(ROLE_COLOR[role], text);
}

/** Render a panel into themed lines: accent headings, muted labels, normal values. */
export function renderPanel(theme: ThemeLike, panel: Panel): string[] {
  const lines: string[] = [theme.fg("accent", theme.bold(panel.title))];
  for (const section of panel.sections) {
    lines.push("");
    if (section.title) lines.push(theme.fg("accent", section.title));
    const width = Math.max(0, ...section.rows.map((row) => row.label.length));
    for (const row of section.rows) {
      const label = theme.fg("muted", row.label.padEnd(width));
      const value = colorize(theme, row.role ?? "value", row.value);
      const hint = row.hint ? `  ${theme.fg("dim", row.hint)}` : "";
      lines.push(`  ${label}  ${value}${hint}`);
    }
    if (section.note) lines.push(`  ${theme.fg("dim", section.note)}`);
  }
  if (panel.footer) {
    lines.push("");
    lines.push(theme.fg("dim", panel.footer));
  }
  return lines;
}

/** Plain-text rendering (non-TUI fallback and tests). */
export const PLAIN_PANEL_THEME: ThemeLike = {
  fg: (_color, text) => text,
  bold: (text) => text,
};

export function renderPanelPlain(panel: Panel): string[] {
  return renderPanel(PLAIN_PANEL_THEME, panel);
}

function show(value: unknown): string {
  if (value === null || value === undefined) return "unknown";
  if (typeof value === "number") return value.toLocaleString("en-US");
  return String(value);
}

function yesNoUnknown(value: boolean | null): string {
  if (value === null) return "unknown";
  return value ? "yes" : "no";
}

function booleanRole(value: boolean | null): ValueRole {
  if (value === null) return "unknown";
  return value ? "success" : "dim";
}

function rubPerMillion(value: number | null): string {
  return value === null ? "unknown" : `${value} ₽ / 1M`;
}

function rubOrUnknown(value: number | null): string {
  return value === null ? "unknown" : formatRub(value);
}

/** `/polza-model-info` — grouped, human-readable, facts unchanged. */
export function modelInfoPanel(model: ResolvedModel): Panel {
  const caps = extractInternalCapabilities(model);
  const price = model.pricing.polzaRUB;
  const verification = reasoningVerificationFor(model.id);
  const reasoningObserved = verification.reasoningPayloadObserved || verification.inlineReasoningObserved;
  const reasoningRole: ValueRole = model.capabilities.reasoning.value === true ? "value" : "unknown";

  const sections: PanelSection[] = [
    {
      rows: [
        { label: "Model", value: model.id, role: "accent" },
        { label: "Provider", value: `polza (available: ${model.availability.polza ? "yes" : "no"})`, role: "value" },
      ],
    },
    {
      title: "Limits",
      rows: [
        { label: "Context", value: show(model.limits.contextWindow.value), hint: model.limits.contextWindow.source },
        {
          label: "Max output",
          value: show(model.limits.maxCompletionTokens.value),
          hint: model.limits.maxCompletionTokens.source,
        },
      ],
    },
    {
      title: "Capabilities",
      rows: [
        { label: "Vision", value: yesNoUnknown(model.capabilities.vision.value), role: booleanRole(model.capabilities.vision.value) },
        { label: "Tools", value: yesNoUnknown(caps.tools), hint: `verified: ${yesNoUnknown(model.verifiedToolSupport === "unknown" ? null : model.verifiedToolSupport)}` },
        { label: "Tool choice", value: yesNoUnknown(caps.toolChoice), role: booleanRole(caps.toolChoice) },
        { label: "Reasoning", value: model.capabilities.reasoning.value === true ? "declared" : model.capabilities.reasoning.value === false ? "not declared" : "unknown", role: reasoningRole },
        {
          label: "Effort",
          value: yesNoUnknown(model.capabilities.reasoningEffort.value),
          role: booleanRole(model.capabilities.reasoningEffort.value),
        },
        { label: "Structured", value: yesNoUnknown(caps.structuredOutputs), role: booleanRole(caps.structuredOutputs) },
        {
          label: "Levels",
          value: verification.levelControlVerified === true ? "verified" : "not verified",
          role: verification.levelControlVerified === true ? "success" : "unknown",
        },
        {
          label: "Observed",
          value: reasoningObserved ? "yes" : "no",
          role: reasoningObserved ? "value" : "unknown",
          hint: verification.source,
        },
        ...describeReasoning(verification).map((line) => ({ label: "", value: line, role: "dim" as ValueRole })),
      ],
    },
    {
      title: "Pricing (native RUB, catalog estimate)",
      rows: [
        { label: "Input", value: rubPerMillion(price.promptPerMillion) },
        { label: "Output", value: rubPerMillion(price.completionPerMillion) },
        { label: "Cache read", value: rubPerMillion(price.cacheReadPerMillion) },
        { label: "Cache write", value: rubPerMillion(price.cacheWritePerMillion) },
      ],
      note: "Catalog prices are estimates; billing uses usage.cost_rub.",
    },
    {
      title: "Metadata",
      rows: [
        { label: "Polza", value: "primary", role: "value" },
        { label: "OpenRouter", value: model.openRouterId ? `enrichment (${model.openRouterId})` : "not matched", role: model.openRouterId ? "value" : "unknown" },
        {
          label: "Conflicts",
          value: String(model.conflicts.length),
          role: model.conflicts.length > 0 ? "warning" : "dim",
        },
        {
          label: "Pi eligible",
          value: model.piEligibility.eligible ? "yes" : `no (${model.piEligibility.reasons.join(", ")})`,
          role: model.piEligibility.eligible ? "success" : "warning",
        },
      ],
    },
  ];

  if (caps.internalInputModalities.length > 0) {
    sections[2]!.note = `internal-only input (not sent by Pi): ${caps.internalInputModalities.join(", ")}`;
  }

  if (model.conflicts.length > 0) {
    sections.push({
      title: "Conflicts vs OpenRouter",
      rows: model.conflicts.slice(0, 6).map((conflict) => ({
        label: conflict.field,
        value: `Polza ${JSON.stringify(conflict.polza)}  ·  OpenRouter ${JSON.stringify(conflict.openrouter)}`,
        role: "warning" as ValueRole,
      })),
      note: model.conflicts.length > 6 ? `…and ${model.conflicts.length - 6} more.` : undefined,
    });
  }

  const appliedOverrides = overridesFor(model.id);
  if (appliedOverrides.length > 0) {
    sections.push({
      title: "Verified overrides",
      rows: appliedOverrides.map((override) => ({
        label: override.field,
        value: `${JSON.stringify(override.value)}`,
        role: "success" as ValueRole,
        hint: `${override.source} · ${override.verifiedAt} — ${override.reason}`,
      })),
    });
  }

  return { title: "Polza Model", sections };
}

/** `/polza-balance` — available balance is the headline value. */
export function balancePanel(balance: PolzaBalance): Panel {
  return {
    title: "Polza Balance",
    sections: [
      {
        rows: [
          { label: "Available", value: formatRub(balance.available), role: "accent" },
          { label: "Balance", value: formatRub(balance.amount) },
          { label: "Reserved", value: formatRub(balance.reservedAmount), role: "muted" },
          { label: "Lifetime spent", value: formatRub(balance.spentAmount), role: "muted" },
          { label: "Updated", value: balance.updatedAt ?? "unknown", role: balance.updatedAt ? "dim" : "unknown" },
        ],
      },
    ],
    footer: "Lifetime spent is global account spend, not the current session cost.",
  };
}

/** `/polza-cost` — actual session cost from usage.cost_rub is the headline value. */
export function costPanel(records: readonly PolzaUsageRecord[]): Panel {
  const summary = summarizeRecords(records);
  if (summary.requests === 0) {
    return { title: "Polza — Current Session", sections: [{ rows: [{ label: "Cost", value: "no usage recorded yet", role: "dim" }] }] };
  }

  const sections: PanelSection[] = [
    {
      rows: [
        { label: "Actual cost", value: rubOrUnknown(summary.actualCostRub), role: "accent" },
        { label: "Requests", value: String(summary.requests) },
      ],
    },
    {
      title: "Tokens",
      rows: [
        { label: "Input", value: summary.promptTokens.toLocaleString("en-US") },
        { label: "Cache read", value: summary.cachedTokens.toLocaleString("en-US") },
        { label: "Cache write", value: summary.cacheWriteTokens.toLocaleString("en-US") },
        { label: "Output", value: summary.completionTokens.toLocaleString("en-US") },
        { label: "Reasoning", value: summary.reasoningTokens.toLocaleString("en-US") },
      ],
    },
  ];

  if (summary.models.length > 0) {
    const total = summary.actualCostRub;
    sections.push({
      title: "Models",
      rows: summary.models.map((entry) => ({
        label: entry.modelId,
        value: rubOrUnknown(entry.costRub),
        role: "value" as ValueRole,
        hint: `${entry.requests} req`,
      })),
      note: total === null ? "Some requests reported no cost_rub — their cost is unknown, not estimated." : undefined,
    });
  }

  return {
    title: "Polza — Current Session",
    sections,
    footer: "Actual cost comes from usage.cost_rub (native RUB).",
  };
}
