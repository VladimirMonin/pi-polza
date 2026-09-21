# Metadata resolution — Polza + OpenRouter

Implements ТЗ v2: **Polza is authoritative for availability and billing; OpenRouter is an
enrichment source for technical metadata.** OpenRouter is never used for cost.

## Sources and responsibility

| Source | Owns | Never used for |
|---|---|---|
| Polza catalog (`/api/v1/models/catalog`) | availability, Polza ID, endpoints, catalog RUB price, routing | — |
| OpenRouter (`/api/v1/models`) | context limits, max output, modalities, supported parameters, capability flags | availability, billing |
| Polza runtime (`usage`) | real tokens, cache, reasoning, `cost_rub` | — |
| Polza balance v2 | wallet state | per-request cost |

Pipeline:

```
Polza catalog → NormalizedPolzaModel → (+ OpenRouter enrichment) → ResolvedModel
             → Pi eligibility → ProviderModelConfig
```

Modules: `metadata/{polza,openrouter,resolver,provenance,conflicts,eligibility,types}.ts`.

## Priority

Per field: **explicit verified override → Polza → OpenRouter → unknown**.

An override is a *surgical patch*: scoped to a single model id + single field, documented and
test-covered. It is not a bulk metadata source. Polza/OpenRouter disagreement is still recorded as a
conflict even when an override supplies the returned value.

Every resolved field is a `Provenanced<T>` = `{ value, source }` with
`source ∈ {polza, openrouter, override, unknown}`, so provenance survives normalization.

## Matching (exact only, no fuzzy)

OpenRouter IDs were confirmed to match Polza IDs verbatim for the overwhelming majority of models,
so enrichment uses **exact id lookup**. No fuzzy matching, no name heuristics.

18 of the 32 models missing `max_completion_tokens` have **no exact OpenRouter id**. They are left
un-enriched (not aliased). They fall into two groups:

- Russian providers absent from OpenRouter entirely: `aiesa/*`, `sber/gigachat*`,
  `GigaChat/GigaChat-3-Pro`, `yandex/*`, `yandex/aliceai-llm`.
- Preview/route-specific models with no equivalent (closest OR ids are *different* models):
  `google/gemini-3-pro-preview` (OR has only `gemini-3-pro-image*`), `openai/gpt-5-codex`,
  `openai/gpt-5.3-chat` (OR has `gpt-5.3-codex`, a different route), `openai/chatgpt-4o-latest`.

Aliases were deliberately **not** added: the available OpenRouter candidates are not the same model.

## Capability nuance (important, evidence-based)

Live observation: Polza frequently ships a **sparse** `supported_parameters` list even for models
that clearly support tools/reasoning:

```
google/gemini-2.5-flash   Polza: ["max_tokens"]           OpenRouter: tools=true, reasoning=true
openai/gpt-5.2            Polza: ["max_tokens"]           OpenRouter: tools=true, reasoning=true
moonshotai/kimi-k2-thinking (rich list, tools listed)     OpenRouter: tools=true, reasoning=true
```

Treating a missing entry as an authoritative "no" would have registered `gemini-2.5-flash` as
non-tool-capable. Therefore:

- **Polza capabilities are positive-only**: a listed parameter ⇒ `true`; a missing parameter ⇒
  `unknown` (never `false`).
- **OpenRouter fills the negative/positive** where Polza is silent, and its parameter list is
  treated as complete.
- Conflicts are recorded only when both sources state a concrete, different value
  (e.g. Polza `tools=true` vs OpenRouter `tools=false`).

Effect on the catalog: tool-capable chat models went from 211 (Polza-only) to **240** after
enrichment; reasoning 164 → **177**; capability conflicts dropped from 167 to **22**.

## 32 incomplete models — result

```
Missing max output in Polza:        32
  recovered from OpenRouter:        14
  exact ID not found:               18
  OpenRouter also unknown:           0
Missing context before enrichment:   2   (aiesa/aiesa-mini, aiesa/aiesa-pro)
  recovered from OpenRouter:         0
  still missing:                     2
```

Examples:

| model | context | max output | source(maxOut) |
|---|---|---|---|
| `google/gemini-2.5-flash` | 1,048,576 (polza) | 65,535 | openrouter |
| `openai/gpt-5.2` | 400,000 (polza) | 128,000 | openrouter |
| `moonshotai/kimi-k2-thinking` | 262,144 (polza) | 98,304 | openrouter |

## Conflicts (Polza wins, conflict retained)

Over the whole catalog (398 models):

```
metadata conflicts:     187
  context conflicts:     51
  max output conflicts:  86
  modality conflicts:    28
  capability conflicts:  22
```

The high context/max-output conflict counts are worth later study: they may reveal how literally
Polza mirrors OpenRouter's catalog. For now Polza's value is kept and the conflict is stored.

## Pi eligibility

Eligibility is decided only after enrichment; no placeholder values are fabricated.
Dedicated reason codes:

```
missing_context_window        missing_input_modalities
missing_max_completion_tokens missing_output_modalities
unsupported_input_modality    unsupported_output_modality
not_chat_model                embeddings_only
no_chat_completions_endpoint  unsupported_by_pi (reserved)
```

```
Eligible: 285
Rejected: 113
  not_chat_model:                81
  no_chat_completions_endpoint:  81
  missing_max_completion_tokens: 80
  not_text_output:               74
  missing_context_window:        61
  embeddings_only:               23
  unsupported_by_pi:              9   (all STT models with audio-only input)
```

(Reason counts overlap — one model can have several.) 18 usable chat models remain ineligible
because their max output is unknown after enrichment; they stay in the internal registry.

## Pricing

- `pricing.polzaRUB` — Polza catalog RUB price (estimate/reference).
- `pricing.openRouterReference` — OpenRouter USD/token, **diagnostic only**, never billing.
- Actual per-request cost remains `usage.cost_rub` (see `notes/usage-experiment.md`).
- No `OpenRouter price × markup` formula is used anywhere.
- Pi's per-model `cost` is set to `0` as a **compatibility placeholder** (Pi needs USD, Polza is
  RUB, FX is forbidden). It is never business truth; `/polza-cost` is the real RUB surface.

## Reproduce

```bash
npm run probe:openrouter   # OpenRouter metadata snapshot
npm run probe:enrichment   # full Polza+OpenRouter report
```
