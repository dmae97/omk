#!/usr/bin/env node
/**
 * Release promotion gate wrapper.
 *
 * This script intentionally requires an explicit demoRun signal. `npm run
 * release:check` sets OMK_RELEASE_DEMO=1 only after the local minimal smoke and
 * package gates have passed. Running this script directly without that signal
 * blocks with a truthful missing-demo reason instead of silently assuming pass.
 */

const { createReleasePromotionGate } = await import("../dist/cli/release-promotion-gate.js");

function numberInput(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolInput(names, fallback = false) {
  for (const name of names) {
    const raw = process.env[name];
    if (raw === undefined || raw === "") continue;
    if (/^(1|true|yes|pass|passed)$/i.test(raw)) return true;
    if (/^(0|false|no|fail|failed|block)$/i.test(raw)) return false;
  }
  return fallback;
}

const gate = createReleasePromotionGate();

const inputs = {
  ci: numberInput("OMK_RELEASE_CI", 1),
  build: numberInput("OMK_RELEASE_BUILD", 1),
  types: numberInput("OMK_RELEASE_TYPES", 1),
  tests: numberInput("OMK_RELEASE_TESTS", 1),
  docs: numberInput("OMK_RELEASE_DOCS", 1),
  proofMedian: numberInput("OMK_RELEASE_PROOF", 1),
  maturity: numberInput("OMK_RELEASE_MATURITY", numberInput("OMK_RELEASE_PROVIDER", 0.8)),
  regressionSeverity: numberInput("OMK_RELEASE_REGRESSION", 0),
  freshInstallSmoke: numberInput("OMK_RELEASE_INSTALL", 1),
  semver: numberInput("OMK_RELEASE_SEMVER", 1),
  versionConsistency: numberInput("OMK_RELEASE_VERSION_CONSISTENCY", numberInput("OMK_RELEASE_SEMVER", 1)),
  demoRun: boolInput(["OMK_RELEASE_DEMO_RUN", "OMK_RELEASE_DEMO"], false),
  liveBenchmarkPass: boolInput(["OMK_RELEASE_LIVE_BENCHMARK", "OMK_RELEASE_LIVE_BENCHMARK_PASS"], false),
  sandboxViolationCount: numberInput("OMK_RELEASE_SANDBOX_VIOLATIONS", -1),
  exactTagCiPass: boolInput(["OMK_RELEASE_EXACT_TAG_CI", "OMK_RELEASE_EXACT_TAG_CI_PASS"], false),
};

const result = gate.evaluate(inputs);

console.log(JSON.stringify({
  ...result,
  inputs,
  inputSource: {
    demoRun: inputs.demoRun
      ? "explicit OMK_RELEASE_DEMO/OMK_RELEASE_DEMO_RUN after local release gates"
      : "missing explicit minimal verified demo signal",
    exactTagCiPass: inputs.exactTagCiPass
      ? "explicit OMK_RELEASE_EXACT_TAG_CI/OMK_RELEASE_EXACT_TAG_CI_PASS after tagged-commit CI verification"
      : "missing exact-tag CI verification signal",
  },
}, null, 2));

if (result.verdict === "block") {
  process.exit(1);
}
