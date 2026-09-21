# pi-polza — Iteration 3 acceptance report (release-prep for v0.1.0)

Baseline: `d757c9e` · Head: `ad545f8` · Branch: `main` · Tags: none · Tree: clean

Goal of this iteration: turn a technically-working provider into a **publishable plugin** —
installable without hand-editing `.env`, with a native Pi login and a README a stranger can follow.

## 1. What was done

| Commit | Area | Summary |
| --- | --- | --- |
| `8772c3d` | auth | Register Polza through `createProvider` with native `auth.apiKey` login/resolve; runtime key holder; `toPiModels`; `createPolzaApiStreams` |
| `9505d8f` | security | `audit-secrets` script (tree / history / workspace / sessions), key never printed |
| `3e554c8` | ui | Footer via semantic theme roles (muted / dim / text / warning) |
| `27efdd7` | ui | `/polza-*` output as structured, themed panels (native TUI component) |
| `e55d860` | ui | Plain-notification fallback if native TUI components are unavailable |
| `47f80eb` | fix | Installed package never reads the source checkout's `.env` (see §4) |
| `d52a9a1` | ui | `/polza-model-info` "Observed reasoning" row made human-readable |
| `8272014` | docs | Real smoke-test screenshots as lossless webp (7 files, 116 KB) |
| `0cd8a66` | docs | User-facing public README; package metadata → `0.1.0`; MIT LICENSE |
| `ad545f8` | security | Key-shaped regex auditing; placeholders and the audit script ignored |

Diff vs baseline: 26 files, +1413 / −303.

## 2. Verification

| Check | Result |
| --- | --- |
| `npm test` (offline unit) | **102 / 102 pass** |
| `npm run test:live` | **4 / 4 pass**, `requests=3/6`, `actual cost_rub = 0.00076145 ₽` |
| `pi --list-models` (key configured) | **285** selectable `polza` models, no load errors |
| `pi --list-models` (no key) | 0 models, **no 401, no stack trace** (graceful "unconfigured") |
| `npm pack --dry-run` | 39 files, 140.2 kB packed / 236.6 kB unpacked |
| Package completeness | 29 / 29 extension files present; no diff vs disk |
| `npm run audit:secrets` | **PASS** — repo tree, Git history, workspace clean |

### Manual acceptance (performed by the user, consumer workspace `C:\PY\pi-polza-smoke-test`)

```
native /login → Polza AI
credential setup
provider/model selection
chat + streaming
footer balance/session RUB
/polza-model-info, /polza-balance, /polza-cost
slash command discovery
restart / normal use
```

Outcome: **accepted**, UI and native login approved.

## 3. Deliverables

- `.pi/extensions/pi-polza/` — native provider: auth, catalog, chat/streaming, accounting, balance,
  metadata resolution, presentation.
- `docs/images/*.webp` — 7 real screenshots (login, models, session+footer, commands, model-info,
  cost, balance).
- `README.md` — public, user-facing (install → `/login` → model → work; RUB billing; metadata
  honesty; limitations).
- `LICENSE` — MIT.
- `package.json` — `0.1.0`, public, repository/homepage/bugs/keywords, `files` include
  `docs/images` + `LICENSE`.
- `scripts/audit-secrets.ts` — reproducible secret audit.

## 4. Notable fix: installed package must not read the checkout `.env`

The `.env` resolver previously fell back to `<source repo>/.env`. For a local-path install that
silently supplied the developer's key to a consumer project — which would have made the native-login
acceptance test dishonest, and would be wrong for any installed package. `resolveDotEnvPath()` is now
pure and reads only `<cwd>/.env` or `PI_POLZA_ENV_FILE`; running from the checkout still works because
`cwd` *is* the checkout. Covered by `tests/env.test.ts` (5 cases).

## 5. Known caveats (not release blockers)

- **`polza-model-info.webp` predates the "Observed reasoning" copy fix** — the screenshot still shows
  the earlier `Observed no none` row. Everything else matches the shipped UI. Re-shoot and swap if
  desired.
- **Repository owner assumed `VladimirMonin`** (from `git config user.name`). Install URLs in README
  and `package.json` use it; confirm or correct before the first public push.
- **No Git remote configured.** Remote/branch must be set before any push.
- **Live key in a local dev session file** (`~/.pi/agent/sessions/...jsonl`) — outside the repository,
  not a release artifact. Key rotation recommended.
- **Personal absolute paths** remain in dev-only files (`instructions/manual-testing.md`,
  `scripts/audit-secrets.ts`). Not shipped in the package.
- Reasoning levels remain `not verified` where there is no reproducible evidence (by design).

## 6. Release readiness

```
version         0.1.0
README          final (user-facing)
screenshots     7 real webp in docs/images
security        tree/history/workspace PASS
tests           102 unit + 4 live green
package         39 files, no tests/scripts/notes/.env/caches
working tree    clean
remote          NOT configured  (owner/name to confirm)
npm publish     not attempted
tag / push      not attempted
```

**Proposed release:** `v0.1.0`, MIT.

**Status: stopped before the first public push/tag/release, pending explicit approval.**
