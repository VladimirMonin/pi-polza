/**
 * Diagnostic probe: startup latency and OpenRouter outage behaviour.
 *
 * Run: npm run probe:startup
 */
import { loadDotEnv } from "../.pi/extensions/pi-polza/env.ts";
import { buildPolzaCatalog } from "../.pi/extensions/pi-polza/provider.ts";

async function main(): Promise<void> {
  loadDotEnv();

  const live = await buildPolzaCatalog({ openRouter: "live" });
  console.log("live        eligible=%d source=%s  polza=%dms openrouter=%dms total=%dms", live.eligible, live.openRouterSource, live.timings.polzaMs, live.timings.openRouterMs, live.timings.totalMs);

  const cached = await buildPolzaCatalog({ openRouter: "cache-first" });
  const ageMin = cached.openRouterCacheAgeMs === null ? "n/a" : `${Math.round(cached.openRouterCacheAgeMs / 60000)}min`;
  console.log("cache-first eligible=%d source=%s  age=%s  polza=%dms openrouter=%dms total=%dms", cached.eligible, cached.openRouterSource, ageMin, cached.timings.polzaMs, cached.timings.openRouterMs, cached.timings.totalMs);

  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("openrouter.ai")) throw new Error("simulated outage");
    return realFetch(input, init);
  };
  try {
    const outage = await buildPolzaCatalog({ openRouter: "live" });
    console.log("OR outage   eligible=%d source=%s error=%s", outage.eligible, outage.openRouterSource, outage.openRouterError);
  } finally {
    globalThis.fetch = realFetch;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
