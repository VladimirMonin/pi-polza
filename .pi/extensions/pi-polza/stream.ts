/**
 * Pi-specific stream wrapper for native RUB accounting.
 *
 * It does NOT reimplement the OpenAI-compatible transport. It delegates to the bundled
 * `openAICompletionsApi().streamSimple` and injects a `fetch` that clones each response and reads
 * the raw body in parallel to capture `usage.cost_rub` (which Pi's normalizer drops).
 *
 * This module imports `@earendil-works/pi-ai/compat`, which is only resolvable inside Pi (virtual
 * module), so it is intentionally not unit-tested under plain Node.
 */
import { openAICompletionsApi } from "@earendil-works/pi-ai/compat";
import type { AssistantMessageEventStream, Model, SimpleStreamOptions, TranscriptContext } from "@earendil-works/pi-ai/compat";
import { extractUsageFromBody, recordFromUsage, type PolzaUsageRecord } from "./accounting.ts";

export type PolzaUsageSink = (record: PolzaUsageRecord) => void;

export function createPolzaStreamSimple(onRecord: PolzaUsageSink) {
  // The bundled OpenAI-completions implementation — streaming, reasoning, tool calls, cache all
  // stay exactly as Pi does them.
  const api = openAICompletionsApi();

  return function polzaStreamSimple(
    model: Model<any>,
    context: TranscriptContext,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream {
    const baseFetch = options?.fetch ?? globalThis.fetch;

    const tappingFetch: typeof globalThis.fetch = async (input, init) => {
      const response = await baseFetch(input, init);
      if (response.ok) {
        try {
          // Clone before Pi consumes the body so nothing is lost.
          const clone = response.clone();
          void clone
            .text()
            .then((body) => {
              const usage = extractUsageFromBody(body);
              if (!usage) return;
              try {
                onRecord(recordFromUsage(model.id, usage));
              } catch {
                // Accounting must never break the provider stream.
              }
            })
            .catch(() => {});
        } catch {
          // If cloning is unsupported, streaming continues untapped rather than failing.
        }
      }
      return response;
    };

    return api.streamSimple(model, context, { ...options, fetch: tappingFetch });
  };
}
