# Pi reasoning levels (0.86.1) — how they work

## Types (`@earendil-works/pi-ai/dist/types.d.ts`)

```ts
type ThinkingLevel      = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
type ModelThinkingLevel = "off" | ThinkingLevel;
type ThinkingLevelMap   = Partial<Record<ModelThinkingLevel, string | null>>;
```

`SimpleStreamOptions.reasoning?: ThinkingLevel` — what `streamSimple` receives.
`ProviderModelConfig` (and `Model`) carry `reasoning: boolean` and `thinkingLevelMap`.
`AssistantMessage.providerThinkingLevel?: string` records the exact provider value used.

## Selection & clamping (`models.js`)

```js
EXTENDED_THINKING_LEVELS = ["off","minimal","low","medium","high","xhigh","max"];

getSupportedThinkingLevels(model):
  if (!model.reasoning) return ["off"];
  keep level unless thinkingLevelMap[level] === null;
  additionally: "xhigh"/"max" are only shown when mapped to a non-undefined value.

clampThinkingLevel(model, level): nearest supported level upward.
```

So **`null` hides a level in Pi's UI**; a level that is absent still shows (except `xhigh`/`max`).

## Transport (`api/openai-completions.js`)

For Polza (`provider: "polza"`, `baseUrl: https://polza.ai/api/v1`) auto-detection yields:

```
supportsReasoningEffort: true
thinkingFormat: "openai"          // not deepseek/zai/qwen/together/openrouter
maxTokensField: "max_completion_tokens"
```

`streamSimple` does:

```js
clampedReasoning = options.reasoning ? clampThinkingLevel(model, options.reasoning) : undefined;
reasoningEffort  = clampedReasoning === "off" ? undefined : clampedReasoning;
```

and the payload branch:

```js
// reasoning ON
params.reasoning_effort = model.thinkingLevelMap?.[reasoningEffort] ?? reasoningEffort;
// reasoning OFF
const offValue = model.thinkingLevelMap?.off;
if (typeof offValue === "string") params.reasoning_effort = offValue;
```

Consequences for pi-polza:

- If `reasoning: true` and no `thinkingLevelMap`, Pi sends `reasoning_effort: "medium"` (whatever level is
  selected) — i.e. raw Pi level names go to Polza, which may reject unknown values.
- `thinkingLevelMap[level] = "<providerValue>"` is the single knob for mapping Pi → Polza.
- `thinkingLevelMap.off = null` hides OFF; `off = "none"` sends `reasoning_effort:"none"` for OFF;
  `off` absent/undefined sends **no** `reasoning_effort` when OFF.
- `xhigh`/`max` require an explicit mapping to be selectable at all.

## Layers we must keep separate (ТЗ §15)

```
Declared  ── metadata (Polza supported_parameters / OpenRouter reasoning)
Mapped    ── pi-polza thinkingLevelMap rule per family
Verified  ── live API test result (what Polza actually accepts / returns)
```

Never let a Declared flag justify a Mapped value without a Verified result.

---

# Live verification (2026-09-21)

## What Pi actually sends (captured, not inferred)

Dev hook `POLZA_DEBUG_PAYLOAD=1` prints the reasoning-related request keys (never prompts/headers):

```
pi --thinking off  → {}                                    (no reasoning_effort)
pi --thinking low  → {"reasoning_effort":"low"}
pi --thinking high → {"reasoning_effort":"high"}
```

So without an authored `thinkingLevelMap`, Pi transports the **raw Pi level name**. Polza accepts it.
That state is **"transport accepts / mapping unverified"** — it is NOT `mapped`, and it does not prove
the level has any effect.

## Evidence model (corrected)

`reasoning_tokens === 0` is not proof that reasoning is off. Live capture proved Claude and Gemini
return step-by-step reasoning **inside `message.content`** with `reasoning_tokens: 0` and no reasoning
field. Therefore verification separates independent properties (`reasoning.ts`):

```
declared
requestSupported
reasoningPayloadObserved     real reasoning payload/field seen
inlineReasoningObserved      reasoning-like working inside content
usageReported                reasoning_tokens > 0 seen
levelControlVerified         repeatable effect on standardized requests
offVerified                  positive proof that off/none disables reasoning
```

Rules:

- Unknown is `null`, never a guessed `false`.
- `offVerified = true` requires a channel that demonstrably reports reasoning **and** zero on it for
  off/none **and** no inline reasoning. Otherwise `false` (still reasoning) or `null` (no channel).
- `levelControlVerified` is never set from one prompt + a token difference.
- No authored `thinkingLevelMap` until `levelControlVerified` — never send an arbitrary provider value.

## Results

| model | request | payload | inline | usage | level control | off |
|---|---|---|---|---|---|---|
| openai/gpt-oss-20b | ✅ | ✅ | n/a | ✅ | unverified | **false — still reasons** |
| deepseek-r1-distill-llama-70b | ✅ | ✅ (`message.reasoning`) | false | ✅ | possible, **NOT verified** | **false — still reasons** |
| anthropic/claude-haiku-4.5 | ✅ | false | ✅ inline steps | false (0) | unverified | **unverified** (0 ≠ disabled) |
| google/gemini-2.5-flash-lite | ✅ | false | ✅ inline steps | false (0) | unverified | **unverified** (0 ≠ disabled) |
| qwen/qwen3.5-9b | ✅ | false | false | false (0) | unverified | **unverified** |

Key conclusions:

1. **Polza accepts every effort string** (no 4xx) — acceptance cannot be used as verification.
2. **Telemetry absence ≠ reasoning absence.** Claude/Gemini reason visibly with counter 0.
3. `off` is **not** honoured by gpt-oss and deepseek-r1 — UI must not promise "reasoning disabled".
4. No model has verified level control yet, so no `thinkingLevelMap` is authored; Pi keeps the
   identity transport and we label it unverified.
5. Deliberately NOT implemented: family-specific `enable_thinking` / `thinking:{type}` / Claude
   thinking budgets — that requires per-family live confirmation first.

Probe: `npm run probe:reasoning [-- --models=... --max-tokens=... --prompt="..."]`.
Spend for the whole reasoning investigation: ≈ 1.4 ₽.
