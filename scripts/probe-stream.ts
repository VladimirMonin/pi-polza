/**
 * Diagnostic probe: the same cheap request in STREAMING mode.
 *
 * Verifies where usage arrives, whether `cost_rub` is present, whether it is only in the final
 * chunk, whether reasoning/cache counters appear, and what precedes `[DONE]`.
 *
 * Run: npm run probe:stream [model-id]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fetchBalance, formatRub } from "../.pi/extensions/pi-polza/balance.ts";
import { streamChatCompletion, type ChatCompletionRequest } from "../.pi/extensions/pi-polza/chat.ts";
import { fetchCatalog, rankUsableChatModelsByPromptPrice } from "../.pi/extensions/pi-polza/catalog.ts";
import { PROJECT_ROOT } from "../.pi/extensions/pi-polza/env.ts";
import { redactJson } from "../.pi/extensions/pi-polza/http.ts";
import { normalizeUsage, type RawUsageLike } from "../.pi/extensions/pi-polza/usage.ts";

const RAW_DIR = resolve(PROJECT_ROOT, "artifacts", "raw");

async function pickModel(): Promise<string> {
  const override = process.argv[2] ?? process.env.POLZA_TEST_MODEL;
  if (override) return override;
  const { models } = await fetchCatalog({ limit: 100 });
  const chosen = rankUsableChatModelsByPromptPrice(models)[0];
  if (!chosen) throw new Error("No usable chat model found.");
  console.log(`Auto-selected cheapest usable chat model: ${chosen.id}`);
  return chosen.id;
}

async function main(): Promise<void> {
  const model = await pickModel();
  const before = await fetchBalance();
  console.log(`Balance before: available=${formatRub(before.available)}`);

  const request: ChatCompletionRequest = {
    model,
    messages: [{ role: "user", content: "Count from 1 to 5, comma separated." }],
    max_tokens: 32,
    temperature: 0,
    stream_options: { include_usage: true },
  };

  const events: Array<{ index: number; event?: string; dataType: string; hasUsage: boolean; rawLength: number }> = [];
  let finalUsage: unknown = undefined;
  let usageEventIndex = -1;
  let doneIndex = -1;
  let text = "";
  const reasoningChunks: string[] = [];

  let index = 0;
  console.log("\nConsuming SSE stream...");
  for await (const evt of streamChatCompletion(request)) {
    const data = evt.data as Record<string, unknown> | null;
    const hasUsage = Boolean(data && typeof data === "object" && "usage" in data && data.usage);
    if (hasUsage) {
      finalUsage = (data as Record<string, unknown>).usage;
      usageEventIndex = index;
    }
    if (evt.data === null) doneIndex = index;

    const choices = data?.choices as Array<Record<string, unknown>> | undefined;
    const delta = choices?.[0]?.delta as Record<string, unknown> | undefined;
    if (typeof delta?.content === "string") text += delta.content;
    if (typeof delta?.reasoning_content === "string") reasoningChunks.push(delta.reasoning_content);
    if (typeof delta?.reasoning === "string") reasoningChunks.push(delta.reasoning);

    events.push({
      index,
      ...(evt.event ? { event: evt.event } : {}),
      dataType: evt.data === null ? "[DONE]" : data && typeof data === "object" ? ((data.object as string) ?? "object") : typeof evt.data,
      hasUsage,
      rawLength: evt.raw.length,
    });
    index += 1;
  }

  console.log(`Received ${events.length} SSE events.`);
  console.log(`First event: ${JSON.stringify(events[0])}`);
  console.log(`Last two events: ${JSON.stringify(events.slice(-2))}`);
  console.log(`usage appeared in event #${usageEventIndex} of ${events.length - 1}; [DONE] at #${doneIndex}`);
  console.log(`Assembled text: ${JSON.stringify(text)}`);
  if (reasoningChunks.length) console.log(`Reasoning chunks: ${reasoningChunks.length}`);

  console.log("\nFinal usage (raw, redacted):");
  console.log("  " + JSON.stringify(redactJson(finalUsage), null, 2).split("\n").join("\n  "));

  const normalized = normalizeUsage(finalUsage as RawUsageLike | undefined);
  console.log("\nnormalized usage:");
  console.log("  promptTotal " + normalized.promptTotal + "  input " + normalized.input + "  output " + normalized.output);
  console.log("  cacheRead " + normalized.cacheRead + "  cacheWrite " + normalized.cacheWrite + "  reasoning " + normalized.reasoning);
  console.log("  totalTokens " + normalized.totalTokens);
  console.log("  cost_rub " + (normalized.costRub === null ? "(absent)" : normalized.costRub));
  if (normalized.anomalies.length) console.log("  ANOMALIES: " + normalized.anomalies.join(" | "));

  const after = await fetchBalance();
  console.log(`\nBalance after: available=${formatRub(after.available)}`);

  mkdirSync(RAW_DIR, { recursive: true });
  writeFileSync(
    resolve(RAW_DIR, "stream-events.json"),
    JSON.stringify(redactJson({ model, request, events, finalUsage, assembledText: text, normalized }), null, 2) + "\n",
  );
  console.log("Wrote redacted SSE sequence to artifacts/raw/stream-events.json (git-ignored)");
}

main().catch((error) => {
  console.error("probe-stream failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
