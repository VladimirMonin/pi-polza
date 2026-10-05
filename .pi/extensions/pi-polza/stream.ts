/** Pi-specific entry point: reuse the bundled native transport and observe its raw usage. */
import { openAICompletionsApi } from "@earendil-works/pi-ai/compat";
import type { ProviderStreams } from "@earendil-works/pi-ai/compat";
import { createPolzaAccountingStreams, type PolzaUsageSink } from "./stream-accounting.ts";

export type { PolzaUsageSink } from "./stream-accounting.ts";

export function createPolzaApiStreams(onRecord: PolzaUsageSink): ProviderStreams {
  return createPolzaAccountingStreams(openAICompletionsApi(), onRecord);
}
