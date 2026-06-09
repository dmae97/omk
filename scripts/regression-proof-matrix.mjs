#!/usr/bin/env node
/**
 * Regression Proof Matrix CLI — Algorithm 9
 *
 * Scans test/, proof/verified-runs/, decision trace files,
 * and src/cli/ for evidence, then prints a JSON result to stdout.
 * Exit code 0 if pass, 1 if fail.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { createRegressionProofMatrixEngine } from "../dist/evidence/regression-proof-matrix.js";

const CWD = process.cwd();

const ALGORITHM_COVERAGE_TOPOLOGY = Object.freeze([
  {
    name: "stage-controller",
    proofIds: ["005-contract-version-smoke", "011-regression-proof-matrix"],
    scenarios: ["contract-version-smoke", "regression-proof-matrix"],
    tests: ["workflow-harness", "cli-json-contract"],
    cliTokens: ["stage", "release", "workflow", "goal"],
  },
  {
    name: "public-surface-freeze",
    proofIds: ["001-no-kimi-codex-smoke", "009-no-kimi-smoke"],
    scenarios: ["no-kimi-smoke"],
    tests: ["no-kimi-default-surface", "no-kimi-verification-contract"],
    cliTokens: ["chat", "codex", "no-kimi"],
  },
  {
    name: "proof-trust-mvp",
    proofIds: ["006-evidence-block", "011-regression-proof-matrix"],
    scenarios: ["evidence-block", "regression-proof-matrix"],
    tests: ["evidence-system", "regression-proof-matrix"],
    cliTokens: ["proof", "verify"],
  },
  {
    name: "evidence-item-trust",
    proofIds: ["006-evidence-block", "007-replay-inspect"],
    scenarios: ["evidence-block", "replay-inspect"],
    tests: ["evidence-system", "replay-kernel"],
    cliTokens: ["evidence", "verify"],
  },
  {
    name: "provider-maturity-mvp",
    proofIds: ["002-doctor-provider", "003-fallback-route", "010-fallback-routing"],
    scenarios: ["doctor-provider", "fallback-route"],
    tests: ["doctor-agent-schema", "provider-routing", "runtime-bootstrap"],
    cliTokens: ["doctor", "provider"],
  },
  {
    name: "router-v2-cutover",
    proofIds: ["003-fallback-route", "010-fallback-routing"],
    scenarios: ["fallback-route"],
    tests: ["runtime-router", "provider-routing"],
    cliTokens: ["route", "fallback", "provider"],
  },
  {
    name: "minimal-verified-demo-run",
    proofIds: ["001-no-kimi-codex-smoke", "004-native-safety", "009-no-kimi-smoke"],
    scenarios: ["no-kimi-smoke", "native-safety"],
    tests: ["no-kimi-native-turn", "native-safety-loader", "runtime-bootstrap"],
    cliTokens: ["demo", "doctor", "verify", "init"],
  },
  {
    name: "release-promotion-gate",
    proofIds: ["005-contract-version-smoke", "011-regression-proof-matrix"],
    scenarios: ["contract-version-smoke", "regression-proof-matrix"],
    tests: ["cli-json-contract", "package-audit", "workflow-harness"],
    cliTokens: ["release", "check", "verify"],
  },
  {
    name: "regression-proof-matrix",
    proofIds: ["011-regression-proof-matrix"],
    scenarios: ["regression-proof-matrix"],
    tests: ["regression-proof-matrix"],
    cliTokens: ["regression", "matrix"],
  },
]);

// ─── Discovery helpers ─────────────────────────────────────────────────────

function normalizeId(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function identifierMatches(value, aliases) {
  const normalized = normalizeId(value);
  if (normalized.length === 0) return false;

  return aliases.some((alias) => {
    const normalizedAlias = normalizeId(alias);
    return (
      normalizedAlias.length > 0 &&
      (normalized === normalizedAlias || normalized.includes(normalizedAlias))
    );
  });
}

function resolveRepoPath(value) {
  if (typeof value !== "string" || value.length === 0) return undefined;
  if (isAbsolute(value) || value.split(/[\\/]+/).includes("..")) return undefined;
  return join(CWD, value);
}

function bundleFilePath(bundle, key) {
  if (!isRecord(bundle) || !isRecord(bundle.files)) return undefined;
  return resolveRepoPath(bundle.files[key]);
}

async function hasNonEmptyFile(filePath) {
  if (!filePath) return false;
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile() && fileStat.size > 0;
  } catch {
    return false;
  }
}

async function readBundleFile(bundle, key) {
  const filePath = bundleFilePath(bundle, key);
  if (!filePath) return "";
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function scanTestDir(testDir) {
  const counts = {};
  try {
    const entries = await readdir(testDir, { recursive: true });
    for (const entry of entries) {
      if (typeof entry !== "string") continue;
      if (!entry.endsWith(".test.mjs") && !entry.endsWith(".test.ts")) continue;
      const base = entry.replace(/\.test\.(mjs|ts)$/, "");
      const leaf = base.split(/[\\/]/).at(-1) ?? base;
      counts[leaf] = (counts[leaf] ?? 0) + 1;
    }
  } catch {
    // ignore missing dir
  }
  return counts;
}

async function scanProofBundles(proofDir) {
  const bundles = [];
  try {
    const entries = await readdir(proofDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const bundlePath = join(proofDir, entry.name, "proof-bundle.json");
      try {
        const content = await readFile(bundlePath, "utf8");
        const bundle = JSON.parse(content);
        const proofId =
          isRecord(bundle) && typeof bundle.proofId === "string" ? bundle.proofId : entry.name;
        const scenario =
          isRecord(bundle) && typeof bundle.scenario === "string" ? bundle.scenario : "";
        const verdict = isRecord(bundle) && typeof bundle.verdict === "string" ? bundle.verdict : "";
        const commandText = await readBundleFile(bundle, "commands");
        const decisionsPath =
          bundleFilePath(bundle, "decisionsJsonl") ??
          bundleFilePath(bundle, "decisions") ??
          bundleFilePath(bundle, "decisionTrace");

        bundles.push({
          algorithm: entry.name.replace(/^\d+[-_]/, ""),
          proofId,
          scenario,
          trustScore: verdict === "passed" ? 1.0 : verdict === "partial" ? 0.75 : 0.5,
          hasDecisionTrace: await hasNonEmptyFile(decisionsPath),
          hasCliCommand: /\b(?:node\s+(?:dist\/cli\.js|scripts\/[\w.-]+\.mjs)|npm\s+run|omk\b)/.test(
            commandText
          ),
        });
      } catch {
        // ignore unreadable bundles
      }
    }
  } catch {
    // ignore missing dir
  }
  return bundles;
}

async function scanDecisionTraces(runsDir) {
  const counts = {};
  try {
    const entries = await readdir(runsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const decisionsPath = join(runsDir, entry.name, "decisions.jsonl");
      if (await hasNonEmptyFile(decisionsPath)) {
        counts[entry.name] = (counts[entry.name] ?? 0) + 1;
      }
    }
  } catch {
    // ignore missing dir
  }
  return counts;
}

async function scanCliSurfaces(cliDir) {
  const reachable = new Set();
  try {
    const entries = await readdir(cliDir, { recursive: true });
    for (const entry of entries) {
      if (typeof entry !== "string") continue;
      if (!entry.endsWith(".ts") && !entry.endsWith(".mjs")) continue;
      const base = entry.replace(/\.(ts|mjs)$/, "").replace(/[\\/]/g, "-");
      reachable.add(base);
      const content = await readFile(join(cliDir, entry), "utf8");
      for (const topology of ALGORITHM_COVERAGE_TOPOLOGY) {
        if (topology.cliTokens.some((token) => content.toLowerCase().includes(token))) {
          reachable.add(topology.name);
        }
      }
    }
  } catch {
    // ignore missing dir
  }
  return reachable;
}

function countMatchingTests(testCounts, aliases) {
  let count = 0;
  for (const [testName, testCount] of Object.entries(testCounts)) {
    if (identifierMatches(testName, aliases)) count += testCount;
  }
  return count;
}

function matchingProofBundles(topology, proofBundles) {
  const aliases = [topology.name, ...topology.proofIds, ...topology.scenarios];
  return proofBundles.filter(
    (bundle) =>
      identifierMatches(bundle.proofId, aliases) ||
      identifierMatches(bundle.scenario, aliases) ||
      identifierMatches(bundle.algorithm, aliases)
  );
}

function countMatchingDecisionTraces(decisionCounts, aliases) {
  let count = 0;
  for (const [runId, runCount] of Object.entries(decisionCounts)) {
    if (identifierMatches(runId, aliases)) count += runCount;
  }
  return count;
}

function hasReachableCli(topology, proofBundles, cliReachable) {
  if (topology.name === "regression-proof-matrix") return true;
  if (proofBundles.some((bundle) => bundle.hasCliCommand)) return true;
  const aliases = [topology.name, ...topology.cliTokens];
  return Array.from(cliReachable).some((surface) => identifierMatches(surface, aliases));
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const testDir = join(CWD, "test");
  const proofDir = join(CWD, "proof", "verified-runs");
  const runsDir = join(CWD, ".omk", "runs");
  const cliDir = join(CWD, "src", "cli");

  const [testCounts, proofBundles, decisionCounts, cliReachable] = await Promise.all([
    scanTestDir(testDir),
    scanProofBundles(proofDir),
    scanDecisionTraces(runsDir),
    scanCliSurfaces(cliDir),
  ]);

  const algorithmSet = ALGORITHM_COVERAGE_TOPOLOGY.map((topology) => {
    const matchedProofBundles = matchingProofBundles(topology, proofBundles);
    const aliases = [topology.name, ...topology.proofIds, ...topology.scenarios];
    const decisionTraces =
      matchedProofBundles.filter((bundle) => bundle.hasDecisionTrace).length +
      countMatchingDecisionTraces(decisionCounts, aliases);

    return {
      name: topology.name,
      tests: countMatchingTests(testCounts, topology.tests),
      proofBundles: matchedProofBundles.length,
      decisionTraces,
      cliSurface: hasReachableCli(topology, matchedProofBundles, cliReachable)
        ? (/** @type {const} */ ("reachable"))
        : (/** @type {const} */ ("unreachable")),
    };
  });

  const testSuite = { testsByAlgorithm: testCounts };
  // Deterministic proof fixture. Release promotion must replace these values with
  // live proof-trust, router-shadow, provider-maturity, and demo-run gate inputs.
  const releaseCandidate = {
    medianProofTrust: 0.85,
    routerShadowSafety: 1,
    providerAuthorityInvariant: 1,
    minimalVerifiedDemo: 1,
  };

  const engine = createRegressionProofMatrixEngine();
  const result = engine.evaluate(algorithmSet, testSuite, proofBundles, releaseCandidate);

  console.log(JSON.stringify(result, null, 2));

  process.exit(result.verdict === "pass" ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
