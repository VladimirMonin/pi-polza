/**
 * LIVE integration tests (real network, real money, tiny amounts).
 *
 * Run: npm run test:live   (requires POLZA_API_KEY)
 * Not picked up by `npm test`.
 */
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { fetchBalance } from "../.pi/extensions/pi-polza/balance.ts";
import { postChatCompletion, streamChatCompletion, type ChatCompletionRequest } from "../.pi/extensions/pi-polza/chat.ts";
import { normalizeUsage, type RawUsageLike } from "../.pi/extensions/pi-polza/usage.ts";
import { LIVE_MAX_TOKENS, addCost, chargeRequest, cheapLiveModel, hasLiveKey, liveReport } from "./helpers.ts";

const enabled = hasLiveKey();

describe("Polza live", { skip: enabled ? false : "POLZA_API_KEY not set" }, () => {
  after(() => console.log(`\n${liveReport()}`));

  test("balance endpoint is reachable and reports RUB", async () => {
    const balance = await fetchBalance();
    assert.equal(balance.currency, "RUB");
    assert.ok(Number.isFinite(balance.available));
  });

  test("non-streaming chat returns authoritative cost_rub", async () => {
    chargeRequest();
    const model = await cheapLiveModel();
    const result = await postChatCompletion({
      model,
      messages: [{ role: "user", content: "Reply with one word." }],
      max_tokens: LIVE_MAX_TOKENS,
      temperature: 0,
    });
    assert.equal(result.ok, true, `HTTP ${result.status}`);
    const usage = normalizeUsage((result.json as { usage?: RawUsageLike }).usage ?? {});
    addCost(usage.costRub);
    assert.equal(typeof usage.costRub, "number");
    assert.ok((usage.promptTotal ?? 0) > 0);
  });

  test("streaming chat delivers usage with cost_rub", async () => {
    chargeRequest();
    const model = await cheapLiveModel();
    let lastUsage: RawUsageLike | null = null;
    for await (const event of streamChatCompletion({
      model,
      messages: [{ role: "user", content: "Reply with one word." }],
      max_tokens: LIVE_MAX_TOKENS,
      temperature: 0,
    } satisfies ChatCompletionRequest)) {
      const data = event.data as { usage?: RawUsageLike } | null;
      if (data && data.usage) lastUsage = data.usage;
    }
    assert.ok(lastUsage, "no usage chunk before [DONE]");
    const usage = normalizeUsage(lastUsage!);
    addCost(usage.costRub);
    assert.equal(typeof usage.costRub, "number");
  });

  test("model emits a tool call when tools are offered", async () => {
    chargeRequest();
    const model = process.env.POLZA_LIVE_TOOL_MODEL?.trim() || "openai/gpt-oss-20b";
    const result = await postChatCompletion({
      model,
      messages: [{ role: "user", content: "Call the ping tool with value 1." }],
      max_tokens: 64,
      temperature: 0,
      tools: [
        {
          type: "function",
          function: { name: "ping", description: "Ping", parameters: { type: "object", properties: { value: { type: "number" } }, required: ["value"] } },
        },
      ],
      tool_choice: "auto",
    });
    assert.equal(result.ok, true, `HTTP ${result.status}`);
    const usage = normalizeUsage((result.json as { usage?: RawUsageLike }).usage ?? {});
    addCost(usage.costRub);
    const calls = (result.json as { choices?: Array<{ message?: { tool_calls?: unknown[] } }> }).choices?.[0]?.message?.tool_calls;
    assert.ok(Array.isArray(calls) && calls.length > 0, "no tool_calls in response");
  });
});
