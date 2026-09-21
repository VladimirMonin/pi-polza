# Usage experiment — live Polza behaviour

All numbers below come from real requests against `https://polza.ai/api/v1/chat/completions`.
No value is assumed from documentation.

## 1. Non-streaming response shape

Request (cheapest usable chat model auto-selected): `qwen/qwen3.5-9b`, `max_tokens: 16`.

Response top-level keys: `id, object, created, model, choices, provider, usage`.

Observed `usage` (verbatim, no secrets):

```json
{
  "prompt_tokens": 19,
  "completion_tokens": 2,
  "total_tokens": 21,
  "completion_tokens_details": null,
  "prompt_tokens_details": null,
  "server_tool_use": null,
  "cost_rub": 0.00004203,
  "cost": 0.00004203,
  "plugins": null
}
```

Conclusions:

- `usage.cost_rub` **is present** and is the actually-billed per-request cost in native RUB.
- `usage.cost` mirrors `cost_rub` here (same number); no `currency` field is returned inside `usage`.
- Missing detail objects arrive as `null`, not `{}` (qwen). Other models return populated objects (see cache experiment).
- `total_tokens == input + output` for this model.

## 2. Streaming response shape

Same family of request with `stream: true`. SSE events observed:

- 16 events total; first is a normal `chat.completion.chunk`.
- **Usage appears in the last content chunk (#14), immediately before `[DONE]` (#15).**
- Final chunk usage:

```json
{
  "prompt_tokens": 23,
  "completion_tokens": 14,
  "total_tokens": 37,
  "completion_tokens_details": null,
  "prompt_tokens_details": null,
  "server_tool_use": null,
  "cost_rub": 0.00010927,
  "cost": 0.00010927,
  "plugins": null
}
```

- `cost_rub` **is delivered in streaming** on the final usage chunk.
- `[DONE]` is the last event and carries no payload.
- **`stream_options.include_usage` is NOT strictly required**: a repeat stream without it still returned a final chunk containing `usage.cost_rub`.

## 3. Cache counters — live

Model `openai/gpt-5-nano`, two requests with an identical ~4 KB text prefix.

| | prompt_tokens | prompt_tokens_details.cached_tokens | cache_write_tokens | cost_rub |
|---|---|---|---|---|
| request 1 | 4026 | 0 | 0 | 0.02368697 |
| request 2 | 4026 | **3968** | 0 | 0.00267582 |

`prompt_tokens_details` is a real object here:

```json
{"cached_tokens": 3968, "cache_write_tokens": 0, "audio_tokens": 0, "video_tokens": 0}
```

`completion_tokens_details`:

```json
{"reasoning_tokens": 0, "audio_tokens": 0, "image_tokens": 0,
 "accepted_prediction_tokens": null, "rejected_prediction_tokens": null}
```

Conclusions:

- **`prompt_tokens` is the full input** (4026 in both requests).
- `cached_tokens` is a **part** of that input (3968 in request 2), confirming the task's semantics.
- `cache_write_tokens` can be `0` even when a cache hit occurs; it is not guaranteed to be non-zero in the same response that produced a hit.
- The normalization `input = prompt_tokens − cached_tokens − cache_write_tokens` is the correct one; request 2 gives `input = 58`.
- **Never** compute `prompt_tokens + cached_tokens` (would double count).

## 4. Catalog price vs actually-billed price (important)

`usage.cost_rub` is authoritative. Catalog pricing (`top_provider.pricing`) is only an estimate.

Same-request comparison against catalog RUB prices:

| model | catalog prompt RUB/M | implied billed RUB/M | ratio |
|---|---|---|---|
| `qwen/qwen3.5-9b` | 1.681 | 1.681 | **1.00×** |
| `openai/gpt-5-nano` | 2.94175 | 5.8835 | **2.00×** |

Cache-read rate for gpt-5-nano was also billed at exactly 2× the catalog value
(catalog 0.294175 → billed 0.58835 RUB/M).

So the multiplier between catalog estimate and actual billing is **model/route dependent** and can
be ≠ 1. This directly justifies keeping the two numbers separate (estimated vs billed) and never
presenting catalog price as the actual charge.

## 5. Balance cross-check

- gpt-5-nano cache experiment: balance available fell from `43.542759` to `43.516396`
  → delta `0.026363` RUB.
- Sum of the two requests' `cost_rub`: `0.02368697 + 0.00267582 = 0.02636279` RUB.
- The delta matches the summed `cost_rub` to ~2e-7 RUB (balance display precision).

Conclusion: `usage.cost_rub` agrees with real account movement, while `spentAmount` is lifetime
spend (balance v2) and is **not** a per-session figure.

## 6. What is authoritative

| Value | Source | Authority |
|---|---|---|
| Model price estimate | `top_provider.pricing` (catalog) | estimate only |
| Actual per-request RUB | `usage.cost_rub` | **authoritative** |
| Account balance / lifetime spend | `/api/v2/balance` | global account state |
| Pi `usage.cost.*` | Pi `calculateCost` from model `cost` (USD) | not reliable for Polza unless FX is correct |

## 7. Reproduce

```bash
npm run probe:chat     # non-streaming usage
npm run probe:stream   # streaming usage placement
npm run probe:cache    # live cache counters
```

Redacted raw dumps land in `artifacts/raw/` (git-ignored).
