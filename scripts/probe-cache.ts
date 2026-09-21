/**
 * Diagnostic probe: a cheap cache experiment.
 *
 * Sends two near-identical requests with a large repeated prefix and reports the real cache
 * counters (`cached_tokens`, `cache_write_tokens`) and `cost_rub`.
 *
 * A result where the counters stay zero is a VALID outcome — this probe never tries to force a
 * cache hit or burn money for a nice number.
 *
 * Run: npm run probe:cache [model-id]
 *   default model: openai/gpt-5-nano (automatic prompt caching, cheap, cache-read pricing)
 */
import { fetchBalance, formatRub } from "../.pi/extensions/pi-polza/balance.ts";
import { postChatCompletion, type ChatCompletionRequest } from "../.pi/extensions/pi-polza/chat.ts";
import { normalizeUsage, type RawUsageLike } from "../.pi/extensions/pi-polza/usage.ts";
import { redactJson } from "../.pi/extensions/pi-polza/http.ts";

const DEFAULT_MODEL = "openai/gpt-5-nano";

// ~200 lines of stable text ≈ a few thousand tokens, enough to exceed typical automatic-cache thresholds.
const PREFIX = Array.from(
  { length: 200 },
  (_, i) => `Line ${i + 1}: the quick brown fox jumps over the lazy dog near the riverbank at dawn.`,
).join("\n");

async function runOnce(model: string, label: string) {
  const request: ChatCompletionRequest = {
    model,
    messages: [
      { role: "system", content: `You are a terse assistant.\n\nReference material:\n${PREFIX}` },
      { role: "user", content: "Reply with the single word: ready" },
    ],
    max_tokens: 16,
    temperature: 0,
  };
  const result = await postChatCompletion(request);
  console.log(`\n[${label}] HTTP ${result.status}`);
  if (!result.ok || !result.json) {
    console.log("  body (redacted): " + JSON.stringify(redactJson(result.text)).slice(0, 600));
    return undefined;
  }
  const response = result.json as Record<string, unknown>;
  const usage = response.usage as RawUsageLike | undefined;
  const normalized = normalizeUsage(usage);
  console.log("  raw usage: " + JSON.stringify(redactJson(usage)));
  console.log(
    `  normalized: promptTotal=${normalized.promptTotal} input=${normalized.input} output=${normalized.output} cacheRead=${normalized.cacheRead} cacheWrite=${normalized.cacheWrite} cost_rub=${normalized.costRub ?? "(absent)"}`,
  );
  if (normalized.anomalies.length) console.log("  ANOMALIES: " + normalized.anomalies.join(" | "));
  return { response, normalized };
}

async function main(): Promise<void> {
  const model = process.argv[2] ?? process.env.POLZA_TEST_MODEL ?? DEFAULT_MODEL;
  const before = await fetchBalance();
  console.log(`Model: ${model}`);
  console.log(`Balance before: available=${formatRub(before.available)}`);

  const first = await runOnce(model, "request 1");
  const second = await runOnce(model, "request 2 (identical prefix)");

  if (first && second) {
    const read = second.normalized.cacheRead;
    if (read > 0) {
      console.log(
        `\nCache HIT observed on request 2: cacheRead=${read} tokens, cacheWrite=${second.normalized.cacheWrite}.`,
      );
    } else {
      console.log(
        "\nNo cache hit observed (cached_tokens stayed 0). This is a valid experimental result — no attempt was made to force it.",
      );
    }
  }

  const after = await fetchBalance();
  console.log(`\nBalance after: available=${formatRub(after.available)}`);
}

main().catch((error) => {
  console.error("probe-cache failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
