# Pi API findings (installed version)

Investigated against the **installed** Pi, not documentation guesses.

| Item | Value |
|---|---|
| Pi package | `@earendil-works/pi-coding-agent` |
| Pi version | `0.86.1` |
| pi-ai version | `0.86.1` (bundled at `.../pi-coding-agent/node_modules/@earendil-works/pi-ai`) |
| Node | `v25.8.1` (type-stripping enabled by default; `.ts` runs without a flag) |
| Sources inspected | `dist/core/extensions/types.d.ts`, `dist/core/provider-composer.js`, `dist/core/extensions/virtual-modules.js`, `pi-ai/dist/api/openai-completions.js`, `docs/custom-provider.md`, `docs/extensions.md`, `docs/session-format.md`, `docs/environment-variables.md` |

## Extension loading

- Auto-discovered from `.pi/extensions/*.ts` and `.pi/extensions/*/index.ts` (project-local, **only after the project is trusted**).
- Loaded with jiti — TypeScript works without a build step.
- Multi-file extensions use explicit relative `.ts` imports, e.g. `import { x } from "./utils.ts"` (confirmed in `examples/extensions/plan-mode/index.ts`).
- Importable modules from an extension: `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai` (resolves to the `compat` entry), `typebox`, `@earendil-works/pi-tui`, plus Node built-ins.
- The factory may be `async`; Pi awaits it before continuing startup.

## Provider registration

```ts
pi.registerProvider(provider: Provider): void;
pi.registerProvider(name: string, config: ProviderConfig): void;
pi.unregisterProvider(name: string): void;
```

`ProviderConfig` (from `dist/core/extensions/types.d.ts`):

- `name?`, `baseUrl?`, `apiKey?`, `api?`, `headers?`, `authHeader?`
- `models?: ProviderModelConfig[]` — **replaces** all models for that provider when provided
- `streamSimple?: (model, context, options?) => AssistantMessageEventStream`
- `refreshModels?(context: RefreshModelsContext): Promise<ProviderModelConfig[]>`
- `oauth?`

`ProviderModelConfig`:

- `id`, `name`, `api?`, `baseUrl?`, `reasoning: boolean`
- `thinkingLevelMap?: Partial<Record<"off"|"minimal"|"low"|"medium"|"high"|"xhigh"|"max", string | null>>`
- `input: ("text" | "image")[]`
- `cost: { input; output; cacheRead; cacheWrite }` — **USD per 1M tokens**
- `promptCache?`, `contextWindow: number`, `maxTokens: number`, `headers?`, `compat?`

### `refreshModels()` — exists, but is under-documented

- The public `docs/custom-provider.md` "Config Reference" section does **not** list `refreshModels`.
- The real type `ProviderConfig` in `dist/core/extensions/types.d.ts` **does** declare it, and `dist/core/provider-composer.js` composes it (`base?.refreshModels || extension?.refreshModels`).
- Conclusion: the architecture document was right that `refreshModels()` exists; the current docs are stale on this point. Use it.

`RefreshModelsContext` (pi-ai `dist/models.d.ts`): `credential?`, `stored?`, `publish({ persist?, update? })`, `allowNetwork`, `force?`, `signal`. Returns the replacement model list. `context.allowNetwork` is `false` in offline/cache-only initialization — refresh must handle that.

## Streaming / custom transport

- Built-in API types include `openai-completions`, `openai-responses`, `anthropic-messages`, `google-generative-ai`, `mistral-conversations`, `bedrock-converse-stream`, …
- `streamSimple` is the injection point for a custom transport. It receives a normalized `TranscriptContext` (system prompt + tools live in system messages; read them via `getCurrentSystemPrompt()` / `getCurrentTools()`).
- `options.onPayload` (before request; may replace payload) and `options.onResponse(response, model)` (after response received, **before body is consumed**). `ProviderResponse` carries status/headers, **not** the body.
- `registerProvider` validation: if `streamSimple` is set, `api` is required.

## Usage model

`Usage` (pi-ai, also serialized into session JSONL):

```ts
{ input, output, cacheRead, cacheWrite, cacheWrite1h?, reasoning?, totalTokens,
  cost: { input, output, cacheRead, cacheWrite, total } }
```

### Critical: `openai-completions` drops unknown usage fields

`pi-ai/dist/api/openai-completions.js` → `parseChunkUsage(rawUsage, model)`:

```js
const input = Math.max(0, promptTokens - cacheReadTokens - cacheWriteTokens);
const usage = { input, output, cacheRead, cacheWrite, reasoning, totalTokens, cost: {...zeros} };
calculateCost(model, usage);
return usage;
```

- It builds a **fresh** usage object from known fields only. **`usage.cost_rub` from Polza is silently discarded.**
- It already treats `prompt_tokens` as full input and subtracts `cached_tokens` / `cache_write_tokens` — matching the semantics the task asks us to verify (live confirmation still pending, see `notes/usage-experiment.md`).
- `completion_tokens` is treated as already including `reasoning_tokens` (so reasoning is a detail, not additive) — matching the task's assumption.
- It reads cache write from `prompt_tokens_details.cache_write_tokens` only.

Consequence: to keep native RUB per request, the provider must supply a custom `streamSimple` that observes the raw Polza SSE usage and records `cost_rub` — the built-in transport cannot.

## Events (relevant subset)

`pi.on(...)` handlers receive `(event, ctx)`:

- `session_start` / `session_shutdown` — lifecycle; use `ctx.sessionManager.getEntries()` / `getBranch()` to rebuild extension state.
- `before_provider_request` — `{ payload }`, can replace payload.
- `after_provider_response` — `{ status, headers }` only (no body → cannot read usage here).
- `message_end` — finalized assistant message; can return a rewritten message.
- `turn_end`, `agent_end`, `model_select`.

No event exposes raw provider chunk bodies.

## Commands / state

- `pi.registerCommand(name, { description, handler(args, ctx) })`.
- `ctx.model` → current `Model` (`provider`, `id`, …); `ctx.ui.notify(msg, level)`.
- `pi.appendEntry(customType, data)` writes a `custom` session entry (persisted, **not** in LLM context) — the extension-owned place for per-request RUB accounting.
- Session file already has a `usage` entry type with an arbitrary `kind` (`SessionManager.appendUsage(kind, provider, model, usage)`), and its `usage.cost` is summed into session totals.

## Security

- `docs/environment-variables.md` documents `PI_*` process vars and provider API-key vars (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, …) but **no `.env` auto-loading**. Pi interpolates `$ENV_VAR` in provider config values, but the variable must already exist in the environment.
- Therefore the extension **must** load the project `.env` itself in development (see `env.ts`). Confirms the task's suspicion.

## Deltas vs `docs/pi_polza_provider_architecture.md`

| Architecture doc claim | Reality in Pi 0.86.1 |
|---|---|
| `refreshModels()` drives dynamic catalogs | ✅ exists in types/composer, though missing from current public docs |
| `cost.input` is USD / 1M | ✅ confirmed (`ProviderModelConfig.cost`) |
| Pi model input supports `text`/`image` only | ✅ confirmed (`input: ("text" \| "image")[]`); `file`/`video`/`audio` are not representable |
| Reasoning levels need per-family compatibility mapping | Partially: mechanism is `thinkingLevelMap` + `compat.thinkingFormat`/`supportsReasoningEffort`, not a free-form "levels" list |
| Reasoning payloads recognized (`reasoning_content`, …) | Not re-verified here (deferred; out of scope for iteration 1) |
| Runtime cache counters must be integration-tested | ✅ still required — see `notes/usage-experiment.md` |
| Exact per-request RUB billing | Catalog + `usage.cost_rub` exist; confirmation pending live test |
