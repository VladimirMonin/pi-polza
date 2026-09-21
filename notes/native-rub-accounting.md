# Native RUB accounting (#20)

Goal: keep Polza's `usage.cost_rub` for every real request **without rewriting Pi's transport** and
without breaking streaming, reasoning or tool calls.

## The problem

Pi's built-in `openai-completions` transport normalizes usage in `parseChunkUsage()` and builds a
**fresh** usage object:

```js
const input = Math.max(0, promptTokens - cacheReadTokens - cacheWriteTokens);
const usage = { input, output, cacheRead, cacheWrite, reasoning, totalTokens, cost: {…} };
calculateCost(model, usage);
```

Any field Pi does not model — including Polza's `cost_rub` — is dropped. There is also no event that
exposes raw provider chunks (`after_provider_response` carries only status + headers).

## Investigation (least-invasive first)

| # | Option | Result |
|---|---|---|
| 1 | Wrap the existing `streamSimple` | ✅ possible — `registerProvider` accepts `streamSimple`, and it can delegate to the bundled implementation |
| 2 | Reuse the internal OpenAI-compatible stream/parser | ✅ `@earendil-works/pi-ai/compat` exports `openAICompletionsApi()`, whose `streamSimple` is the exact built-in implementation |
| 3 | Intercept the raw chunk before `parseChunkUsage` | ✅ via `options.fetch`: `createClient(..., options.fetch, ...)` uses the injected fetch; a wrapper can clone the `Response` and read the raw body in parallel |
| 4 | Extend the existing parser | ❌ no extension hook exists; would require forking upstream code |
| 5 | Fully custom SSE transport | ❌ unnecessary |

`options.onResponse` is **not** usable: `ProviderResponse` = `{ status, headers }`, no body.
`options.fetch` is the only clean interception point.

## Chosen architecture (non-invasive)

```
Polza HTTP/SSE
      ↓
Pi built-in openai-completions transport   (unchanged: streaming, reasoning, tool calls, cache)
      │
      ├── normal Pi events + Pi usage         → Pi session (USD cost = 0, compatibility placeholder)
      │
      └── response.clone() read by our fetch wrapper
                   ↓
            extract usage.cost_rub
                   ↓
            PolzaUsageRecord
                   ↓
            pi.appendEntry("polza-cost", record)   → session JSONL (custom entry)
                   ↓
            extension-owned accumulator → /polza-cost
```

We never reimplement the transport. The wrapper only **taps the response body** and records.

Modules:

- `accounting.ts` — framework-agnostic: `PolzaUsageRecord`, SSE/JSON usage extraction, accumulator.
- `stream.ts` — Pi-specific `streamSimple` wrapper that injects the tapping `fetch`.

## PolzaUsageRecord

```ts
{
  timestamp: number;          // ms
  modelId: string;
  provider: "polza";
  promptTokens: number;       // full input
  cachedTokens: number;
  cacheWriteTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  costRub: number | null;     // authoritative; null = unknown, never recomputed
}
```

`cost_rub` is **never recomputed** from tokens × catalog price. If absent → `null` (unknown).
A separate `estimatedCostRub` may exist elsewhere but is never mixed in.

Session id / turn id: Pi does not expose a stable turn id at the fetch interception point, so we do
**not** invent one. Records are attributed by model + timestamp. Subagent attribution is designed for
but not implemented (a future record field `agentId?`).

## Streaming

- The response is cloned immediately, before Pi consumes it, so the final usage chunk is not lost.
- The last `data:` JSON containing `usage` is the authoritative one; `[DONE]` is ignored.
- The tap only reads the body; it does not inject anything into Pi's stream, so usage events cannot
  leak into user text and reasoning chunks are untouched.
- Exactly one record per API request: the fetch wrapper runs once per HTTP request.

## Accumulator

Extension-owned, in-memory, per session. Computes:

- request count, total tokens, cache tokens, reasoning tokens;
- actual cost total (sum of `cost_rub`);
- cost per model.

Data shape already carries `agentId?`/`modelId` so cost per agent/subagent can be added later
without migration.

## Persistence options (documented; POC uses B+C)

| Option | Description | POC |
|---|---|---|
| A | runtime-only accumulator | used as the live view |
| B | custom session entries (`pi.appendEntry`) | ✅ used (records survive in JSONL) |
| C | rebuild from JSONL on `session_start` | ✅ used (`getEntries()` filter `customType === "polza-cost"`) |
| D | separate sidecar ledger | not built |

A sidecar ledger (D) is the cleanest for cross-session/multi-agent accounting later; deferred.

## Multi-request turns

One user turn can produce several API requests (e.g. tool call → result → continuation). Each HTTP
request is tapped independently, so session cost = `request1.cost_rub + request2.cost_rub + …`.
This is verified in #21 (tool loop).

## Success criteria mapping

| Criterion | Where |
|---|---|
| cost_rub not lost | fetch tap + session custom entries |
| streaming/non-streaming correct | `extractUsageFromBody` handles both |
| exactly one record per request | fetch wrapper invocation count |
| Pi usage still works | transport untouched |
| reasoning/cache not broken | tap is read-only |
| multiple requests sum | accumulator |
| catalog price ≠ actual | `costRub` only from runtime |
| RUB never in Pi USD cost | mapper zeros + no FX |
| `/polza-cost` shows RUB | command |

## Risks

- Body tap buffers the full SSE response (small; acceptable). If a provider ever streams very large
  bodies this should switch to incremental parsing.
- `Response.clone()` requires an unread body; we clone before returning, which is the case here.
- If a future Pi version changes `options.fetch` plumbing, the tap must be re-verified (covered by
  the live acceptance check).
