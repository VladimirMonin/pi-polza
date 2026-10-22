/** Isolated Pi lifecycle worker. Credentials, prompts, catalog and SSE replies are synthetic. */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface Input {
  action: "seed" | "start";
  key?: string;
  http?: "ok" | "rejected" | "forbidden" | "network" | "empty";
  prompt?: boolean;
  refresh?: boolean;
  cliModel?: string;
  response?: "ok" | "error" | "incomplete" | "unpriced";
}
const input = JSON.parse(process.argv[2]!) as Input;
const cwd = process.cwd();
const agentDir = process.env.PI_CODING_AGENT_DIR!;
assert.ok(agentDir && resolve(agentDir).startsWith(resolve(cwd)), "worker must use its synthetic profile");
assert.equal(process.env.PI_POLZA_ENV_FILE, undefined);
assert.equal(existsSync(join(cwd, ".env")), false);
const sdk = await import("@earendil-works/pi-coding-agent");
assert.equal(sdk.VERSION, "1.4.0");
assert.equal(resolve(sdk.getAgentDir()), resolve(agentDir));
const { createProvider } = await import("@earendil-works/pi-ai");

let catalogCalls = 0;
let chatCalls = 0;
const headersMatched: boolean[] = [];
const requestedModels: string[] = [];
globalThis.fetch = async (url, options) => {
  const target = String(url instanceof Request ? url.url : url);
  const headers = new Headers(options?.headers ?? (url instanceof Request ? url.headers : undefined));
  headersMatched.push(headers.get("authorization") === `Bearer ${input.key}`);
  if (target.startsWith("https://polza.ai/api/v1/models/catalog?")) {
    catalogCalls++;
    // Deliberately echo both fake credentials. Neither may reach real diagnostic output.
    if (input.http === "rejected" || input.http === "forbidden") {
      return new Response(`rejected ${input.key} ${process.env.POLZA_API_KEY ?? ""}`, { status: input.http === "forbidden" ? 403 : 401 });
    }
    if (input.http === "network") throw new Error(`synthetic network failure ${input.key}`);
    const data = input.http === "empty" ? [] : ["fixture/main", "fixture/alternative"].map((id) => ({
      id, name: id, type: "chat", endpoints: ["/api/v1/chat/completions"],
      architecture: { input_modalities: ["text"], output_modalities: ["text"] },
      top_provider: { context_length: 8192, max_completion_tokens: 64, supported_parameters: ["tools"], pricing: { currency: "RUB" } },
    }));
    return Response.json({ data, meta: { total: data.length, totalPages: 1 } });
  }
  if (target === "https://polza.ai/api/v1/chat/completions") {
    chatCalls++;
    const payload = JSON.parse(String(options?.body ?? (url instanceof Request ? await url.text() : "{}")));
    requestedModels.push(payload.model);
    const chunks: unknown[] = [{ choices: [{ delta: { content: "ok" }, finish_reason: null }] }];
    if (input.response === "error") chunks.push({ error: { message: "synthetic response error", type: "synthetic" } });
    else if (input.response !== "incomplete") {
      chunks.push({ choices: [{ delta: {}, finish_reason: "stop" }] });
      chunks.push({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 1, ...(input.response === "unpriced" ? {} : { cost_rub: "0.25" }) } });
    }
    return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  }
  throw new Error("Unexpected network request in isolated startup test");
};

if (input.action === "seed") {
  const { polzaApiKeyAuth } = await import("../../.pi/extensions/pi-polza/auth.ts");
  const runtime = await sdk.ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") });
  // Native login/storage; no hand-written auth.json and no catalog cache.
  const { openAICompletionsApi } = await import("@earendil-works/pi-ai/compat");
  runtime.registerNativeProvider(createProvider({ id: "polza", auth: { apiKey: polzaApiKeyAuth }, models: [], api: openAICompletionsApi() }));
  await runtime.login("polza", "api_key", { prompt: async () => input.key!, notify: () => {} });
  assert.equal((await runtime.getAuth("polza"))?.source, "stored credential");
  assert.equal(catalogCalls, 0);
  assert.equal(chatCalls, 0);
  console.log(JSON.stringify({ seeded: true }));
} else {
  const services = await sdk.createAgentSessionServices({
    cwd, agentDir,
    resourceLoaderOptions: {
      additionalExtensionPaths: [fileURLToPath(new URL("../../.pi/extensions/pi-polza/index.ts", import.meta.url))],
      noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    },
  });
  assert.deepEqual(services.diagnostics, []);
  assert.deepEqual(services.resourceLoader.getExtensions().errors, []);
  const models = services.modelRuntime.getModels("polza");
  const beforeRequest = { catalogCalls, chatCalls, models: models.map((model) => model.id) };
  const cli = input.cliModel ? sdk.resolveCliModel({ cliProvider: "polza", cliModel: input.cliModel, modelRuntime: services.modelRuntime }) : undefined;
  const { session } = await sdk.createAgentSessionFromServices({
    services, sessionManager: sdk.SessionManager.inMemory(cwd), noTools: "all", model: cli?.model,
  });
  const identity = (model: typeof session.model) => model && { provider: model.provider, model: model.id };
  try {
    await session.bindExtensions({});
    let refreshError: string | undefined;
    if (input.refresh) {
      const result = await services.modelRuntime.refresh({ providers: ["polza"], allowNetwork: true });
      refreshError = result.errors.get("polza")?.message;
    }
    const selected = identity(session.model);
    if (input.prompt && session.model) await session.prompt("Synthetic startup check: reply ok.");
    const assistant = session.state.messages.filter((message) => message.role === "assistant").at(-1);
    const entries = session.sessionManager.getEntries().filter((entry) => entry.type === "custom" && entry.customType === "polza-cost");
    console.log(JSON.stringify({
      beforeRequest, selected, headersMatched, catalogCalls, chatCalls, requestedModels,
      available: (await services.modelRuntime.getAvailable("polza")).map((model) => model.id),
      source: (await services.modelRuntime.getAuth("polza"))?.source,
      cliWarning: cli?.warning, cliError: cli?.error,
      requestedModelExists: Boolean(services.modelRuntime.getModel("polza", input.cliModel ?? services.settingsManager.getDefaultModel()!)),
      refreshError,
      assistant: assistant && { provider: assistant.provider, model: assistant.model, stopReason: assistant.stopReason, usdCost: assistant.usage.cost.total },
      costs: entries.map((entry) => (entry as { data: { costRub: number | null } }).data.costRub),
    }));
  } finally { session.dispose(); }
}
