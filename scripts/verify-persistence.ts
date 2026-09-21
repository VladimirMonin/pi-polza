/**
 * Rebuild the accounting ledger from a real session file — exactly what `session_start` does.
 *
 * Usage: node scripts/verify-persistence.ts [session.jsonl]
 * With no argument, uses the most recent session in this project.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { POLZA_COST_ENTRY, recordsFromEntries, summarizeRecords } from "../.pi/extensions/pi-polza/accounting.ts";
import { SESSION_DIR } from "./session-dir.ts";

function latestSession(): string {
  const files = readdirSync(SESSION_DIR)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => resolve(SESSION_DIR, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (files.length === 0) throw new Error(`No sessions in ${SESSION_DIR}`);
  return files[0]!;
}

const file = process.argv[2] ? resolve(process.argv[2]) : latestSession();
const lines = readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
const entries = lines.map((line) => JSON.parse(line) as unknown);

const rawCount = entries.filter((e) => (e as { customType?: string }).customType === POLZA_COST_ENTRY).length;
const records = recordsFromEntries(entries);
const summary = summarizeRecords(records);

console.log(`Session: ${file}`);
console.log(`Raw "${POLZA_COST_ENTRY}" entries: ${rawCount}`);
console.log(`Rebuilt records:               ${records.length}`);
console.log(`Requests:                      ${summary.requests}`);
console.log(`Input tokens:                  ${summary.promptTokens}`);
console.log(`Output tokens:                 ${summary.completionTokens}`);
console.log(`Models:                        ${summary.models.map((m) => `${m.modelId}=${m.costRub ?? "?"}`).join(", ")}`);
console.log(`Actual cost:                   ${summary.actualCostRub ?? "unknown"} RUB`);

if (rawCount !== records.length) {
  console.error("MISMATCH: raw entries vs rebuilt records");
  process.exit(1);
}
console.log("OK: persisted ledger rebuilds consistently (no loss, no doubling).");
