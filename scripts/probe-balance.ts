/**
 * Diagnostic probe for the Polza balance API.
 *
 * Verifies the real v2 response schema and prints the fields that matter.
 * Balance is global account state — it is NOT session cost and can move due to
 * concurrent requests, so differences across this probe are informational only.
 *
 * Run: npm run probe:balance
 */
import { fetchBalance, formatRub } from "../.pi/extensions/pi-polza/balance.ts";

async function main(): Promise<void> {
  const balance = await fetchBalance();

  console.log("Balance v2 fields (observed, native RUB — no FX applied):");
  console.log(`  amount         ${balance.amount} (${formatRub(balance.amount)})`);
  console.log(`  available      ${balance.available} (${formatRub(balance.available)})`);
  console.log(`  reservedAmount ${balance.reservedAmount} (${formatRub(balance.reservedAmount)})`);
  console.log(`  spentAmount    ${balance.spentAmount} (${formatRub(balance.spentAmount)})  <- lifetime spent, NOT session cost`);
  console.log(`  currency       ${balance.currency}`);
  console.log(`  updatedAt      ${balance.updatedAt ?? "(not provided)"}`);

  console.log(
    "\nNote: `spentAmount` is lifetime account spend. Per-request RUB cost must come from `usage.cost_rub`.",
  );
}

main().catch((error) => {
  console.error("probe-balance failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
