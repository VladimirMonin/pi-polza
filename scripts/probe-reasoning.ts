/**
 * Diagnostic probe: verified reasoning evidence per family.
 *
 * Strictly separates six independent properties (see `reasoning.ts`). `reasoning_tokens === 0` is
 * reported as "counter not reporting", never as "reasoning disabled".
 *
 * This is a LIVE probe (costs money) — it is not part of `npm test`.
 *
 * Run: npm run probe:reasoning [-- --max-tokens=256 --prompt="..." --models=a,b]
 */
import { fetchBalance, formatRub } from "../.pi/extensions/pi-polza/balance.ts";
import { postChatCompletion, type ChatCompletionRequest } from "../.pi/extensions/pi-polza/chat.ts";
import { loadDotEnv } from "../.pi/extensions/pi-polza/env.ts";
import { normalizeUsage, type RawUsageLike } from "../.pi/extensions/pi-polza/usage.ts";

const DEFAULT_MODELS = [
  "openai/gpt-oss-20b",
  "google/gemini-2.5-flash-lite",
  "anthropic/claude-haiku-4.5",
  "qwen/qwen3.5-9b",
  "deepseek/deepseek-r1-distill-llama-70b",
];

/** "" = omit the field entirely (Pi's "off" when no off-value is mapped). */
const EFFORTS = ["", "none", "minimal", "low", "medium", "high", "xhigh", "max"];
const REASONING_FIELD = /reasoning|thinking/i;

function argValue(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

interface Accumulator {
  anyError: boolean;
  maxReasoning: number;
  offReasoning: number;
  noneReasoning: number;
  fields: Set<string>;
  tokensByLevel: Record<string, number>;
  inlineContent: boolean;
  offInlineLike: boolean;
}

async function main(): Promise<void> {
  loadDotEnv();
  const models = argValue("models", DEFAULT_MODELS.join(",")).split(",");
  const maxTokens = Number(argValue("max-tokens", "256"));
  const prompt = argValue("prompt", "Compute 37*41. Think briefly, then output only the number.");

  const before = await fetchBalance();
  console.log(`Balance before: ${formatRub(before.available)}  (${models.length * EFFORTS.length} requests, max_tokens=${maxTokens})\n`);

  let spend = 0;
  let requests = 0;

  for (const model of models) {
    const acc: Accumulator = {
      anyError: false,
      maxReasoning: 0,
      offReasoning: 0,
      noneReasoning: 0,
      fields: new Set(),
      tokensByLevel: {},
      inlineContent: false,
      offInlineLike: false,
    };
    const lines: string[] = [];

    for (const effort of EFFORTS) {
      const body: ChatCompletionRequest = {
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: maxTokens,
        temperature: 0,
      };
      if (effort !== "") body.reasoning_effort = effort;

      const res = await postChatCompletion(body);
      requests += 1;
      if (!res.ok) acc.anyError = true;

      const json = res.json as { choices?: Array<{ message?: Record<string, unknown> }>; usage?: RawUsageLike } | undefined;
      const message = json?.choices?.[0]?.message ?? {};
      const content = typeof message.content === "string" ? message.content : "";
      for (const key of Object.keys(message)) {
        if (key !== "role" && key !== "content" && REASONING_FIELD.test(key)) acc.fields.add(`message.${key}`);
      }
      // Heuristic only for the report: multi-step working inside content is a hint, not proof.
      const inlineLike = content.length > 120 || /\n/.test(content);
      if (inlineLike) acc.inlineContent = true;
      if (inlineLike && (effort === "" || effort === "none")) acc.offInlineLike = true;

      const usage = res.ok ? normalizeUsage(json?.usage ?? {}) : null;
      const reasoning = usage?.reasoning ?? 0;
      if (usage?.costRub) spend += usage.costRub;
      acc.maxReasoning = Math.max(acc.maxReasoning, reasoning);
      acc.tokensByLevel[effort || "(off)"] = reasoning;
      if (effort === "") acc.offReasoning = reasoning;
      if (effort === "none") acc.noneReasoning = reasoning;

      const outcome = res.ok ? `ok reasoning=${reasoning} contentLen=${content.length}` : `HTTP ${res.status}`;
      lines.push(`    ${(effort || "(off: no field)").padEnd(18)} ${outcome}`);
      await new Promise((r) => setTimeout(r, 150));
    }

    const usageReported = acc.maxReasoning > 0;
    const payloadObserved = acc.fields.size > 0 || usageReported;
    const inlineObserved = acc.inlineContent;
    // Positive proof only: a channel that demonstrably reports reasoning (usageReported) AND zero
    // on it for off/none AND no inline working. Otherwise false (still reasoning) or unverified.
    const offVerified = !usageReported
      ? null
      : acc.offReasoning === 0 && acc.noneReasoning === 0 && !acc.offInlineLike;
    const offBehavior = offVerified === true ? "disabled" : offVerified === false ? "still-reasoning" : "unverified";
    const distinct = new Set(Object.values(acc.tokensByLevel));
    const levelControlHint = usageReported && distinct.size > 1 ? "possible (NOT verified)" : "unverified";

    console.log(`${model}\n${lines.join("\n")}`);
    console.log(
      `    EVIDENCE request_supported=${!acc.anyError} payload_observed=${payloadObserved} inline_observed=${inlineObserved}` +
        ` usage_reported=${usageReported} level_control=${levelControlHint}` +
        ` off_verified=${offVerified === null ? "unverified" : offVerified} off_behavior=${offBehavior}` +
        ` fields=[${[...acc.fields].join(", ") || "none"}]`,
    );
    console.log(`    tokens by level: ${JSON.stringify(acc.tokensByLevel)}\n`);
  }

  const after = await fetchBalance();
  console.log(`Requests: ${requests}   measured cost_rub: ${spend.toFixed(8)}`);
  console.log(`Balance after: ${formatRub(after.available)} (delta ${formatRub(before.available - after.available)})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
