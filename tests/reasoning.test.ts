/**
 * Reasoning evidence model: unknown is null, never a guessed false (no network).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  describeReasoning,
  reasoningObserved,
  reasoningVerificationFor,
  resolveThinkingLevelMap,
  VERIFIED_REASONING,
} from "../.pi/extensions/pi-polza/reasoning.ts";

test("unknown models are unverified, not 'reasoning disabled'", () => {
  const evidence = reasoningVerificationFor("vendor/unknown");
  assert.equal(evidence.source, "none");
  assert.equal(reasoningObserved(evidence), null);
  assert.equal(evidence.offVerified, null);
  assert.equal(evidence.offBehavior, "unverified");
});

test("gpt-oss: reasoning observed, but off is proven NOT to disable", () => {
  const evidence = reasoningVerificationFor("openai/gpt-oss-20b");
  assert.equal(evidence.reasoningPayloadObserved, true);
  assert.equal(evidence.usageReported, true);
  assert.equal(evidence.offVerified, false);
  assert.equal(evidence.offBehavior, "still-reasoning");
  assert.equal(evidence.levelControlVerified, null, "one prompt does not prove level control");
});

test("claude/gemini: inline reasoning observed while usage counter is 0 — off stays null", () => {
  for (const id of ["anthropic/claude-haiku-4.5", "google/gemini-2.5-flash-lite"]) {
    const evidence = reasoningVerificationFor(id);
    assert.equal(evidence.reasoningPayloadObserved, false, "no provider payload field");
    assert.equal(evidence.inlineReasoningObserved, true);
    assert.equal(evidence.usageReported, false, "counter is 0 — reported, not absent");
    assert.equal(evidence.offVerified, null, "0 tokens + no field is NOT proof of disabled");
    assert.equal(reasoningObserved(evidence), true, "inline counts as observed");
  }
});

test("no offVerified=true anywhere without positive proof", () => {
  for (const [id, evidence] of Object.entries(VERIFIED_REASONING)) {
    assert.notEqual(evidence.offVerified, true, `${id} must not claim off works`);
  }
});

test("no authored thinkingLevelMap until level control is verified (transport accepts ≠ mapped)", () => {
  for (const evidence of Object.values(VERIFIED_REASONING)) {
    assert.equal(resolveThinkingLevelMap(evidence), undefined);
  }
  assert.match(describeReasoning(reasoningVerificationFor("vendor/unknown")).join("\n"), /not verified/);
});

test("describeReasoning reports the independent properties", () => {
  const text = describeReasoning(reasoningVerificationFor("openai/gpt-oss-20b")).join("\n");
  assert.match(text, /request accepted: yes/);
  assert.match(text, /payload observed: yes/);
  assert.match(text, /usage counter: yes/);
  assert.match(text, /level control: unverified/);
  assert.match(text, /off disables: no \(still-reasoning\)/);
});
