# pi-polza — Iteration 2 acceptance report

## Git

```
Baseline HEAD: 91baa20 (not rewritten)
Final HEAD:    3790d7b
Working tree:  clean
Commits:       9
```

```
3790d7b test(live): separate live suite with hard request budget; npm test stays offline
45dd3ec docs(models): classify 18 orphan models; no unverifiable overrides
8ac5fc7 feat(overrides): surgical per-field registry with provenance validation
17035a6 docs(metadata): analyse 187 Polza-OpenRouter conflicts into route-scope patterns
b57b37a feat(reasoning): strict multi-property evidence model, live payload capture
ce3b45a feat(openrouter): versioned atomic cache, cache-first startup, outage fallback
23ab153 feat(status): persistent Polza footer via ctx.ui.setStatus, balance TTL cache
e40b866 test(accounting): persistence/dedup regressions + session rebuild verifier
358ea73 perf(accounting): replace full-body buffering with incremental pass-through SSE tap
```

## Streaming

```
old:       response.clone() + clone.text()  → whole body materialized
new:       transparent TransformStream pass-through (tap.ts) + incremental SSE scanner
TTFT:      207 ms → 208 ms (+1 ms, noise)      [npm run probe:ttft]
buffering: bounded to one partial SSE line (no full response retained)
```

- Pi still reads the same bytes; the tap only observes. No custom transport, tools or reasoning parser.
- `tests/tap.test.ts` proves exactly-one report, byte-identical forwarding, TTFT not waiting for
  completion, CRLF/partial-line/multibyte handling, null body.
- Dedup: `report()` fires at most once per HTTP response.

## Status UI

```
mechanism:      ctx.ui.setStatus("polza-accounting", …)   (native Pi footer, like the Ollama plugin)
balance:        GET /api/v2/balance, TTL 45 s (BALANCE_TTL_MS)
session cost:   sum of usage.cost_rub for the current session
failure:        Polza ? ₽ | Session 0.61 ₽  (session cost keeps working, states fresh/stale/unavailable)
```

Live text with the real account: `Polza 43.46 ₽ | Session 0.61 ₽`.
Shown only when `provider === "polza"` and `mode === "tui"`; hidden on switch/shutdown.
Refresh: on activation, after each billed request when TTL expired, and manually via `/polza-balance`.
`/polza-refresh` reloads extensions to force a catalog/enrichment refresh.

## Accounting

```
requests tested:  single stream = 1 record; tool loop = 1 toolCall → 1 toolResult, 2 records
restart/rebuild:  2 separate Pi processes on one session → 2 raw entries → 2 rebuilt records
                  (0.00703499 + 0.00706020 = 0.01409519 ₽) — no doubling, no loss
dedup:            exactly-one record per HTTP response (tap guard + appendEntry once)
tool-loop:        requests #1 and #2 both recorded (0.00518501 + 0.00590092 ₽)
```

`npm run probe:persistence` rebuilds the ledger from a real session file and asserts consistency.

## OpenRouter

```
fresh cache:      .pi/pi-polza-cache/openrouter.json, schemaVersion=1, fetchedAt, models
stale cache:      > 24 h → still usable, reported as cache-stale
failure fallback: live fetch fails → cache (fresh/stale) → only then Polza-only
startup latency:  live 4962 ms (polza 4781 + or 174) vs cache-first 581 ms (polza 575 + or 4)
```

- Atomic write (temp → rename); corrupt/schema-mismatched files are ignored, never deleted.
- Simulated OpenRouter outage with cache kept eligibility at **285** (no 14-model loss).
- Initial build is `cache-first`, so OpenRouter is off the startup path; `refreshModels` does the
  live fetch. No background scheduler was added (Pi's `refreshModels` is the supported path).

## Reasoning

```
families tested:  openai/gpt-oss-20b, deepseek-r1-distill-llama-70b,
                  anthropic/claude-haiku-4.5, google/gemini-2.5-flash-lite, qwen/qwen3.5-9b
levels verified:  none (level control unverified for every model)
exceptions:       gpt-oss and deepseek-r1 reason even with no field / "none"
```

Live payload capture (`POLZA_DEBUG_PAYLOAD=1`, real Pi):

```
pi --thinking off  → {}                          (no reasoning_effort)
pi --thinking low  → {"reasoning_effort":"low"}
pi --thinking high → {"reasoning_effort":"high"}
```

Method correction applied: `reasoning_tokens === 0` is NOT proof that reasoning is off.
Claude and Gemini returned step-by-step reasoning **inside `message.content`** with counter 0.
Evidence is therefore multi-property (`reasoning.ts`):

| model | request | payload | inline | usage | level control | off |
|---|---|---|---|---|---|---|
| gpt-oss-20b | ✅ | ✅ | n/a | ✅ | unverified | **false — still reasons** |
| deepseek-r1-distill-70b | ✅ | ✅ | false | ✅ | possible, NOT verified | **false — still reasons** |
| claude-haiku-4.5 | ✅ | false | ✅ | false (0) | unverified | **unverified** |
| gemini-2.5-flash-lite | ✅ | false | ✅ | false (0) | unverified | **unverified** |
| qwen3.5-9b | ✅ | false | false | false (0) | unverified | **unverified** |

- `offVerified = true` only with positive proof; never inferred from 0 tokens / missing fields.
- No `thinkingLevelMap` is authored → state is **"transport accepts / mapping unverified"**, not `mapped`.
- Family-specific payloads (`enable_thinking`, `thinking:{type}`, Claude budgets) were deliberately
  NOT implemented — they need per-family live confirmation first.

## Metadata

```
conflicts analyzed:       187 entries / 117 of 398 models
  - route-scope limits (both directions): dominant cause
  - <5% rounding:                        ~20 entries (noise)
  - modalities: one-way, Polza lists model-level (video/audio/file)
  - capabilities: always Polza=true / OR=false (model vs route)
overrides added:          0 (registry built, validated, empty by design)
incomplete models before: 18
incomplete models after:  18
```

- `notes/metadata-conflicts.md`, `notes/orphan-models.md`.
- Override registry (`overrides/models.ts`): one model + one field per entry, mandatory
  `reason`/`source`/`verifiedAt`, validated by tests, highest priority in the resolver.
- Orphans classified: 14 Russian vendor-exclusive, 2 preview/aliases, 2 no-exact-upstream. No
  unverifiable override was added; 398/398 is explicitly not a goal.
- Priority unchanged: `override → Polza → OpenRouter → unknown`.

## Subagents

```
attribution possible: not investigated — pi-subagents do not exist yet in this setup
implemented:          no
limitations:          deferred (user instruction). The record already carries modelId and an
                      optional agentId slot, so attribution can be added once identity exists.
```

## Tests

```
unit:             80/80  (npm test — no network, no money)
integration/live: 4/4    (npm run test:live — requires POLZA_API_KEY, hard request budget)
```

Live suite output: `requests=3/6  actual cost_rub=0.00076145`.

## Actual test spend

```
reasoning investigation: ≈ 0.85 ₽ measured across three probe runs
live test suite:          0.00076145 ₽
iteration 2 total live:   ≈ 0.86 ₽
```

## Acceptance criteria

```
[x] стартовый HEAD 91baa20 не переписан
[x] incremental SSE tap заменил full-response buffering
[x] TTFT не ждёт завершения response
[x] cost_rub по-прежнему сохраняется точно один раз
[x] tool loop не сломан
[x] reasoning stream не сломан
[x] accounting переживает reopen session
[x] footer/status работает через нативный механизм Pi
[x] footer показывает Polza balance
[x] footer показывает actual session cost_rub
[x] временная ошибка balance не ломает provider
[x] OpenRouter outage не обнуляет enrichment при наличии cache
[x] cache имеет schemaVersion/fetchedAt
[x] transient OR timeout не сокращает каталог без необходимости
[x] reasoning levels исследованы на representative families
[x] declared и verified reasoning capabilities различаются
[x] metadata conflicts проанализированы
[x] overrides точечные и документированные
[x] модели без надёжных metadata не получают placeholders
[~] subagent accounting исследован            → DEFERRED: сабагентов пока нет
[~] attribution по subagent при надёжной identity → DEFERRED
[x] обычные unit tests не используют сеть и деньги
[x] live tests запускаются отдельно
[x] все tests green
[x] git working tree clean
```

## Not done (out of scope / by design)

Image/video/STT/TTS/embeddings tools, automatic routing, FX, custom OpenAI transport, subagent
accounting. No background refresh scheduler. No family-specific reasoning payloads yet.
