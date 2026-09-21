# Orphan models (no exact OpenRouter id) — 2026-09-21

Probe: `npm run probe:orphans` (chat models that are otherwise usable but still miss a limit after
enrichment).

```
orphans: 18
```

## Classification

### 1. Vendor-exclusive — Russian ecosystem (14)

```
aiesa/aiesa-mini            missing context + maxOut
aiesa/aiesa-pro             missing context + maxOut
yandex/aliceai-llm          missing maxOut
yandex/yandexgpt-5-lite     missing maxOut
yandex/yandexgpt-5-pro      missing maxOut
yandex/yandexgpt-5.1-pro    missing maxOut
sber/gigachat               missing maxOut
sber/gigachat-2             missing maxOut
sber/gigachat-2-max         missing maxOut
sber/gigachat-2-pro         missing maxOut
sber/gigachat-max           missing maxOut
sber/gigachat-plus          missing maxOut
sber/gigachat-pro           missing maxOut
GigaChat/GigaChat-3-Pro     missing maxOut
```

These providers are simply not on OpenRouter. Note the two distinct GigaChat namespaces
(`sber/*` and `GigaChat/*`), which is a Polza-side naming inconsistency, not an OpenRouter alias.

### 2. Preview / moving aliases (2)

```
google/gemini-3-pro-preview   missing maxOut
openai/chatgpt-4o-latest      missing maxOut
```

Names explicitly denote a moving target (`-preview`, `-latest`); upstream does not publish a fixed
max output.

### 3. Missing max output only (2)

```
openai/gpt-5-codex            missing maxOut
openai/gpt-5.3-chat           missing maxOut
```

No exact OpenRouter id and no name-level match either.

## Decision: no overrides added

ТЗ §23 allows a verified override **only** if technical limits can be reliably established from an
official vendor source or the real Polza API. That is not the case here:

- The Russian vendors publish no machine-readable limit for these Polza routes that we can cite.
- The preview/aliases change over time; any pinned number would rot.
- `gpt-5-codex` / `gpt-5.3-chat` have no exact upstream record we can cite; `"similar name"` is not
  proof, and no fuzzy matching is performed.

So these 18 stay in the internal registry and out of Pi. **We explicitly do not target 398/398.**
Nothing here changes priority: Polza remains authoritative, and absence of a limit is `unknown`,
never a placeholder.

## Effect on the catalog

Eligibility is unaffected by this investigation — these models were already excluded for missing
limits. Eligible stays at 285.
