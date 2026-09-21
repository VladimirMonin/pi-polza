/**
 * Pi-specific stream wrapper for native RUB accounting.
 *
 * It does NOT reimplement the OpenAI-compatible transport. It delegates to the bundled
 * `openAICompletionsApi().streamSimple` and injects a `fetch` that wraps each response in a
 * transparent pass-through `TransformStream` (see `tap.ts`) to observe `usage.cost_rub`
 * incrementally — Pi still reads the original stream, unmodified and unbuffered.
 *
 * This module imports `@earendil-works/pi-ai/compat`, which is only resolvable inside Pi (virtual
 * module), so it is intentionally not unit-tested under plain Node.
 */
import { openAICompletionsApi } from "@earendil-works/pi-ai/compat";
import type { AssistantMessageEventStream, Model, SimpleStreamOptions, TranscriptContext } from "@earendil-works/pi-ai/compat";
import { recordFromUsage, type PolzaUsageRecord } from "./accounting.ts";
import { tapResponseForUsage } from "./tap.ts";

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
      if (!response.ok) return response;
      try {
        return tapResponseForUsage(response, {
          onUsage: (usage) => {
            try {
              onRecord(recordFromUsage(model.id, usage));
            } catch {
              // Accounting must never break the provider stream.
            }
          },
        });
      } catch {
        // If wrapping is unsupported, streaming continues untapped rather than failing.
        return response;
      }
    };

    return api.streamSimple(model, context, { ...options, fetch: tappingFetch });
  };
}
