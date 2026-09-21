/**
 * Transparent, incremental response tap for native RUB accounting.
 *
 * `tapResponseForUsage` wraps a `fetch` Response so Pi reads the SAME bytes through a pass-through
 * `TransformStream`, while pi-polza observes chunks on the side:
 *
 *   Polza SSE ──▶ TransformStream ──▶ Pi transport (unchanged)
 *                      │
 *                      └──▶ usage scanner (bounded to one SSE line)
 *
 * Guarantees:
 *  - no full-body buffering (only one partial SSE line is held),
 *  - no added latency (transform is synchronous; chunks are enqueued as received),
 *  - backpressure preserved (the stream is the only consumer path — Pi's own),
 *  - chunk contents are never modified.
 *
 * This does NOT replace the OpenAI-compatible transport; it only observes it.
 */
import { SseUsageScanner, extractUsageFromJson } from "./accounting.ts";
import type { RawUsageLike } from "./usage.ts";

export interface TapHandlers {
  /** Called at most once, with the authoritative usage of the response. */
  onUsage: (usage: RawUsageLike) => void;
  /** Called once when the body completes (best-effort, never throws outward). */
  onDone?: () => void;
}

export function tapResponseForUsage(response: Response, handlers: TapHandlers): Response {
  if (!response.body) return response;

  const contentType = response.headers.get("content-type") ?? "";
  const isSse = contentType.includes("text/event-stream");

  const decoder = new TextDecoder();
  const scanner = new SseUsageScanner();
  let jsonText = "";
  let reported = false;

  const report = (usage: RawUsageLike | null): void => {
    if (reported || !usage) return;
    reported = true;
    try {
      handlers.onUsage(usage);
    } catch {
      // Accounting must never break the provider stream.
    }
  };

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      try {
        const text = decoder.decode(chunk, { stream: true });
        if (isSse) scanner.push(text);
        else jsonText += text;
      } catch {
        // Tapping is best-effort; the chunk still passes through untouched.
      }
      controller.enqueue(chunk);
    },
    flush() {
      try {
        const tail = decoder.decode();
        if (isSse) {
          if (tail) scanner.push(tail);
          report(scanner.flush());
        } else {
          if (tail) jsonText += tail;
          report(extractUsageFromJson(jsonText));
        }
      } catch {
        // ignore
      }
      try {
        handlers.onDone?.();
      } catch {
        // ignore
      }
    },
  });

  const tapped = response.body.pipeThrough(transform);
  return new Response(tapped, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
