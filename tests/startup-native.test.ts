/** Real Pi 1.4 extension initialization, native login and model selection; synthetic HTTP only. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const worker = fileURLToPath(new URL("./fixtures/startup-worker.ts", import.meta.url));
const key = "synthetic-stored-credential";
const envKey = "synthetic-environment-credential";
const modelIds = ["fixture/main", "fixture/alternative"];
type StartInput = { http?: string; prompt?: boolean; refresh?: boolean; cliModel?: string; response?: string };

function run(root: string, action: "seed" | "start", input: StartInput = {}, useEnv = false) {
  const env: NodeJS.ProcessEnv = {};
  for (const name of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT"]) {
    if (process.env[name]) env[name] = process.env[name];
  }
  Object.assign(env, {
    HOME: root, USERPROFILE: root, APPDATA: join(root, "appdata"), LOCALAPPDATA: join(root, "localappdata"),
    TEMP: root, TMP: root, TMPDIR: root, PI_CODING_AGENT_DIR: join(root, "profile"),
  });
  if (useEnv) env.POLZA_API_KEY = envKey;
  const result = spawnSync(process.execPath, [worker, JSON.stringify({ action, key, ...input })], { cwd: root, env, encoding: "utf8", timeout: 25_000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, `worker exit ${result.status}\n${result.stdout}\n${result.stderr}`);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(key));
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(envKey));
  const last = result.stdout.trim().split(/\r?\n/).at(-1)!;
  return { ...JSON.parse(last), diagnostics: result.stderr };
}

test("Pi 1.4 cold start selects the configured Polza model before any request using only native persisted credentials", { timeout: 60_000 }, () => {
  const root = mkdtempSync(join(tmpdir(), "pi-polza-startup-"));
  try {
    const profile = join(root, "profile");
    mkdirSync(profile);
    run(root, "seed");
    assert.equal(existsSync(join(profile, "auth.json")), true);
    // Pi creates an empty store container even for cache-only login; cold start has no store.
    rmSync(join(profile, "models-store.json"), { force: true });
    assert.equal(existsSync(join(profile, "models-store.json")), false);
    assert.equal(existsSync(join(root, ".pi", "pi-polza-cache")), false);
    writeFileSync(join(profile, "settings.json"), JSON.stringify({ defaultProvider: "polza", defaultModel: "fixture/main" }));
    const result = run(root, "start", { prompt: true });
    assert.deepEqual(result.beforeRequest, { catalogCalls: 1, chatCalls: 0, models: modelIds });
    assert.deepEqual(result.selected, { provider: "polza", model: "fixture/main" });
    assert.equal(result.headersMatched.every(Boolean), true);
    assert.equal(result.chatCalls, 1);
    assert.deepEqual(result.requestedModels, ["fixture/main"]);
    assert.deepEqual(result.assistant, { provider: "polza", model: "fixture/main", stopReason: "stop", usdCost: 0 });
    assert.deepEqual(result.costs, [0.25]);
    // A separate process must use the credential persisted by the native login as well.
    const restarted = run(root, "start");
    assert.deepEqual(restarted.beforeRequest, result.beforeRequest);
    assert.deepEqual(restarted.selected, result.selected);
    assert.equal(restarted.source, "stored credential");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function withProfile(callback: (root: string) => void, options: { seed?: boolean; model?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), "pi-polza-startup-"));
  try {
    const profile = join(root, "profile");
    mkdirSync(profile);
    if (options.seed !== false) run(root, "seed");
    rmSync(join(profile, "models-store.json"), { force: true });
    writeFileSync(join(profile, "settings.json"), JSON.stringify({ defaultProvider: "polza", defaultModel: options.model ?? "fixture/main" }));
    callback(root);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("native saved credential wins over environment in both startup catalog and actual request", () => {
  withProfile((root) => {
    const result = run(root, "start", { prompt: true }, true);
    assert.equal(result.source, "stored credential");
    assert.deepEqual(result.beforeRequest.models, modelIds);
    assert.equal(result.headersMatched.every(Boolean), true);
    assert.equal(result.chatCalls, 1);
    assert.equal(result.assistant.stopReason, "stop");
  });
});

test("missing key registers the login provider and reports configuration, without HTTP or readiness", () => {
  withProfile((root) => {
    const result = run(root, "start");
    assert.match(result.diagnostics, /not configured.*\/login polza/);
    assert.deepEqual(result.beforeRequest, { catalogCalls: 0, chatCalls: 0, models: [] });
    assert.deepEqual(result.available, []);
    assert.deepEqual(result.selected, { provider: "unknown", model: "unknown" });
    assert.equal(result.requestedModelExists, false);
  }, { seed: false });
});

for (const http of ["rejected", "forbidden"]) {
  test(`native startup and refresh distinguish ${http} credentials from a network failure without leaking secrets`, () => {
    withProfile((root) => {
      const result = run(root, "start", { http, refresh: true }, true);
      assert.match(result.diagnostics, /Auth source: stored credential.*authorization rejected/);
      assert.match(result.refreshError, /authorization rejected.*\/login polza/);
      assert.doesNotMatch(result.diagnostics, /catalog unavailable/);
      assert.equal(result.headersMatched.every(Boolean), true, "a rejected saved key must not fall back to the environment");
      assert.deepEqual(result.beforeRequest.models, []);
      assert.equal(result.chatCalls, 0);
    });
  });
}

test("network failure reports unavailability; native persisted refresh cache is restored on restart", () => {
  withProfile((root) => {
    const cold = run(root, "start", { http: "network", refresh: true });
    assert.match(cold.diagnostics, /catalog unavailable \(network or service failure\)/);
    assert.match(cold.refreshError, /catalog unavailable/);
    assert.deepEqual(cold.beforeRequest.models, []);
    const warm = run(root, "start", { refresh: true });
    assert.equal(warm.refreshError, undefined);
    assert.deepEqual(warm.available, modelIds);
    const restored = run(root, "start", { http: "network" });
    assert.match(restored.diagnostics, /catalog unavailable/);
    assert.deepEqual(restored.beforeRequest.models, modelIds);
    assert.deepEqual(restored.selected, { provider: "polza", model: "fixture/main" });
    assert.equal(restored.chatCalls, 0, "cache restoration alone is not a successful model request");
  });
});

test("empty catalog is a visible initialization refusal, not successful readiness", () => {
  withProfile((root) => {
    const result = run(root, "start", { http: "empty", refresh: true });
    assert.match(result.diagnostics, /catalog contains no Pi-compatible models/);
    assert.match(result.refreshError, /catalog contains no Pi-compatible models/);
    assert.deepEqual(result.beforeRequest.models, []);
    assert.deepEqual(result.selected, { provider: "unknown", model: "unknown" });
    assert.equal(result.requestedModelExists, false);
  });
});

test("native CLI reports a missing model after a successful catalog, while an explicit alternative is preserved", () => {
  withProfile((root) => {
    const missing = run(root, "start", { cliModel: "fixture/not-in-catalog" });
    assert.deepEqual(missing.beforeRequest.models, modelIds);
    assert.equal(missing.requestedModelExists, false);
    assert.match(missing.cliWarning, /not found.*custom model id/);
    assert.equal(missing.diagnostics, "");
    const alternative = run(root, "start", { cliModel: "fixture/alternative", prompt: true });
    assert.equal(alternative.requestedModelExists, true);
    assert.deepEqual(alternative.selected, { provider: "polza", model: "fixture/alternative" });
    assert.deepEqual(alternative.requestedModels, ["fixture/alternative"]);
    assert.equal(alternative.assistant.model, "fixture/alternative");
    assert.equal(alternative.assistant.stopReason, "stop");
  });
});
