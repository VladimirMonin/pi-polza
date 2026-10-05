import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeUsage } from "../.pi/extensions/pi-polza/usage.ts";

test("malformed cost_rub is unknown, not zero", () => {
  for (const cost_rub of ["bad", "", "  ", true, {}, [], NaN, Infinity]) {
    assert.equal(normalizeUsage({ cost_rub }).costRub, null, String(cost_rub));
  }
});

test("genuine zero and numeric decimal-string RUB remain valid", () => {
  for (const cost_rub of [0, "0", "0.25", 0.25]) {
    assert.equal(normalizeUsage({ cost_rub }).costRub, Number(cost_rub));
  }
});
