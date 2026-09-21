# Commit, tag and release conventions

Project convention for this repository. Derived from the commits actually made here — the history is
the reference. The rules apply to humans and to agents alike.

## 1. Commit messages

```
<type>(<scope>): <imperative summary>

<optional body: bullets explaining WHY, wrapped ~80 cols>
```

- **Imperative mood**, present tense: `add`, `fix`, `document` — not `added` / `fixes`.
- Subject **≤ 72 characters**, no trailing period, no `wip`.
- Blank line, then the body if the reason is not obvious from the subject.
- Mention **why**, not a restatement of the diff. Numbers/measurements are welcome.
- One logical change per commit. Do not mix a refactor with a behaviour change.

### Types actually used

| Type | Use for |
| --- | --- |
| `feat` | new user-visible behaviour |
| `fix` | bug fix |
| `docs` | README, notes, guides |
| `test` | tests only |
| `style` | presentation/formatting, no behaviour change |
| `refactor` | internal restructuring, same behaviour |
| `perf` | performance |
| `chore` | tooling, package metadata, housekeeping |
| `security` | secrets, auth, auditing |

### Scopes

Lowercase area names. Reuse existing ones before inventing new: `auth`, `catalog`, `metadata`,
`mapper`, `usage`, `accounting`, `pricing`, `provider`, `stream`, `status`, `commands`, `ui`,
`presentation`, `env`, `readme`, `package`, `live`, `audit`, `security`.

### Examples from this repository

```
feat(auth): register Polza via createProvider with native Pi API-key login
fix(env): never read the source checkout .env from an installed package
style(ui): theme the Polza footer with semantic colors
docs(readme): user-facing README for the public release
security(audit): key-shaped regex instead of literals; ignore placeholders and the script itself
```

Body example (why + evidence):

```
fix(env): never read the source checkout .env from an installed package

- resolveDotEnvPath() is pure and testable; no fallback to <repo>/.env
- when Pi runs from the checkout, cwd IS the checkout, so dev still works
- from any other project only <cwd>/.env or PI_POLZA_ENV_FILE is used
- adds tests/env.test.ts (5 cases) → 101 unit tests
```

### Never

- **Do not rewrite history**: no `git commit --amend` on pushed commits, no `rebase`, no
  `push --force`. Fix forward with a new commit.
- Do not commit `.env`, keys, credentials, raw artifacts or runtime caches.
- Do not commit without running `npm test` if code under `.pi/extensions/pi-polza/` changed.

## 2. Versioning

SemVer `MAJOR.MINOR.PATCH`. Pre-1.0 policy used here:

- `PATCH` — bug fix, docs, internal change;
- `MINOR` — user-visible feature (breaking changes are allowed in a MINOR while `0.x`);
- `MAJOR` — reserved for `1.0.0`.

`version` lives in **`package.json` only** (single source of truth) and must match the tag.

## 3. Tags

- **Annotated** tags: `git tag -a v0.1.0 -m "..."`.
- Format `vMAJOR.MINOR.PATCH`.
- The tag message is a short release summary and seeds the GitHub Release body.
- **Never move or delete a published tag.** To correct a release, publish a new patch.
- Push tags explicitly: `git push origin vX.Y.Z`.
- Verify: `git describe --tags --exact-match HEAD` prints the tag when `HEAD` is exactly released.

```bash
git tag -a v0.1.0 -m "pi-polza v0.1.0

Native Polza AI provider for Pi Agent.
- native /login authentication
- dynamic catalog (285 selectable models)
- actual RUB accounting from usage.cost_rub"
git push origin v0.1.0
```

## 4. Release process

Pre-flight (all must be true):

```
[ ] npm test                     green
[ ] npm run test:live            green (spends a small amount)
[ ] npm run audit:secrets        PASS (tree, history, workspace)
[ ] npm pack --dry-run           only intended files; no tests/scripts/notes/.env/caches
[ ] README + screenshots         current
[ ] package.json version         bumped and matching the intended tag
[ ] git status                   clean
```

Then:

```bash
# 1. version bump commit (chore(release) or docs/feat as appropriate)
# 2. tag
git tag -a vX.Y.Z -m "<release summary>"
# 3. push branch and tag
git push origin main
git push origin vX.Y.Z
# 4. GitHub Release with the packed artifact attached
npm pack
gh release create vX.Y.Z --verify-tag --title "pi-polza vX.Y.Z" --notes-file notes.txt "pi-polza-X.Y.Z.tgz#pi-polza-X.Y.Z.tgz"
rm -f pi-polza-X.Y.Z.tgz
```

Post-release verification:

```bash
gh release view vX.Y.Z --json tagName,isDraft,isPrerelease,assets
curl -s -o /dev/null -w "%{http_code}\n" https://github.com/VladimirMonin/pi-polza/releases/download/vX.Y.Z/pi-polza-X.Y.Z.tgz
```

Release notes outline: one-line pitch → screenshot → highlights → install command → verification
results → known limitations → license.

## 5. Publish safety

- **Stop and get explicit approval** before the first `git push`, tag, GitHub Release or any publish.
- **No `npm publish`.** Distribution is `pi install` from GitHub.
- Never create the GitHub repository before the owner/name is confirmed.
- Before any push, confirm no secret is tracked: `git ls-files | grep -iE '\.env$|\.tgz$|credential'`.

## 6. Quick reference

```bash
git log --oneline -10                 # recent style reference
git describe --tags --exact-match HEAD  # confirm HEAD is a release
git ls-remote --tags origin           # confirm the tag exists remotely
npm test && npm run audit:secrets     # before every release
```
