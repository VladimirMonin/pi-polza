# pi-polza — acceptance report (iteration 1)

Scope: Catalog + Chat Provider + Capabilities + Usage + Native RUB Accounting + Balance.
No media tools, routing, subagents, FX, dashboard or npm publishing.

## 1. What was actually confirmed (facts only)

- Polza catalog `GET /api/v1/models/catalog` is paginated: **398 models / 4 pages**, all prices in **RUB**.
- `pi.registerProvider(name, config)` with `refreshModels(context)` and `streamSimple` exists in Pi 0.86.1
  (the public `custom-provider.md` reference is stale on `refreshModels`).
- `usage.cost_rub` is present for **non-streaming** and **streaming** responses; in streaming it arrives
  in the final content chunk immediately before `[DONE]`.
- `include_usage` is not required for the tested model — usage arrived without it.
- Cache semantics: `prompt_tokens` is the full input; `cached_tokens` is a part of it. Live cache hit:
  3968 of 4026 tokens, `input = 58`.
- `usage.cost_rub` agrees with real account movement (balance delta ≈ Σ cost_rub).
- Pi's `openai-completions` transport **drops `cost_rub`** (`parseChunkUsage` rebuilds usage). It is
  recoverable by tapping `options.fetch` and cloning the response — no transport rewrite needed.
- A full agent tool loop works through Polza, and **both** API requests are accounted separately.
- OpenRouter (`/api/v1/models`) is public, 446 models, IDs usually identical to Polza.

## 2. What differed from `pi_polza_provider_architecture.md`

| Doc claim | Reality |
|---|---|
| `refreshModels()` drives the dynamic catalog | ✅ real, but missing from current public docs |
| Catalog price = estimate; runtime API needed for exact billing | ✅ confirmed, and stronger: billed rate can be **1.0× or 2.0×** the catalog (qwen vs gpt-5-nano) |
| `cost.input` is USD/1M; RUB must not go there | ✅ confirmed |
| Reasoning payloads / cache counters need live tests | ✅ done (see `notes/usage-experiment.md`) |
| Media models are separate tools | ✅ reaffirmed; `file`/`video`/`audio` are not Pi-native inputs |
| — | **New:** 14 embedding models are labeled `type: "chat"` in Polza |
| — | **New:** Polza `supported_parameters` lists are sparse and not safe to read as negatives |
| — | **New:** 18 models have no exact OpenRouter id (mostly Russian providers) |
| — | **New:** Pi does not auto-load a project `.env`; the extension loads it |
| — | **New (v2):** override priority corrected to `override → Polza → OpenRouter → unknown` |

## 3. Catalog (final numbers)

```
Total:                              398
Chat declared (type==chat):         317
Chat usable (text output):          303
Embeddings falsely marked chat:      14   <- excluded

METADATA
Complete from Polza:                271
Enriched from OpenRouter:           142
Still incomplete (limits):           18

LIMITS
Missing context before enrichment:    2   recovered 0   still missing 2
Missing max output before:           32   recovered 14  exact ID not found 18  OR unknown 0

CAPABILITIES (chat)
Vision:                             165
Tools declared:                     240   (211 from Polza alone; +29 recovered)
Reasoning declared:                 177   (164 from Polza alone)

CONFLICTS (Polza wins, recorded)
Total 187: context 51, max output 86, modalities 28, capabilities 22

PI
Eligible:                           285
Rejected:                           113
  not_chat_model 81, no_chat_completions_endpoint 81,
  missing_max_completion_tokens 80, unsupported_output_modality 74,
  missing_context_window 61, missing_input_modalities 37,
  embeddings_only 23, unsupported_input_modality 9, missing_output_modalities 4
```

`pi --list-models polza` shows **286** models (small live variance vs the 285 snapshot; the catalog
is a moving target).

## 4. Usage

Non-streaming (`qwen/qwen3.5-9b`):

```json
{"prompt_tokens":19,"completion_tokens":2,"total_tokens":21,
 "prompt_tokens_details":null,"completion_tokens_details":null,
 "server_tool_use":null,"cost_rub":0.00004203,"cost":0.00004203,"plugins":null}
```

Streaming: identical shape, delivered in the last chunk before `[DONE]`.
Cache experiment (`openai/gpt-5-nano`): `prompt_tokens: 4026`, `cached_tokens: 3968`,
`cache_write_tokens: 0`, `cost_rub: 0.00267582`.

Separation enforced:

```
prompt        = prompt_tokens (full input)
cache read    = prompt_tokens_details.cached_tokens
cache write   = prompt_tokens_details.cache_write_tokens
input         = max(0, prompt - cacheRead - cacheWrite)
output        = completion_tokens (already includes reasoning)
reasoning     = completion_tokens_details.reasoning_tokens
```

## 5. Accounting

| Value | Source | Authority |
|---|---|---|
| Model price estimate | Polza catalog `top_provider.pricing` (RUB) | reference only |
| Actual per-request RUB | `usage.cost_rub` (runtime) | **authoritative** |
| Wallet | `/api/v2/balance` | global account state |
| OpenRouter price | `/api/v1/models` | diagnostic reference only |
| Pi `usage.cost.*` | mapper `cost = 0` | compatibility placeholder |

Native account is captured by tapping the raw response (`stream.ts`), stored as a `polza-cost`
**custom session entry**, rebuilt on `session_start`, aggregated by `PolzaCostAccumulator`,
surfaced via `/polza-cost`. `cost_rub` is never recomputed from tokens × price.

Live proof (tool loop, `openai/gpt-oss-20b`):

```
#1 prompt=2219 out=49   costRub=0.0052189
#2 prompt=2264 out=160  costRub=0.00648974
TOTAL requests=2 costRub=0.01170864
```

## 6. Pi integration

| Capability | Status |
|---|---|
| Dynamic provider (`polza`) | ✅ 286 models |
| Catalog via full pagination | ✅ |
| OpenRouter enrichment + cache fallback | ✅ |
| `refreshModels` wired | ✅ |
| Chat (non-streaming/streaming) | ✅ |
| Reasoning (thinking blocks) | ✅ (tool-loop session had `thinking` blocks) |
| Tool calling (full loop) | ✅ 1 toolCall → 1 toolResult → continuation |
| Usage/cache | ✅ Pi usage intact, cost_rub captured |
| `/polza-model-info` | ✅ with provenance |
| `/polza-balance` | ✅ |
| `/polza-cost` | ✅ native RUB per session/model |

## 7. Problems and oddities (not hidden)

1. **OpenRouter is intermittently slow** (one call took 10s, a Node fetch timed out entirely). Now
   mitigated: 12s timeout + local cache (`.pi/pi-polza-cache/openrouter.json`) + graceful
   Polza-only fallback (271 models). Without cache a timeout silently costs 14 enriched models.
2. **18 models still unregistered** — no exact OpenRouter id (aiesa, sber/gigachat, yandex,
   gemini-3-pro-preview, gpt-5-codex, gpt-5.3-chat, chatgpt-4o-latest). No placeholders, no fuzzy
   aliases. They remain in the internal registry.
3. **Pi footer shows `$0.00`** because `cost` is a compatibility placeholder. Real money is visible
   only via `/polza-cost` / `/polza-balance`. Not solved by design (FX forbidden).
4. **Catalog price ≠ billed price** and the multiplier varies by model/route (1.0× and 2.0× observed).
5. **High conflict counts** (86 max-output, 51 context) suggest Polza may mirror OpenRouter loosely —
   worth a dedicated study.
6. **Live catalog is a moving target**: 285 (snapshot) vs 286 (Pi at run time). Tests use frozen
   snapshots so they are deterministic.
7. `Response.clone()` buffering is fine for current payload sizes; a very large SSE body would need
   incremental parsing.
8. OpenRouter capability negatives are trusted; if OpenRouter is ever wrong, Polza-only fields don't
   correct it (override exists for exactly this).

## 8. Next iteration (not started)

1. Reasoning levels matrix (`reasoning.supported_efforts`) and `thinkingLevelMap` per family.
2. `/polza-cost` per subagent/agent role (record already carries `modelId`; add `agentId`).
3. Persistent/sidecar ledger for cross-session accounting (option D in `notes/native-rub-accounting.md`).
4. Surgical overrides + verified aliases to recover the 18 unmatched models.
5. Decide the UX for the false `$0.00` footer (e.g. a status line "Polza: RUB accounting").
6. Only then: media tools, model routing, FX/display conversion.

## Acceptance checklist

```
[x] .env not in git
[x] POLZA_API_KEY handled safely
[x] full-pagination catalog
[x] chat models filtered automatically
[x] dynamic refresh works
[x] Polza models appear in Pi
[x] context/max output mapped from real metadata
[x] vision/reasoning conservative
[x] one normal chat request works
[x] streaming works
[x] usage obtained and studied
[x] cost_rub obtained and studied
[x] cache counters studied
[x] /polza-model-info works
[x] /polza-balance works
[x] a tool-capable model passes the full agent loop
[x] determined that Pi drops cost_rub (and captures it via fetch tap)
[x] RUB never passed off as USD
[x] experiments documented
[x] cost_rub not lost
[x] streaming/non-streaming accounting correct
[x] exactly one record per request
[x] standard Pi usage still works
[x] reasoning not broken
[x] cache counters not broken
[x] multiple API requests summed
[x] catalog price not presented as actual
[x] /polza-cost shows real RUB
```
