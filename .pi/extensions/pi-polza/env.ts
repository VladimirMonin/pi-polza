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
/** Absolute path to the repository root. */
export const PROJECT_ROOT = resolve(EXT_DIR, "..", "..", "..");

const DOTENV_PATH = resolve(PROJECT_ROOT, ".env");

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
      "POLZA_API_KEY is not set. Add it to the git-ignored .env file or export it in the environment.",
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
