/**
 * Credential resolution + redaction + Pi model projection.
 *
 * These tests assert *behaviour*, never a concrete secret: the key is only ever checked through
 * boolean/label results, mirroring the runtime guarantee that it is never logged.
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { AuthContext, ApiKeyCredential } from "@earendil-works/pi-ai";
import { loginPolza, polzaApiKeyAuth, resolvePolzaKey } from "../.pi/extensions/pi-polza/auth.ts";
import { hasRuntimePolzaApiKey, redactJson, redactText, setRuntimePolzaApiKey } from "../.pi/extensions/pi-polza/http.ts";
import { POLZA_PROVIDER_ID, toPiModels } from "../.pi/extensions/pi-polza/provider.ts";

const emptyCtx: AuthContext = {
  env: async () => undefined,
  fileExists: async () => false,
};

afterEach(() => {
  setRuntimePolzaApiKey(undefined);
  delete process.env.POLZA_API_KEY;
});

test("stored Pi credential wins over the environment", () => {
  const resolved = resolvePolzaKey({ credentialKey: "stored-key", envKey: "env-key" });
  assert.equal(resolved?.source, "stored credential");
  assert.equal(resolved?.apiKey, "stored-key");
});

test("environment is used when no credential is stored", () => {
  const resolved = resolvePolzaKey({ credentialKey: null, envKey: "env-key" });
  assert.equal(resolved?.source, "POLZA_API_KEY");
  assert.equal(resolved?.apiKey, "env-key");
});

test("no credential and no environment means unconfigured", () => {
  assert.equal(resolvePolzaKey({ credentialKey: undefined, envKey: undefined }), undefined);
  assert.equal(resolvePolzaKey({ credentialKey: "   ", envKey: "" }), undefined);
});

test("whitespace is trimmed and never part of the key", () => {
  const resolved = resolvePolzaKey({ credentialKey: "  abc  " });
  assert.equal(resolved?.apiKey, "abc");
});

test("login returns a stored api_key credential holding exactly the prompted value", async () => {
  let prompted = "";
  const credential = await loginPolza({
    prompt: async (p) => {
      prompted = p.message;
      return "typed-key";
    },
  });
  assert.equal(credential.type, "api_key");
  assert.equal(credential.key, "typed-key");
  assert.match(prompted, /Polza API key/);
});

test("native resolve installs the runtime key and labels its source without exposing the key", async () => {
  const result = await polzaApiKeyAuth.resolve({
    ctx: emptyCtx,
    credential: { type: "api_key", key: "stored-key" } satisfies ApiKeyCredential,
    signal: new AbortController().signal,
  });
  assert.equal(result?.auth.apiKey, "stored-key");
  assert.equal(result?.source, "stored credential");
  assert.doesNotMatch(String(result?.source), /stored-key/);
  assert.equal(hasRuntimePolzaApiKey(), true);
});

test("native resolve reports undefined (not a throw) when nothing is configured", async () => {
  const result = await polzaApiKeyAuth.resolve({
    ctx: emptyCtx,
    signal: new AbortController().signal,
  });
  assert.equal(result, undefined);
  assert.equal(hasRuntimePolzaApiKey(), false);
});

test("a runtime-installed key is redacted from text and JSON", () => {
  setRuntimePolzaApiKey("super-secret-value");
  assert.equal(redactText("Bearer super-secret-value failed"), "Bearer <redacted> failed");
  const redacted = redactJson({ message: "key super-secret-value", apiKey: "super-secret-value" }) as Record<string, unknown>;
  assert.equal(redacted.apiKey, "<redacted>");
  assert.equal(redacted.message, "key <redacted>");
});

test("toPiModels stamps the polza provider identity onto every mapped model", () => {
  const models = toPiModels([
    { id: "vendor/model", name: "Vendor Model", reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000, maxTokens: 100 },
  ]);
  assert.equal(models.length, 1);
  assert.equal(models[0]!.id, "vendor/model");
  assert.equal(models[0]!.provider, POLZA_PROVIDER_ID);
  assert.equal(models[0]!.api, "openai-completions");
  assert.match(models[0]!.baseUrl, /polza\.ai/);
  assert.equal(models[0]!.contextWindow, 1000);
});
