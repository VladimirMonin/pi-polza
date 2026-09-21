/**
 * Safe environment handling.
 *
 * Security rules enforced here:
 *  - The API key value is never logged, included in thrown messages, or returned by helpers.
 *  - `.env` is only used as a development/bootstrap fallback when the variable is absent from
 *    `process.env`. Production/Pi usage should provide POLZA_API_KEY through the real environment.
 *  - `.env` itself is git-ignored (see .gitignore).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path to the extension directory (`.pi/extensions/pi-polza`). */
const EXT_DIR = dirname(fileURLToPath(import.meta.url));
/**
 * Absolute path to the *source repository* root (three levels above the extension).
 *
 * Development only: `scripts/probe-*.ts` use it to write into `artifacts/`.
 * Runtime code must NOT use it for user-facing paths — an installed copy of this
 * package keeps its files here, so resolving `.env` or the cache against it would
 * silently bind the installed plugin to the developer's checkout.
 */
export const PROJECT_ROOT = resolve(EXT_DIR, "..", "..", "..");

/**
 * The project the user actually works in — the directory Pi was launched from.
 *
 * After `pi install /path/to/pi-polza`, the extension code still lives in the
 * source checkout, but `.env` belongs to the *consumer* project. This is what
 * makes `<consumer>/.env` work without touching the source repository.
 */
export const WORKSPACE_ROOT = process.cwd();

/** Explicit override for the dotenv file location. */
const ENV_FILE_OVERRIDE = process.env.PI_POLZA_ENV_FILE?.trim();

/**
 * Decide which `.env` to read. Pure so it can be tested with an explicit cwd.
 *
 *   1. `PI_POLZA_ENV_FILE` — explicit override, wins over everything
 *   2. `<cwd>/.env`        — the project Pi was launched from (installed-package UX)
 *
 * There is deliberately NO fallback to the source checkout's `.env`. When Pi is launched from the
 * checkout, `cwd` *is* the checkout, so `.env` is still found; from any other project the installed
 * package must never reach back and pick up the developer's key. Returns the cwd path even when no
 * file exists, so error messages name a path the user can create.
 */
export function resolveDotEnvPath(input: { cwd: string; override?: string }): string {
  const override = input.override?.trim();
  if (override) return resolve(override);
  return resolve(input.cwd, ".env");
}

function defaultDotEnvPath(): string {
  return resolveDotEnvPath({ cwd: WORKSPACE_ROOT, override: ENV_FILE_OVERRIDE });
}

const DOTENV_PATH = defaultDotEnvPath();

let loaded = false;

/** Minimal dotenv parser. Does not override variables already present in `process.env`. */
export function loadDotEnv(path: string = DOTENV_PATH): void {
  if (loaded && path === DOTENV_PATH) return;
  if (!existsSync(path)) return;

  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;

    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue;

    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }

  if (path === DOTENV_PATH) loaded = true;
}

/**
 * Resolve POLZA_API_KEY without ever exposing it.
 * Throws an error that mentions only the variable name, never the value.
 */
export function getPolzaApiKey(): string {
  loadDotEnv();
  const key = process.env.POLZA_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "Polza API key is not configured. Run /login polza in Pi, or set POLZA_API_KEY (environment or .env).",
    );
  }
  return key;
}

/** Whether a Polza key is available, without revealing it. */
export function hasPolzaApiKey(): boolean {
  loadDotEnv();
  return Boolean(process.env.POLZA_API_KEY?.trim());
}

/** Safe label for logs: describes the source of the key, not the key. */
export function describePolzaApiKeySource(): string {
  loadDotEnv();
  const fromEnv = process.env.POLZA_API_KEY;
  return fromEnv ? "process.env.POLZA_API_KEY" : "missing";
}
