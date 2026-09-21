/**
 * Minimal Polza Chat Completions client (OpenAI-compatible).
 *
 * Deliberately low-level: returns raw JSON/text so diagnostic probes can inspect the real
 * response shape. Higher layers (usage normalization, Pi provider) build on top.
 */
import { POLZA_API_V1, polzaFetch } from "./http.ts";

export const CHAT_COMPLETIONS_URL = `${POLZA_API_V1}/chat/completions`;

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | Array<Record<string, unknown>> | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: unknown[];
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
  tools?: unknown[];
  tool_choice?: unknown;
  /** Ask OpenAI-compatible servers to include usage on the final stream chunk. */
  stream_options?: { include_usage?: boolean };
  [key: string]: unknown;
}

export interface RawChatResult {
  status: number;
  ok: boolean;
  json: unknown;
  text: string;
}

/** POST /chat/completions without throwing on non-2xx, so probes can inspect error bodies. */
export async function postChatCompletion(
  body: ChatCompletionRequest,
  signal?: AbortSignal,
): Promise<RawChatResult> {
  const response = await polzaFetch(CHAT_COMPLETIONS_URL, {
    method: "POST",
    body,
    signal,
  });
  const text = await response.text();
  let json: unknown = undefined;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: response.status, ok: response.ok, json, text };
}

export interface SseEvent {
  /** `event:` field when present. */
  event?: string;
  /** Parsed `data:` payload. `null` means the literal `[DONE]` sentinel. */
  data: unknown;
  /** Raw `data:` string. */
  raw: string;
}

/**
 * Open an SSE stream from Polza chat completions and yield parsed events in order.
 * The caller is responsible for consuming/aborting the body.
 */
export async function* streamChatCompletion(
  body: ChatCompletionRequest,
  signal?: AbortSignal,
): AsyncGenerator<SseEvent> {
  const response = await polzaFetch(CHAT_COMPLETIONS_URL, {
    method: "POST",
    body: { ...body, stream: true },
    headers: { Accept: "text/event-stream" },
    signal,
    timeoutMs: 120_000,
  });

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    throw new Error(`Polza stream failed: HTTP ${response.status} ${text.slice(0, 500)}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let separatorIndex: number;
    while ((separatorIndex = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      const parsed = parseSseBlock(block);
      if (parsed) yield parsed;
    }
    // Handle CRLF-separated streams too.
    while ((separatorIndex = buffer.indexOf("\r\n\r\n")) !== -1) {
      const block = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 4);
      const parsed = parseSseBlock(block);
      if (parsed) yield parsed;
    }
  }

  if (buffer.trim()) {
    const parsed = parseSseBlock(buffer);
    if (parsed) yield parsed;
  }
}

function parseSseBlock(block: string): SseEvent | null {
  let event: string | undefined;
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return null;
  const raw = dataLines.join("\n");
  if (raw === "[DONE]") return { ...(event ? { event } : {}), data: null, raw };
  try {
    return { ...(event ? { event } : {}), data: JSON.parse(raw), raw };
  } catch {
    return { ...(event ? { event } : {}), data: undefined, raw };
  }
}
