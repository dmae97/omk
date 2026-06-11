#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const DEFAULT_LAYERS = [
  { name: "orchestration", paths: ["src/orchestration"], importance: 0.40 },
  { name: "evidence", paths: ["src/evidence"], importance: 0.25 },
  { name: "metrics-tooling", paths: ["src/metrics", "scripts/provenance-ratio.mjs", "scripts/check-file-size.mjs"], importance: 0.15 },
  { name: "runtime", paths: ["src/runtime", "src/providers"], importance: 0.10 },
  { name: "commands-util", paths: ["src/commands", "src/util"], importance: 0.10 },
];

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function mergeBase(upstream) {
  try {
    return git(["merge-base", upstream, "HEAD"]);
  } catch {
    return git(["rev-list", "--max-parents=0", "HEAD"]).split(/\r?\n/)[0];
  }
}

function trackedAndUntrackedFiles(paths) {
  const out = git(["ls-files", "--cached", "--others", "--exclude-standard", "--", ...paths]);
  return out.split(/\r?\n/).filter(Boolean);
}

function numstat(base, paths) {
  const out = git(["diff", "--numstat", base, "--", ...paths]);
  let changed = 0;
  for (const line of out.split(/\r?\n/).filter(Boolean)) {
    const [added, deleted] = line.split(/\s+/);
    changed += (Number.parseInt(added, 10) || 0) + (Number.parseInt(deleted, 10) || 0);
  }
  const untracked = trackedAndUntrackedFiles(paths).filter((file) => !isTracked(file));
  for (const file of untracked) {
    if (!EXT.test(file) || !existsSync(file)) continue;
    changed += readFileSync(file, "utf8").split(/\r?\n/).length;
  }
  return changed;
}

const EXT = /\.(ts|tsx|js|mjs|cjs)$/u;

function isTracked(file) {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", file], { encoding: "utf8", stdio: ["ignore", "ignore", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

function loc(paths) {
  const files = trackedAndUntrackedFiles(paths);
  let total = 0;
  for (const file of files) {
    if (!EXT.test(file) || !existsSync(file)) continue;
    total += readFileSync(file, "utf8").split(/\r?\n/).length;
  }
  return total;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function round6(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

const upstreamArg = process.argv.find((arg) => arg.startsWith("--upstream="));
const upstream = upstreamArg ? upstreamArg.slice("--upstream=".length) : "origin/main";
const base = mergeBase(upstream);
const layers = DEFAULT_LAYERS.map((layer) => {
  const currentLoc = loc(layer.paths);
  const changed = numstat(base, layer.paths);
  const originality = clamp01(currentLoc <= 0 ? 0 : changed / currentLoc);
  return {
    name: layer.name,
    paths: layer.paths,
    addedModifiedLines: changed,
    loc: currentLoc,
    importance: layer.importance,
    originality: round6(originality),
    weightedOriginality: round6(originality * layer.importance),
  };
});
const headlineOriginality = round6(layers.reduce((sum, layer) => sum + layer.weightedOriginality, 0));
const result = { schemaVersion: "omk.provenance-ratio.v1", upstream, base, headlineOriginality, layers };
console.log(JSON.stringify(result, null, 2));
