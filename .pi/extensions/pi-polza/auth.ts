/**
 * Native Pi API-key authentication for Polza.
 *
 * Pi owns credential storage (`~/.pi/agent/auth.json`) and the `/login` flow; this module only
 * describes *how* to ask for the key and *where else* it may come from. No custom secret store,
 * no custom dialog.
 *
 * Resolution priority (stored credential owns the provider):
 *   1. stored Pi credential (from `/login polza`)
 *   2. `POLZA_API_KEY` in the environment (which `loadDotEnv()` also fills from `.env`)
 *   3. not configured → `undefined`, so Pi reports the provider as unconfigured instead of 401-ing
 *
 * The resolved key is installed into `http.ts`'s runtime holder so the catalog/balance/command
 * paths use the very same credential Pi does.
 */
import type { ApiKeyAuth, ApiKeyCredential, AuthContext } from "@earendil-works/pi-ai";
import { loadDotEnv } from "./env.ts";
import { setRuntimePolzaApiKey } from "./http.ts";

/** Display name shown in Pi's `/login` list. */
export const POLZA_AUTH_NAME = "Polza AI API key";

/** Source label for status/diagnostics; never contains the key. */
export type PolzaKeySource = "stored credential" | "POLZA_API_KEY";

export interface PolzaKeyResolution {
  apiKey: string;
  source: PolzaKeySource;
}

/**
 * Pure resolution used by both the native auth adapter and tests.
 * Never returns or logs the key beyond the returned `apiKey`.
 */
export function resolvePolzaKey(input: {
  credentialKey?: string | null;
  envKey?: string | null;
}): PolzaKeyResolution | undefined {
  const stored = input.credentialKey?.trim();
  if (stored) return { apiKey: stored, source: "stored credential" };
  const fromEnv = input.envKey?.trim();
  if (fromEnv) return { apiKey: fromEnv, source: "POLZA_API_KEY" };
  return undefined;
}

/** Prompt for the key and hand it to Pi for storage. */
export async function loginPolza(interaction: { prompt: (p: { type: "secret"; message: string }) => Promise<string> }): Promise<ApiKeyCredential> {
  const key = await interaction.prompt({ type: "secret", message: "Polza API key" });
  return { type: "api_key", key };
}

/** Pi-native api-key auth profile for the Polza provider. */
export const polzaApiKeyAuth: ApiKeyAuth = {
  name: POLZA_AUTH_NAME,

  login: loginPolza,

  async resolve({ ctx, credential }: { ctx: AuthContext; credential?: ApiKeyCredential }) {
    loadDotEnv(); // dev/CI fallback: fill process.env from .env before consulting it
    const envKey = await ctx.env("POLZA_API_KEY");
    const resolved = resolvePolzaKey({ credentialKey: credential?.key, envKey });
    if (!resolved) return undefined;
    setRuntimePolzaApiKey(resolved.apiKey);
    return { auth: { apiKey: resolved.apiKey }, source: resolved.source };
  },
};
