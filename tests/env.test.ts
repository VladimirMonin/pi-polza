/**
 * `.env` location resolution.
 *
 * The critical property: an installed package must never read the source checkout's `.env`.
 * If Pi runs from the checkout, `cwd` is the checkout, so `<cwd>/.env` still resolves there;
 * from any other project only that project's `.env` (or an explicit override) is used.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { resolveDotEnvPath } from "../.pi/extensions/pi-polza/env.ts";

test("default is <cwd>/.env", () => {
  assert.equal(resolveDotEnvPath({ cwd: "/projects/consumer" }), resolve("/projects/consumer/.env"));
});

test("a consumer project never falls back to the source checkout", () => {
  const consumer = resolveDotEnvPath({ cwd: "/projects/consumer" });
  assert.ok(!consumer.includes("pi-polza-connection-plugin"), "must not point at the source repo");
  assert.equal(consumer, resolve("/projects/consumer/.env"));
});

test("running from the checkout still finds the checkout .env", () => {
  const repo = resolve("C:/PY/pi-polza-connection-plugin");
  assert.equal(resolveDotEnvPath({ cwd: repo }), resolve(repo, ".env"));
});

test("PI_POLZA_ENV_FILE overrides the cwd", () => {
  assert.equal(
    resolveDotEnvPath({ cwd: "/projects/consumer", override: "/custom/polza.env" }),
    resolve("/custom/polza.env"),
  );
});

test("a blank override is ignored", () => {
  assert.equal(resolveDotEnvPath({ cwd: "/projects/consumer", override: "   " }), resolve("/projects/consumer/.env"));
});
