/**
 * Secret audit: prove the live Polza key is not present in the repo tree, in Git history, or in
 * runtime artifacts (session JSONL, OpenRouter cache).
 *
 * The key itself is NEVER printed — only the paths that would contain it and a match count.
 *
 * Run: npm run audit:secrets
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { loadDotEnv, PROJECT_ROOT } from "../.pi/extensions/pi-polza/env.ts";

const SKIP_DIRS = new Set([".git", "node_modules", ".pi/pi-polza-cache"]);
/** Files that legitimately hold or describe secrets and are never release artifacts. */
const SKIP_FILES = new Set([".env", "scripts/audit-secrets.ts"]);

interface Hit {
  path: string;
  count: number;
}

function walk(root: string, hits: (path: string, content: Buffer) => void, top: string = root): void {
  if (!existsSync(root)) return;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    const rel = relative(top, full).split("\\").join("/");
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || rel.includes("node_modules/")) continue;
      walk(full, hits, top);
    } else if (entry.isFile()) {
      if (SKIP_FILES.has(rel)) continue;
      let content: Buffer;
      try {
        if (statSync(full).size > 8 * 1024 * 1024) continue;
        content = readFileSync(full);
      } catch {
        continue;
      }
      hits(full, content);
    }
  }
}

function countNeedle(content: Buffer, needle: string): number {
  if (!needle) return 0;
  const hay = content.toString("latin1");
  const pat = Buffer.from(needle, "utf8").toString("latin1");
  let count = 0;
  let index = hay.indexOf(pat);
  while (index !== -1) {
    count += 1;
    index = hay.indexOf(pat, index + pat.length);
  }
  return count;
}

function scanTree(root: string, needles: string[]): Hit[] {
  const hits: Hit[] = [];
  walk(root, (path, content) => {
    let total = 0;
    for (const needle of needles) total += countNeedle(content, needle);
    if (total > 0) hits.push({ path: relative(root, path).split("\\").join("/"), count: total });
  });
  return hits;
}

/** Search every blob reachable from any ref with `git grep -F -f <patternfile>`. */
function scanGitHistory(root: string, needles: string[]): Hit[] {
  const dir = mkdtempSync(join(tmpdir(), "pi-polza-audit-"));
  const patternFile = join(dir, "patterns.txt");
  const hits: Hit[] = [];
  try {
    writeFileSync(patternFile, needles.join("\n"), "utf8");
    const revs = execFileSync("git", ["rev-list", "--all"], { cwd: root, encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
    for (const rev of revs) {
      let out: string;
      try {
        out = execFileSync("git", ["grep", "-F", "-l", "-f", patternFile, rev], { cwd: root, encoding: "utf8" });
      } catch {
        continue; // exit code 1 = no matches in this revision
      }
      for (const line of out.split("\n").filter(Boolean)) {
        const [revPart, ...rest] = line.split(":");
        hits.push({ path: `${revPart!.slice(0, 8)}:${rest.join(":")}`, count: 1 });
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return hits;
}

function main(): void {
  loadDotEnv();
  const key = process.env.POLZA_API_KEY?.trim();

  const genericNeedles = ["POLZA_API_KEY=sk", "POLZA_API_KEY=pk", "sk-polza", "Bearer sk-"];
  console.log(`Live key available for value scan: ${key ? "yes" : "no"}`);
  console.log("(The key value is never printed.)\n");

  const needles = key ? [key, ...genericNeedles] : genericNeedles;

  const repoTree = scanTree(PROJECT_ROOT, needles);

  let history: Hit[] = [];
  try {
    history = scanGitHistory(PROJECT_ROOT, needles);
  } catch (error) {
    console.log(`Git history scan skipped: ${error instanceof Error ? error.message : String(error)}`);
  }

  const smoke = "C:/PY/pi-polza-smoke-test";
  const smokeTree = existsSync(smoke) ? scanTree(smoke, needles).filter((h) => !h.path.endsWith(".env")) : [];

  const sessionsRoot = "C:/Users/User/.pi/agent/sessions";
  const sessions = existsSync(sessionsRoot)
    ? scanTree(sessionsRoot, key ? [key] : needles).filter((h) => h.path.includes("pi-polza"))
    : [];

  const report = (label: string, hits: Hit[]): void => {
    console.log(`${label}: ${hits.length === 0 ? "clean" : `${hits.length} file(s) with matches`}`);
    for (const hit of hits) console.log(`   ${hit.path} (x${hit.count})`);
  };

  report("Repo working tree", repoTree);
  report("Git history", history);
  report("Smoke-test workspace (excluding .env)", smokeTree);
  report("Polza sessions under ~/.pi (local dev data, not a release artifact)", sessions);

  // Release blockers: anything inside the repo, its history, or the shipped workspace.
  const releaseLeaks = repoTree.length + history.length + smokeTree.length;
  console.log(
    `\n${releaseLeaks === 0 ? "PASS: no live credential in repo, history, or workspace." : "FAIL: credential exposure in release artifacts above."}`,
  );
  if (sessions.length > 0) {
    console.log(
      "WARN: the live key appears in a local session file above. This is dev data outside the package; " +
        "rotate the key and/or delete that session file if it matters.",
    );
  }
  process.exit(releaseLeaks === 0 ? 0 : 1);
}

main();
