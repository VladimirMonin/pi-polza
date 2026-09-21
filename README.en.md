# pi-polza

English · [Русский](README.md)

**Polza AI as a native dynamic provider for [Pi Agent](https://pi.dev) — hundreds of models, native Pi login, and actual RUB billing.**

`pi-polza` plugs [Polza AI](https://polza.ai) into Pi as a real model provider. Install it once,
sign in with your Polza API key through Pi, pick a model and work normally. The plugin discovers
the available models and their capabilities dynamically, and tracks Polza's own spending in rubles
right in Pi's footer.

![Normal Pi usage with the Polza footer](docs/images/polza-session.webp)

## Why

Polza exposes an OpenAI-compatible endpoint, but a plain endpoint tells Pi nothing about *which*
models exist, what their limits are, or what a request actually cost. This plugin fills that gap:

- the catalog is **discovered at runtime**, not hard-coded;
- authentication is **native Pi `/login`**, so your key lives in Pi's own credential store;
- money is tracked in **RUB**, the currency Polza actually bills in.

## Features

- Dynamic Polza model catalog (loaded at startup, refreshable in place)
- Native Pi `/login` authentication — no config files required
- Hundreds of compatible LLMs from a single provider
- Context-window and max-output limits
- Vision / tools / reasoning metadata, with honest `unknown`
- OpenRouter metadata enrichment (limits, modalities, capabilities)
- Actual `usage.cost_rub` accounting — Polza's own number, not an estimate
- Account balance and session cost in Pi's footer
- Streaming responses and tool calling
- Four slash commands for inspecting models, cost and balance

## Installation

Requires [Pi Agent](https://pi.dev) and Node.js ≥ 22.6.

```bash
pi install https://github.com/VladimirMonin/pi-polza
```

Pin a release if you prefer:

```bash
pi install https://github.com/VladimirMonin/pi-polza@v0.1.0
```

Verify it is installed:

```bash
pi list
```

## Authentication

Start Pi and run `/login`:

```
/login
```

1. Choose **Polza AI**.
2. Choose **Sign in with an API key**.
3. Paste your Polza API key.

![Polza AI in Pi's native login](docs/images/polza-login.webp)

The key is stored by Pi itself (the same place as every other provider) and is used for the model
catalog, chat requests and balance lookups. No `.env` file is needed.

> If the model list looks empty after login, run `/polza-refresh` to reload the catalog.

### Advanced: environment / headless / CI

For headless or CI use you can supply the key through the environment instead of `/login`:

| Variable | Meaning |
| --- | --- |
| `POLZA_API_KEY` | The key itself. |
| `PI_POLZA_ENV_FILE` | Path to a specific `.env` file to read. |

Otherwise, a `.env` file in the project you launch Pi from is read:

```dotenv
POLZA_API_KEY=<your-key>
```

A stored Pi credential always wins; the environment is only consulted when nothing is stored.

## Quick start

```
/login            → Polza AI → Sign in with an API key
/model            → search "polza" → pick any model
<ask anything>
```

![Selecting a Polza model](docs/images/polza-models.webp)

## Models

The catalog is fetched from Polza at startup and cached. Around **285 models** are selectable for
chat, out of ~398 catalog entries; the rest are filtered out because they are not usable chat
models or because their limits cannot be determined reliably (see
[Known limitations](#known-limitations)).

`/polza-refresh` reloads the catalog and the OpenRouter enrichment without restarting Pi.

## RUB billing

Polza bills in rubles, and Pi's own cost field is denominated in USD. `pi-polza` therefore keeps
native RUB accounting **separate** from Pi's USD `cost`:

| Source | Used for |
| --- | --- |
| Catalog pricing | A reference estimate (₽ per 1M tokens) |
| `usage.cost_rub` | The **actual** amount Polza charged for the request |
| `GET /api/v2/balance` | The account balance |

Session cost is accumulated from the `cost_rub` value Polza returns for every request — including
streaming requests, which are tapped incrementally rather than buffered. It survives a restart.

> The plugin does **not** estimate actual session spending from token prices. It records Polza's own
> `usage.cost_rub` value returned for each request. Catalog prices are shown only as an estimate.

![Actual session cost in RUB](docs/images/polza-cost.webp)

Pi's standard USD `cost` field is intentionally left at `0` — native RUB numbers are never written
into it.

## Commands

| Command | Description |
| --- | --- |
| `/polza-model-info` | Capabilities, limits, pricing and metadata sources for the current model |
| `/polza-cost` | Actual Polza cost for the current session, in RUB |
| `/polza-balance` | Polza account balance (native RUB) and footer refresh |
| `/polza-refresh` | Reload the Polza catalog and OpenRouter enrichment now |

<details>
<summary>Command screenshots</summary>

**Command discovery**

![Polza commands](docs/images/polza-commands.webp)

**`/polza-model-info`**

![Model info panel](docs/images/polza-model-info.webp)

**`/polza-balance`**

![Balance panel](docs/images/polza-balance.webp)

</details>

## Model metadata

Metadata is resolved from several sources, in priority order:

1. **Polza** — primary source of truth (the model exists and is billable).
2. **OpenRouter** — enrichment only: limits, modalities and capabilities when Polza does not
   state them. Matched by exact model id; never guessed.
3. **Verified override** — a rare, explicit correction backed by a live probe.
4. **`unknown`** — when none of the above provides a trustworthy value.

Because of this, fields can read `unknown` or `not verified`. That means **there is no reliable
confirmation**, not that the plugin failed. The plugin never invents capabilities to fill a gap:
an absent value stays `unknown`, never `0`.

<details>
<summary>Screenshot: metadata detail</summary>

![Model info metadata](docs/images/polza-model-info.webp)

</details>

## OpenRouter enrichment

OpenRouter's public model list is used to fill gaps in limits, modalities and capabilities. It is
treated strictly as enrichment:

- matched by **exact model id** only;
- a Polza value always wins over an OpenRouter value;
- disagreements are recorded as **conflicts** and surfaced in `/polza-model-info`;
- results are cached on disk (`.pi/pi-polza-cache/`) and reused offline, so a slow or unavailable
  OpenRouter never blocks startup.

## Known limitations

- Reasoning *levels* (`minimal`/`low`/`medium`/`high`/…) are not verified for every model family;
  the panel reports `not verified` where we have no reproducible evidence.
- Some Polza-exclusive models are omitted when mandatory Pi model limits cannot be determined
  reliably — better absent than wrong.
- Catalog metadata and the actually billed cost can differ. Billing always follows `usage.cost_rub`.
- Pi's standard USD `cost` field is not used for native RUB accounting.
- Metadata completeness varies by model; not every model has equally rich information.

## Updating

```bash
pi update --extensions          # update all installed packages
pi update --extension pi-polza  # update just this one (npm installs)
```

Git installs pinned to a tag only move when you install the new ref:

```bash
pi install https://github.com/VladimirMonin/pi-polza@v0.2.0
```

## Uninstalling

```bash
pi remove https://github.com/VladimirMonin/pi-polza
```

This removes the package from Pi settings. Pi's stored Polza credential can be removed separately
via `/login` (or Pi's credential management).

## Development

```bash
npm test            # offline unit tests
npm run test:live   # live tests (needs a key; spends a small amount)
npm run probe:catalog
npm run probe:balance
npm run probe:chat
npm run probe:startup
npm run audit:secrets
```

Repository layout:

- `.pi/extensions/pi-polza/` — the extension: runtime code and shared modules
- `scripts/` — standalone diagnostic probes
- `tests/`, `tests-live/` — offline and live tests
- `notes/` — engineering notes and live-experiment results
- `instructions/manual-testing.md` — how to prepare and run an install acceptance test
- `instructions/commit-and-release-guide.md` — commit, tag and release conventions

## Security

- `POLZA_API_KEY` is never logged — not to stdout/stderr, traces, session logs or errors.
- The `Authorization` header is stripped before any HTTP logging.
- `.env` is git-ignored; `.env.example` shows the expected shape.
- The plugin stores no credential of its own — it uses Pi's native credential store.
- `npm run audit:secrets` scans the working tree and Git history for leaked secrets.

## License

[MIT](LICENSE)
