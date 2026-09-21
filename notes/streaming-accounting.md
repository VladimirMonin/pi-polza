# Streaming accounting tap

## Problem

Iteration 1 captured `usage.cost_rub` by cloning each response and reading the clone with
`clone.text()`. It worked, but it materialized the **entire** response body on the pi-polza side and
relied on `ReadableStream.tee()` semantics.

## Chosen architecture

A transparent pass-through `TransformStream` inserted by the injected `fetch` (`tap.ts`):

```
Polza SSE ──▶ fetch (tappingFetch) ──▶ TransformStream ──▶ Pi transport (unchanged)
                                            │
                                            └──▶ SseUsageScanner (bounded to one SSE line)
```

- `stream.ts` still delegates to the bundled `openAICompletionsApi().streamSimple`. **No custom
  transport, no custom SSE stack, no custom tool/reasoning parser.**
- The tap is the only consumer path now (Pi reads the tapped body), so it must be a synchronous
  pass-through — it enqueues each chunk immediately after decoding a copy for the scanner.
- `SseUsageScanner` holds only the trailing partial line and remembers the **last** chunk carrying
  `usage` (the final content chunk before `[DONE]`).
- Non-SSE responses (`application/json`) are accumulated and parsed once at `flush()`; they are small.
- `report()` fires **at most once per response**, which is the accounting dedup guarantee at tap level.

### Why not the alternatives

| Option | Verdict |
|---|---|
| `response.clone()` + `text()` | Materializes whole body; tee depends on consumer pacing. Replaced. |
| `options.fetch` returning a hand-rolled stream | This *is* what we do — but minimal: only observe, never rewrite. |
| Custom OpenAI client | Rejected: duplicates transport, tools, reasoning, cache. |
| `tee()` manually | Same drawbacks as clone; the transform is simpler and single-path. |

## Guarantees

- **No full-body buffering**: memory bounded by one SSE line (+ TextDecoder carry).
- **No added TTFT**: transform is synchronous; `controller.enqueue(chunk)` happens before any parsing.
- **Backpressure preserved**: single stream path, no tee.
- **Chunks unchanged**: byte-identical forwarding (unit-tested).
- **Failure isolation**: any tap error is swallowed; the chunk still passes through.

## Measurements (`npm run probe:ttft`, qwen/qwen3.5-9b)

```
A. plain pass-through     TTFT 207ms  total 261ms
B. incremental tap        TTFT 208ms  total 272ms   (TTFT overhead +1 ms)
C. old clone+full text    TTFT 219ms  total 290ms   (buffered 1057 chars)
```

The old approach did not delay Pi's TTFT (the clone tee ran in parallel), but it did materialize the
full body. The new tap adds ~1 ms of noise-level overhead and materializes nothing.

## Regression coverage

Unit (`tests/tap.test.ts`): last-usage-wins, CRLF/keep-alive/partial line, exactly-one report,
TTFT-does-not-wait-for-completion, JSON body, no-usage, multibyte split across chunks, null body.
Byte-identity is covered there, since live A/B/C are separate requests.

Live: single stream → exactly 1 `polza-cost` entry; tool loop → exactly 2 entries.

## Known limitations

- If a provider ever emits `usage` in more than one chunk, only the last is kept (intended).
- Extremely large single SSE lines are bounded by that line, not by a hard cap.
- Non-SSE bodies are accumulated (acceptable: they are small and bounded by the response).
