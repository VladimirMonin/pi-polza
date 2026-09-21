/**
 * HTTP helpers for Polza with hard guarantees about secret redaction.
 *
 * Any logging/diagnostics must go through `redactText` / `redactJson` / `redactHeaders`.
 * The Authorization header is stripped before it can reach a log sink.
 */
import { getPolzaApiKey } from "./env.ts";

export const POLZA_ORIGIN = "https://polza.ai";
export const POLZA_API_V1 = `${POLZA_ORIGIN}/api/v1`;
export const POLZA_API_V2 = `${POLZA_ORIGIN}/api/v2`;

const SENSITIVE_KEY = /^(authorization|proxy-authorization|api[-_]?key|apikey|x-api-key|access[-_]?token|refresh[-_]?token|secret)$/i;

/**
 * Key resolved at runtime by Pi's native auth (`/login polza`) for this process.
 *
 * Pi resolves the credential before streaming and hands it to the transport, but our own
 * non-stream HTTP paths (catalog, balance, `/polza-*` commands) need the same key. The native
 * auth `resolve()` and the provider's `fetchModels()` run early in the request lifecycle and
 * install it here, so those paths never invent their own credential storage.
 */
let runtimeApiKey: string | null = null;

/** Install the key Pi resolved from its credential store or the environment. */
export function setRuntimePolzaApiKey(key: string | null | undefined): void {
  const trimmed = typeof key === "string" ? key.trim() : "";
  runtimeApiKey = trimmed.length > 0 ? trimmed : null;
}

/** Whether a runtime key was installed (value is never returned). */
export function hasRuntimePolzaApiKey(): boolean {
  return runtimeApiKey !== null;
}

/** Every live secret that must never appear in a log line. */
function activeSecrets(): string[] {
  const secrets = new Set<string>();
  if (runtimeApiKey) secrets.add(runtimeApiKey);
  const fromEnv = process.env.POLZA_API_KEY?.trim();
  if (fromEnv) secrets.add(fromEnv);
  return [...secrets];
}

/** Replace any live secret embedded in a free-form string. */
function maskSecrets(text: string): string {
  let out = text;
  for (const secret of activeSecrets()) out = out.split(secret).join("<redacted>");
  return out;
}

/** The configured key from any source without revealing it; throws a safe message when missing. */
export function requirePolzaApiKey(): string {
  if (runtimeApiKey) return runtimeApiKey;
  return getPolzaApiKey();
}

export type Headers = Record<string, string>;

/** Remove credentials from a header map. Never mutate the input. */
export function redactHeaders(headers: Headers | undefined): Headers {
  if (!headers) return {};
  const out: Headers = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = SENSITIVE_KEY.test(key) ? "<redacted>" : value;
  }
  return out;
}

/** Deep-redact sensitive-looking keys. Also masks any string that literally equals the live key. */
export function redactJson(value: unknown): unknown {
  const walk = (node: unknown, depth: number): unknown => {
    if (depth > 20) return "<max-depth>";
    if (typeof node === "string") return maskSecrets(node);
    if (Array.isArray(node)) return node.map((item) => walk(item, depth + 1));
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
        out[key] = SENSITIVE_KEY.test(key) ? "<redacted>" : walk(val, depth + 1);
      }
      return out;
    }
    return node;
  };
  return walk(value, 0);
}

/** Redact a free-form string that might embed the live key. */
export function redactText(text: string): string {
  return maskSecrets(text);
}

/** Parse a value that may be a decimal string or a number; missing/invalid → 0. */
export function toNumberSafe(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export class PolzaHttpError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string, url: string) {
    super(`Polza request failed: HTTP ${status} for ${url}${body ? ` — ${redactText(body).slice(0, 800)}` : ""}`);
    this.name = "PolzaHttpError";
    this.status = status;
    this.body = redactText(body);
  }
}

export interface PolzaFetchOptions {
  method?: "GET" | "POST";
  body?: unknown;
  headers?: Headers;
  signal?: AbortSignal;
  /** Timeout in ms; defaults to 60s. */
  timeoutMs?: number;
  /** Explicit key; defaults to the runtime key installed by Pi's native auth, then env/.env. */
  apiKey?: string;
}

/**
 * Authenticated fetch against Polza. The API key is attached here and nowhere else.
 * Response bodies are returned raw; callers must redact before persisting/logging.
 */
export async function polzaFetch(pathOrUrl: string, options: PolzaFetchOptions = {}): Promise<Response> {
  const key = options.apiKey?.trim() || requirePolzaApiKey();
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${POLZA_API_V1}${pathOrUrl}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("timeout")), options.timeoutMs ?? 60_000);
  const onAbort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    return await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

/** Authenticated fetch that throws on non-2xx and returns parsed JSON. */
export async function polzaJson<T = unknown>(pathOrUrl: string, options: PolzaFetchOptions = {}): Promise<T> {
  const response = await polzaFetch(pathOrUrl, options);
  const text = await response.text();
  if (!response.ok) throw new PolzaHttpError(response.status, text, pathOrUrl);
  try {
    return text ? (JSON.parse(text) as T) : (undefined as T);
  } catch {
    throw new Error(`Polza returned non-JSON body for ${pathOrUrl}: ${redactText(text).slice(0, 400)}`);
  }
}
