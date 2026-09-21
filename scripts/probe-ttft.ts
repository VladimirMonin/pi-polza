/**
 * Diagnostic probe: TTFT / overhead of the accounting tap.
 *
 * For the same cheap streaming request, measures end-to-end time from request start to the first
 * body chunk:
 *   A. plain pass-through (no tap)                → baseline
 *   B. incremental TransformStream tap            → TTFT + usage captured at flush
 *   C. OLD approach: response.clone() + full text → TTFT + bytes materialized
 *
 * Run: npm run probe:ttft [model-id]
 */
import { extractUsageFromBody, recordFromUsage, type PolzaUsageRecord } from "../.pi/extensions/pi-polza/accounting.ts";
import { CHAT_COMPLETIONS_URL, type ChatCompletionRequest } from "../.pi/extensions/pi-polza/chat.ts";
import { fetchCatalog, rankUsableChatModelsByPromptPrice } from "../.pi/extensions/pi-polza/catalog.ts";
import { polzaFetch } from "../.pi/extensions/pi-polza/http.ts";
import { tapResponseForUsage } from "../.pi/extensions/pi-polza/tap.ts";

async function pickModel(): Promise<string> {
  const override = process.argv[2] ?? process.env.POLZA_TEST_MODEL;
  if (override) return override;
  const { models } = await fetchCatalog({ limit: 100 });
  const chosen = rankUsableChatModelsByPromptPrice(models)[0];
  if (!chosen) throw new Error("No usable chat model found.");
  return chosen.id;
}

interface Measure {
  ttftMs: number;
  totalMs: number;
  text: string;
}

async function measure(response: Response, start: number): Promise<Measure> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let ttftMs = -1;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (ttftMs < 0) ttftMs = performance.now() - start;
    text += decoder.decode(value, { stream: true });
  }
  return { ttftMs, totalMs: performance.now() - start, text };
}

function requestAndFetch(model: string, body: ChatCompletionRequest): Promise<Response> {
  return polzaFetch(CHAT_COMPLETIONS_URL, { method: "POST", body, headers: { Accept: "text/event-stream" } });
}

async function main(): Promise<void> {
  const model = await pickModel();
  const body: ChatCompletionRequest = {
    model,
    messages: [{ role: "user", content: "Say hi in one word." }],
    max_tokens: 16,
    temperature: 0,
    stream: true,
  };
  console.log(`Model: ${model}`);

  // warm up TLS/connection so the comparison is about the tap, not DNS
  await requestAndFetch(model, body).then((r) => r.text());

  // A. baseline
  let start = performance.now();
  const a = await measure(await requestAndFetch(model, body), start);

  // B. incremental tap
  let captured: PolzaUsageRecord | null = null;
  start = performance.now();
  const tapped = tapResponseForUsage(await requestAndFetch(model, body), {
    onUsage: (u) => {
      captured = recordFromUsage(model, u);
    },
  });
  const b = await measure(tapped, start);

  // C. old clone + full text
  let oldBytes = 0;
  start = performance.now();
  const cRes = await requestAndFetch(model, body);
  void cRes
    .clone()
    .text()
    .then((t) => {
      oldBytes = t.length;
    })
    .catch(() => {});
  const c = await measure(cRes, start);
  await new Promise((resolve) => setTimeout(resolve, 100));

  const ttftDelta = Math.round(b.ttftMs - a.ttftMs);
  console.log("\nA. plain pass-through     TTFT %sms  total %sms", a.ttftMs.toFixed(0), a.totalMs.toFixed(0));
  console.log("B. incremental tap        TTFT %sms  total %sms   (TTFT overhead %s%d ms)", b.ttftMs.toFixed(0), b.totalMs.toFixed(0), ttftDelta >= 0 ? "+" : "", ttftDelta);
  console.log("C. old clone+full text    TTFT %sms  total %sms   (buffered %d chars)", c.ttftMs.toFixed(0), c.totalMs.toFixed(0), oldBytes);
  console.log("\nUsage captured by tap B:", JSON.stringify(captured));
  console.log("Old approach cost_rub:", extractUsageFromBody(c.text)?.cost_rub ?? null);
  console.log("Note: A/B/C are separate requests (content differs); byte-identity of the tap is covered by tests/tap.test.ts.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
