/** Native observer + independent completion accounting; no HTTP tap or event consumer. */
import type { AssistantMessageEventStream, Model, ProviderStreams, StreamOptions } from "@earendil-works/pi-ai/compat";
import { recordFromUsage, type PolzaUsageRecord } from "./accounting.ts";
import type { RawUsageLike } from "./usage.ts";

export type PolzaUsageSink = (record: PolzaUsageRecord) => void;
const REASONING_KEY = /reasoning|thinking|thinkingLevel|enable_thinking|chat_template/i;

/** Opt-in debugging logs reasoning keys only, never prompts, headers or credentials. */
function debugReasoningPayload(body: unknown): void {
  if (process.env.POLZA_DEBUG_PAYLOAD !== "1" || typeof body !== "string") return;
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const picked: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (REASONING_KEY.test(key)) picked[key] = value;
    }
    process.stderr.write(`[polza-payload] ${JSON.stringify(picked)}\n`);
  } catch {
    // Debugging must not affect transport.
  }
}

/** Delegate both native entry points, preserving the original stream, result and fetch response. */
export function createPolzaAccountingStreams(api: ProviderStreams, onRecord: PolzaUsageSink): ProviderStreams {
  const start = (method: "stream" | "streamSimple", model: Model<any>, context: Parameters<ProviderStreams["stream"]>[1], options?: StreamOptions): AssistantMessageEventStream => {
    let lastUsage: RawUsageLike = {};
    const caller = options?.onProviderStreamEvent;
    const baseFetch = options?.fetch ?? globalThis.fetch;
    const stream = api[method](model, context, {
      ...options,
      fetch: async (input, init) => {
        debugReasoningPayload(init?.body);
        return baseFetch(input, init);
      },
      onProviderStreamEvent: (data, eventModel) => {
        try {
          if (data && typeof data === "object" && "usage" in data) {
            const usage = (data as { usage: unknown }).usage;
            // Snapshot BEFORE the caller: retaining adapter-owned data permits later mutations.
            lastUsage = usage && typeof usage === "object" && !Array.isArray(usage)
              ? structuredClone(usage) as RawUsageLike : {};
          }
        } catch {
          lastUsage = {};
        }
        // Return the caller's promise unchanged; the native adapter awaits it and owns failures.
        return caller?.(data, eventModel);
      },
    });

    const record = (successful: boolean): void => {
      try {
        const usage = successful ? lastUsage : { ...lastUsage, cost_rub: null };
        const value = recordFromUsage(model.id, usage);
        if (!successful) value.anomalies = [...(value.anomalies ?? []), "request did not complete successfully"];
        // A sink may throw (or return a rejected promise despite its void contract).
        void Promise.resolve(onRecord(value)).catch(() => {});
      } catch {
        // Own accounting/normalization failures must never break the provider response.
      }
    };
    // Register before exposing the ORIGINAL stream. result() does not consume its event queue;
    // native terminal push resolves it before delivering terminal events to waiting consumers.
    void stream.result().then(
      (message) => record(message.stopReason === "stop" || message.stopReason === "length" || message.stopReason === "toolUse"),
      () => record(false),
    ).catch(() => {});
    return stream;
  };
  return {
    stream: (model, context, options) => start("stream", model, context, options),
    streamSimple: (model, context, options) => start("streamSimple", model, context, options),
  };
}
