# OpenRouter cache & startup reliability

## Policy

```
                OpenRouter
                     │
              request succeeds?
                /          \
              yes           no
               │             │
         update cache   cached metadata?
                             /     \
                           yes      no
                            │        │
                        use stale  Polza-only
```

A transient OpenRouter timeout must never silently shrink the Pi catalog. The existing cache
(`.pi/pi-polza-cache/openrouter.json`, git-ignored) is reused whenever the live fetch fails.

## Cache file

```json
{ "schemaVersion": 1, "fetchedAt": 1789975671008, "models": [ ... ] }
```

- `OPENROUTER_CACHE_SCHEMA_VERSION` is bumped when the persisted shape changes; mismatched files are
  **ignored, not deleted**.
- Written **atomically** (`write temp → rename`) so a killed process cannot leave half a JSON file.
- Corrupt/empty files are treated as "no cache" and left on disk.
- States: `fresh` (< 24h), `stale` (older, still usable), `none`.

## Build modes (`buildPolzaCatalog`)

| Mode | Behaviour | Used by |
|---|---|---|
| `"live"` | fetch now; on failure → cache (fresh/stale); else Polza-only | `refreshModels` |
| `"cache-first"` | use cache, no OpenRouter network | initial extension build (fast startup) |
| `"off"` | no enrichment (Polza-only, 271 models) | offline |

`openRouterSource` reports exactly what happened:
`live | cache-fresh | cache-stale | off | none`.

## Measured startup (`npm run probe:startup`)

```
live        eligible=285 source=live         polza=4781ms openrouter=174ms total=4962ms
cache-first eligible=285 source=cache-fresh  age=0min     polza=575ms  openrouter=4ms   total=581ms
OR outage   eligible=285 source=cache-fresh  error=simulated outage
```

Findings:

- The initial build is now `cache-first`, so **OpenRouter latency is no longer on the startup path**
  (≈4 ms instead of up to 10 s when OpenRouter is slow).
- With a cache and a simulated OpenRouter outage, eligibility stays at **285** (no 14-model loss).
- In this environment the cold Polza catalog fetch (~4.8 s) dominates; a warm fetch is ~0.6 s. That
  is inherent to the dynamic provider and is what `refreshModels` exists for.

## Not done (deliberately)

- No background refresh loop: Pi's `refreshModels(context)` is the supported refresh path, and a
  custom background scheduler would be an unnecessary moving part.
