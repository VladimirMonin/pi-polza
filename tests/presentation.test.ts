/**
 * Presentation semantics: which theme role each fragment gets, and that unknown never becomes 0.
 * Asserts roles/content, never concrete ANSI.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { recordFromUsage } from "../.pi/extensions/pi-polza/accounting.ts";
import { resolveModel } from "../.pi/extensions/pi-polza/metadata/resolver.ts";
import {
  balancePanel,
  costPanel,
  modelInfoPanel,
  renderPanel,
  type ThemeLike,
} from "../.pi/extensions/pi-polza/presentation.ts";
import { openRouterModel, polzaModel } from "./fixtures.ts";

/** Theme stub that records which semantic role each fragment was rendered with. */
function recordingTheme(): { theme: ThemeLike; calls: Array<{ color: string; text: string }> } {
  const calls: Array<{ color: string; text: string }> = [];
  return {
    calls,
    theme: {
      fg: (color, text) => {
        calls.push({ color, text });
        return `[${color}]${text}`;
      },
      bold: (text) => `*${text}*`,
    },
  };
}

function has(calls: Array<{ color: string; text: string }>, color: string, text: string): boolean {
  return calls.some((c) => c.color === color && c.text.includes(text));
}

test("renderPanel uses accent headings, muted labels and normal values", () => {
  const { theme, calls } = recordingTheme();
  const lines = renderPanel(theme, {
    title: "Polza Test",
    sections: [{ title: "Limits", rows: [{ label: "Context", value: "32,768" }] }],
  });
  assert.ok(has(calls, "accent", "Polza Test"));
  assert.ok(calls.some((c) => c.color === "accent" && c.text === "*Polza Test*"), "title is bold+accent");
  assert.ok(has(calls, "accent", "Limits"));
  assert.ok(has(calls, "muted", "Context"));
  assert.ok(has(calls, "text", "32,768"));
  assert.ok(lines.length >= 3);
});

test("modelInfoPanel reports unknown for missing limits, never 0", () => {
  const model = resolveModel(polzaModel({ id: "vendor/sparse", contextLength: null, maxCompletionTokens: null }), null);
  const plain = renderPanel({ fg: (_c, t) => t, bold: (t) => t }, modelInfoPanel(model)).join("\n");
  assert.match(plain, /Context\s+unknown/);
  assert.match(plain, /Max output\s+unknown/);
  assert.doesNotMatch(plain, /Context\s+0/);
});

test("modelInfoPanel marks metadata conflicts as warnings", () => {
  const polza = polzaModel({ id: "vendor/model", contextLength: 1000, maxCompletionTokens: 500 });
  const openrouter = openRouterModel({ id: "vendor/model", contextLength: 2000, maxCompletionTokens: 500 });
  const model = resolveModel(polza, openrouter);
  assert.ok(model.conflicts.length > 0, "fixture must produce a conflict");

  const { theme, calls } = recordingTheme();
  renderPanel(theme, modelInfoPanel(model));
  assert.ok(calls.some((c) => c.color === "warning" && c.text === String(model.conflicts.length)), "conflict count is a warning");
  assert.ok(calls.some((c) => c.color === "warning" && c.text.includes("Polza")), "conflict detail is a warning");
});

test("costPanel highlights actual cost as accent and keeps unknown explicit", () => {
  const records = [recordFromUsage("qwen/qwen3.5-9b", { prompt_tokens: 10, completion_tokens: 1, cost_rub: 0.0004 }, 1)];
  const { theme, calls } = recordingTheme();
  renderPanel(theme, costPanel(records));
  assert.ok(calls.some((c) => c.color === "accent" && c.text.includes("₽")), "actual cost is accent");
  assert.ok(has(calls, "muted", "qwen/qwen3.5-9b"), "model label present");

  const unknown = [recordFromUsage("qwen/qwen3.5-9b", { prompt_tokens: 10, completion_tokens: 1 }, 1)];
  const plain = renderPanel({ fg: (_c, t) => t, bold: (t) => t }, costPanel(unknown)).join("\n");
  assert.match(plain, /Actual cost\s+unknown/);
  assert.match(plain, /cost is unknown, not estimated/);
});

test("modelInfoPanel describes reasoning observation in human terms", () => {
  const plain = (m: ReturnType<typeof resolveModel>): string =>
    renderPanel({ fg: (_c, t) => t, bold: (t) => t }, modelInfoPanel(m)).join("\n");

  // A model with a verified live reasoning payload must not say "none".
  const verified = resolveModel(polzaModel({ id: "openai/gpt-oss-20b" }), null);
  const verifiedText = plain(verified);
  assert.match(verifiedText, /Observed reasoning\s+(usage payload|inline content)/);
  assert.doesNotMatch(verifiedText, /Observed\s+(yes|no)\b/);

  // A model with no runtime evidence reads as a plain, honest "none" (never "no none").
  const unverified = resolveModel(polzaModel({ id: "vendor/no-evidence" }), null);
  assert.match(plain(unverified), /Observed reasoning\s+none/);
});

test("balancePanel makes the available balance the accent headline", () => {
  const { theme, calls } = recordingTheme();
  renderPanel(
    theme,
    balancePanel({ amount: 43.5, available: 43.5, reservedAmount: 0, spentAmount: 1689, currency: "RUB" }),
  );
  assert.ok(calls.some((c) => c.color === "accent"), "some value is accent");
  assert.ok(has(calls, "muted", "Reserved"));
  assert.ok(has(calls, "muted", "Lifetime spent"));
});
