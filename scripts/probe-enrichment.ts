/**
 * Diagnostic probe: Polza catalog enriched with OpenRouter metadata.
 *
 * Reports how many incomplete Polza models can be completed from OpenRouter, plus conflict and
 * eligibility statistics. OpenRouter pricing is carried only as reference.
 *
 * Run: npm run probe:enrichment
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fetchCatalog, isUsableChatModel, supportsTextOutput } from "../.pi/extensions/pi-polza/catalog.ts";
import { PROJECT_ROOT } from "../.pi/extensions/pi-polza/env.ts";
import { redactJson } from "../.pi/extensions/pi-polza/http.ts";
import { buildPolzaCatalog } from "../.pi/extensions/pi-polza/provider.ts";
import { summarizeConflicts } from "../.pi/extensions/pi-polza/metadata/conflicts.ts";
import type { EligibilityReason, ResolvedModel } from "../.pi/extensions/pi-polza/metadata/types.ts";
import { normalizePolzaModel } from "../.pi/extensions/pi-polza/metadata/polza.ts";

const RAW_DIR = resolve(PROJECT_ROOT, "artifacts", "raw");

const EXAMPLES = ["google/gemini-2.5-flash", "openai/gpt-5.2", "moonshotai/kimi-k2-thinking"];

function reasonBreakdown(models: ResolvedModel[]): Map<EligibilityReason, number> {
  const counts = new Map<EligibilityReason, number>();
  for (const model of models) {
    for (const reason of model.piEligibility.reasons) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
  }
  return counts;
}

function printResolved(model: ResolvedModel): void {
  const lim = model.limits;
  console.log(
    `    ctx=${lim.contextWindow.value ?? "null"} (${lim.contextWindow.source})  maxOut=${lim.maxCompletionTokens.value ?? "null"} (${lim.maxCompletionTokens.source})`,
  );
  console.log(
    `    in=[${(model.modalities.input.value ?? []).join(",")}] (${model.modalities.input.source})  tools=${model.capabilities.tools.value ?? "null"} (${model.capabilities.tools.source})  vision=${model.capabilities.vision.value ?? "null"}  conflicts=${model.conflicts.length}`,
  );
}

async function main(): Promise<void> {
  console.log("Fetching Polza catalog + OpenRouter metadata...");
  const build = await buildPolzaCatalog({ openRouter: "live" });
  console.log(`OpenRouter source: ${build.openRouterSource}${build.openRouterError ? ` (${build.openRouterError})` : ""}`);
  const polzaModels = build.resolved.map((r) => r.raw.polza);
  const resolved = build.resolved;

  const chatDeclared = polzaModels.filter((m) => m.type === "chat");
  const chatUsable = polzaModels.filter(isUsableChatModel);
  const falselyMarkedChat = polzaModels.filter(
    (m) =>
      m.type === "chat" &&
      Array.isArray(m.architecture?.output_modalities) &&
      m.architecture.output_modalities.includes("embeddings") &&
      !m.architecture.output_modalities.includes("text"),
  );

  // --- metadata completeness over the chat-useful set ---
  const usableResolved = resolved.filter((r) => isUsableChatModel(r.raw.polza));
  const completeFromPolza = usableResolved.filter(
    (r) =>
      r.limits.contextWindow.source === "polza" &&
      r.limits.maxCompletionTokens.source === "polza" &&
      r.modalities.input.source === "polza",
  );
  const enriched = usableResolved.filter(
    (r) =>
      r.limits.contextWindow.source === "openrouter" ||
      r.limits.maxCompletionTokens.source === "openrouter" ||
      r.modalities.input.source === "openrouter" ||
      r.capabilities.tools.source === "openrouter" ||
      r.capabilities.reasoning.source === "openrouter",
  );
  const stillIncomplete = usableResolved.filter(
    (r) => r.limits.contextWindow.value === null || r.limits.maxCompletionTokens.value === null,
  );

  // --- limits ---
  const missingMax = usableResolved.filter((r) => normalizePolzaModel(r.raw.polza).maxCompletionTokens === null);
  const maxRecovered = missingMax.filter((r) => r.limits.maxCompletionTokens.source === "openrouter");
  const maxNotFound = missingMax.filter((r) => r.openRouterId === null);
  const maxAlsoUnknown = missingMax.filter(
    (r) => r.openRouterId !== null && r.limits.maxCompletionTokens.value === null,
  );

  const missingCtx = usableResolved.filter((r) => normalizePolzaModel(r.raw.polza).contextWindow === null);
  const ctxRecovered = missingCtx.filter((r) => r.limits.contextWindow.source === "openrouter");
  const ctxStillMissing = missingCtx.filter((r) => r.limits.contextWindow.value === null);

  // --- capabilities (over chat-declared) ---
  const chatResolved = resolved.filter((r) => r.raw.polza.type === "chat");
  const vision = chatResolved.filter((r) => r.capabilities.vision.value === true);
  const toolsDeclared = chatResolved.filter((r) => r.capabilities.tools.value === true);
  const reasoningDeclared = chatResolved.filter((r) => r.capabilities.reasoning.value === true);

  // --- conflicts ---
  const allConflicts = resolved.flatMap((r) => r.conflicts);
  const conflictSummary = summarizeConflicts(allConflicts);

  const eligible = resolved.filter((r) => r.piEligibility.eligible);
  const rejected = resolved.filter((r) => !r.piEligibility.eligible);
  const breakdown = reasonBreakdown(rejected);

  console.log("\n================ POLZA CATALOG ================");
  console.log(`Total:                              ${polzaModels.length}`);
  console.log(`Chat declared (type==chat):         ${chatDeclared.length}`);
  console.log(`Chat usable (text output):          ${chatUsable.length}`);
  console.log(`Embeddings falsely marked chat:     ${falselyMarkedChat.length}`);

  console.log("\n================ METADATA =====================");
  console.log(`Complete from Polza:                ${completeFromPolza.length}`);
  console.log(`Enriched from OpenRouter:           ${enriched.length}`);
  console.log(`Still incomplete (limits):          ${stillIncomplete.length}`);

  console.log("\n================ LIMITS =======================");
  console.log(`Missing context before enrichment:  ${missingCtx.length}`);
  console.log(`  recovered from OpenRouter:        ${ctxRecovered.length}`);
  console.log(`  still missing:                    ${ctxStillMissing.length}`);
  console.log(`Missing max output before:          ${missingMax.length}`);
  console.log(`  recovered from OpenRouter:        ${maxRecovered.length}`);
  console.log(`  exact ID not found in OpenRouter: ${maxNotFound.length}`);
  console.log(`  OpenRouter also unknown:          ${maxAlsoUnknown.length}`);

  console.log("\n================ CAPABILITIES (chat) ==========");
  console.log(`Vision:                             ${vision.length}`);
  console.log(`Tools declared:                     ${toolsDeclared.length}`);
  console.log(`Reasoning declared:                 ${reasoningDeclared.length}`);

  console.log("\n================ CONFLICTS ====================");
  console.log(`metadata conflicts:                 ${conflictSummary.total}`);
  console.log(`  context conflicts:                ${conflictSummary.contextWindow}`);
  console.log(`  max output conflicts:             ${conflictSummary.maxCompletionTokens}`);
  console.log(`  modality conflicts:               ${conflictSummary.modalities}`);
  console.log(`  capability conflicts:             ${conflictSummary.capabilities}`);

  console.log("\n================ PI ===========================");
  console.log(`Eligible:                           ${eligible.length}`);
  console.log(`Rejected:                           ${rejected.length}`);
  for (const [reason, count] of [...breakdown.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason}: ${count}`);
  }

  console.log("\n================ EXAMPLES =====================");
  for (const id of EXAMPLES) {
    const model = resolved.find((r) => r.id === id);
    if (!model) {
      console.log(`  ${id}: not present in current catalog`);
      continue;
    }
    console.log(`  ${id}:`);
    printResolved(model);
  }

  // Save a small resolved sample for tests.
  const sampleIds = new Set<string>(EXAMPLES);
  const sample = usableResolved
    .filter((r) => r.limits.maxCompletionTokens.source === "openrouter" || sampleIds.has(r.id))
    .slice(0, 12)
    .map((r) => r.raw.polza);
  mkdirSync(RAW_DIR, { recursive: true });
  writeFileSync(
    resolve(RAW_DIR, "enrichment-report.json"),
    JSON.stringify(redactJson({ generatedFrom: "polza+openrouter", resolved: usableResolved.length, allConflicts }), null, 2) + "\n",
  );
  writeFileSync(
    resolve(PROJECT_ROOT, "artifacts", "enrichment-sample.json"),
    JSON.stringify(
      { note: "Polza entries whose limits need OpenRouter enrichment, captured by probe-enrichment", polzaModels: sample },
      null,
      2,
    ) + "\n",
  );
  console.log(`\nSaved ${sample.length} enrichment sample models to artifacts/enrichment-sample.json`);
}

main().catch((error) => {
  console.error("probe-enrichment failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
