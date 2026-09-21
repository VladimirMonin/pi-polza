# Polza ↔ OpenRouter metadata conflicts (2026-09-21)

Probe: `npm run probe:conflicts` (read-only, uses the local OpenRouter cache).

```
Models with conflicts: 117 / 398
Conflict entries:      187
```

Policy unchanged (ТЗ §21): `override → Polza → OpenRouter → unknown`. We operate through Polza, so
Polza's limits/capabilities are the operative ones. The goal here is to understand the patterns,
not to "fix" 187 entries.

## Pattern summary

| # | Pattern | Count | Interpretation |
|---|---|---|---|
| 1 | context/maxOut differ by <5% | 20 | **Rounding / different definition**, not a real disagreement |
| 2 | maxOut: Polza larger (>4× / ≈2×) | 25 | Different serving route caps |
| 3 | maxOut: OpenRouter larger (>4× / ≈2×) | 22 | Same, opposite direction |
| 4 | context: OpenRouter larger (≈2×…>4×) | 20 | OR advertises model max, Polza caps the route |
| 5 | context: Polza larger | ~12 | Polza route more generous for those models |
| 6 | inputModalities: Polza has extra | ~17 | Polza lists **model-level** modalities (video/audio/file) |
| 7 | outputModalities differ | ~9 | Polza advertises image/audio output OR does not |
| 8 | capability: Polza=true, OR=false | 21 | One-way; Polza declares model capability, OR route params |

**Every** capability conflict observed is `Polza=true / OpenRouter=false` — never the reverse.
That is consistent with Polza describing the *model* and OpenRouter's `supported_parameters`
describing *its own route*.

## Category 1 — effectively equal (<5%): benign

Examples:

```
google/gemma-3-27b-it            polza=128000   or=131072      (1000-based vs 2^17)
kwaipilot/kat-coder-pro-v2.5     polza=256000   or=262144
minimax/minimax-m2               polza=196608   or=204800      (3*2^16 vs 200*2^10)
mistralai/voxtral-small-24b-2507 polza=25600    or=26214
tencent/hy3                      polza=131072   or=128000
z-ai/glm-5.3                     polza=128000   or=131072
```

Same capability, different rounding convention. No action needed.

## Category 2/3 — max output differs in BOTH directions

```
Polza larger:
  deepseek/deepseek-chat-v3.1      polza=163840 or=32768    (>4×)
  deepseek/deepseek-r1-distill-70b polza=131072 or=7372     (>4×)
  anthropic/claude-haiku-4.5       polza=128000 or=64000    (≈2×)
  anthropic/claude-sonnet-4.5      polza=128000 or=64000
  qwen/qwen3-coder                 polza=262144 or=65536    (4×)

OpenRouter larger:
  google/gemma-4-26b-a4b-it        polza=32768  or=235929   (>4×)
  meta-llama/llama-3.1-8b-instruct polza=16384  or=117964
  moonshotai/kimi-k2.7-code        polza=32000  or=235929
  openai/gpt-oss-20b               polza=32768  or=117964   (3.6×)
```

Bidirectional → not "one source is stale". These describe **different serving paths**: OpenRouter
reports `top_provider.max_completion_tokens` for its own routing, Polza for its own. Neither value is
"wrong"; each is correct for its provider. This is exactly why the override mechanism (J) must be
surgical and only used when a specific model misbehaves live.

## Category 4/5 — context window differs in both directions

```
OpenRouter larger:
  anthropic/claude-sonnet-4        polza=200000  or=1000000  (>4×)
  meta-llama/llama-4-maverick      polza=131072  or=1048576  (>4×)
  qwen/qwen3.5-9b                  polza=32768   or=262144   (>4×)
  qwen/qwen3-14b                   polza=40960   or=131072   (3.2×)

Polza larger:
  openai/gpt-5.2-chat              polza=400000  or=128000   (3.1×)
  qwen/qwen3-30b-a3b-thinking-2507 polza=262144  or=81920    (3.2×)
  deepseek/deepseek-r1-distill-70b polza=131072  or=8192     (>4×)
```

Again bidirectional → route-dependent. A 1M-token OR figure may be the model's theoretical maximum
(via a specific upstream), while Polza caps at what its route serves.

## Category 6/7 — modalities (scope difference)

Polza advertises **model-level** modalities; OpenRouter advertises what its route accepts:

```
anthropic/claude-haiku-4.5   polza=[image,text,file,video,audio]  or=[text,image,file]
anthropic/claude-opus-4.6    polza=[text,image,file,video,audio]  or=[text,image,file]
openai/gpt-5.1-codex         polza=[text,image,file,video,audio]  or=[text,image]
google/gemini-2.5-pro-preview polza=[file,image,text,audio,video] or=[file,image,text,audio]
deepseek/deepseek-v4-flash   polza=[text,image]                   or=[text]
```

Output side:

```
openai/gpt-5.2          polza output=[text,image]  or=[text]
google/gemini-2.5-flash polza output=[text,audio]  or=[text]
google/lyria-3-pro-preview polza output=[audio]    or=[text,audio]   (opposite direction)
```

Impact on Pi: **none** — Pi only ever sends `text`/`image` (mapper clamps to those). Polza's extra
internal modalities (`file`/`video`/`audio`) are kept in internal metadata only.

## Category 8 — capabilities (one-way)

```
9  supportsStructuredOutputs: Polza=true OR=false   e.g. deepseek-r1-distill-llama-70b
9  supportsResponseFormat:    Polza=true OR=false   e.g. kimi-k2
1  supportsReasoning:         Polza=true OR=false   e.g. openai/gpt-5.2-chat
1  supportsReasoningEffort:   Polza=true OR=false   e.g. openai/gpt-5.2-chat
1  supportsTools:             Polza=true OR=false   e.g. thedrummer/unslopnemo-12b
1  supportsToolChoice:        Polza=true OR=false   e.g. thedrummer/unslopnemo-12b
```

Direction is always Polza more permissive. This matches the positive-only tri-state interpretation:
Polza's `supported_parameters` (when present) is a *model* statement, while OpenRouter's is a
*route* statement.

## Conclusion

- **No normalization bug found.** Values are well-formed; the differences are semantic, not corrupt.
- Dominant cause: **route/provider scope differences** (Polza's own serving path vs OpenRouter's
  upstream metadata), in **both directions** for limits.
- ~20 entries are pure **rounding** and should be ignored.
- Capability and modality conflicts are **one-way scope** differences (Polza = model-level).
- Therefore: keep the Polza-priority policy, do **not** mass-correct, and reserve overrides for
  concretely verified model misbehaviour (J). Nothing here justifies flipping the priority (ТЗ §21).
