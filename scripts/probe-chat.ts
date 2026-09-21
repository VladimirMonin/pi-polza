/**
 * Diagnostic probe: one cheap NON-STREAMING chat completion against Polza.
 *
 * Goal: prove the real response schema and the semantics of `usage`, especially
 * `usage.cost_rub` (actual billed RUB) and the cache/reasoning counters.
 *
 * It reads the account balance before and after, but does NOT treat the balance delta as the
 * request cost — that is only an informational cross-check.
 *
 * Run: npm run probe:chat [model-id]
 *   POLZA_TEST_MODEL=openai/gpt-oss-20b npm run probe:chat
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatRub, fetchBalance } from "../.pi/extensions/pi-polza/balance.ts";
import { CHAT_COMPLETIONS_URL, postChatCompletion, type ChatCompletionRequest } from "../.pi/extensions/pi-polza/chat.ts";
import { fetchCatalog, rankUsableChatModelsByPromptPrice } from "../.pi/extensions/pi-polza/catalog.ts";
import { PROJECT_ROOT } from "../.pi/extensions/pi-polza/env.ts";
import { redactJson } from "../.pi/extensions/pi-polza/http.ts";
import { normalizeUsage, type RawUsageLike } from "../.pi/extensions/pi-polza/usage.ts";

const RAW_DIR = resolve(PROJECT_ROOT, "artifacts", "raw");

async function pickModel(): Promise<string> {
  const override = process.argv[2] ?? process.env.POLZA_TEST_MODEL;
  if (override) {
    console.log(`Using model from override: ${override}`);
    return override;
  }
  const { models } = await fetchCatalog({ limit: 100 });
  const ranked = rankUsableChatModelsByPromptPrice(models);
  const chosen = ranked[0];
  if (!chosen) throw new Error("No usable chat model with prompt+completion pricing found.");
  console.log(
    `Auto-selected cheapest usable chat model: ${chosen.id} (prompt ${chosen.top_provider?.pricing?.prompt_per_million} RUB, completion ${chosen.top_provider?.pricing?.completion_per_million} RUB)`,
  );
  return chosen.id;
}

function printUsageBlock(label: string, usage: unknown): void {
  console.log(`\n${label}`);
  console.log("  raw usage keys: " + (usage && typeof usage === "object" ? Object.keys(usage).join(", ") : "(none)"));
  console.log("  " + JSON.stringify(redactJson(usage), null, 2).split("\n").join("\n  "));
}

async function main(): Promise<void> {
  const model = await pickModel();

  const before = await fetchBalance();
  console.log(`Balance before: available=${formatRub(before.available)} spent=${formatRub(before.spentAmount)}`);

  const request: ChatCompletionRequest = {
    model,
    messages: [{ role: "user", content: "Reply with exactly one word: pong" }],
    max_tokens: 16,
    temperature: 0,
  };

  console.log(`\nPOST ${CHAT_COMPLETIONS_URL} (non-streaming, max_tokens=16)`);
  const started = Date.now();
  const result = await postChatCompletion(request);
  const elapsed = Date.now() - started;
  console.log(`HTTP ${result.status} in ${elapsed}ms`);

  if (!result.ok || !result.json) {
    console.log("Body (redacted): " + JSON.stringify(redactJson(result.text)).slice(0, 1000));
    throw new Error(`Chat request failed with HTTP ${result.status}`);
  }

  const response = result.json as Record<string, unknown>;
  console.log("\nTop-level response keys: " + Object.keys(response).join(", "));
  const choices = response.choices as Array<Record<string, unknown>> | undefined;
  const firstChoice = choices?.[0];
  console.log("finish_reason: " + String(firstChoice?.finish_reason));
  console.log("message: " + JSON.stringify(redactJson(firstChoice?.message)));

  printUsageBlock("usage (raw, redacted):", response.usage);

  const normalized = normalizeUsage(response.usage as RawUsageLike | undefined);
  console.log("\nnormalized usage:");
  console.log("  promptTotal  " + normalized.promptTotal);
  console.log("  input        " + normalized.input + "  (prompt - cacheRead - cacheWrite)");
  console.log("  output       " + normalized.output);
  console.log("  cacheRead    " + normalized.cacheRead);
  console.log("  cacheWrite   " + normalized.cacheWrite);
  console.log("  reasoning    " + normalized.reasoning);
  console.log("  totalTokens  " + normalized.totalTokens);
  console.log("  cost_rub     " + (normalized.costRub === null ? "(absent)" : normalized.costRub));
  console.log("  cost (raw)   " + (normalized.costRaw === null ? "(absent)" : normalized.costRaw));
  console.log("  currency     " + (normalized.currency ?? "(absent)"));
  if (normalized.anomalies.length) {
    console.log("  ANOMALIES: " + normalized.anomalies.join(" | "));
  }

  const after = await fetchBalance();
  const delta = after.available - before.available;
  console.log(`\nBalance after: available=${formatRub(after.available)} spent=${formatRub(after.spentAmount)}`);
  console.log(`Balance delta (informational, NOT authoritative): ${formatRub(delta)}`);

  mkdirSync(RAW_DIR, { recursive: true });
  writeFileSync(
    resolve(RAW_DIR, "chat-nonstreaming.json"),
    JSON.stringify(
      redactJson({
        model,
        request,
        status: result.status,
        elapsedMs: elapsed,
        response,
        normalized,
        balanceBefore: before,
        balanceAfter: after,
      }),
      null,
      2,
    ) + "\n",
  );
  console.log("\nWrote redacted dump to artifacts/raw/chat-nonstreaming.json (git-ignored)");
}

main().catch((error) => {
  console.error("probe-chat failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
