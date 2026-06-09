#!/usr/bin/env node
/**
 * Thin wrapper around the release promotion gate engine.
 * Imports from compiled dist; run `npm run build` first.
 */

const { createReleasePromotionGate } = await import("../dist/cli/release-promotion-gate.js");

const gate = createReleasePromotionGate();

const result = gate.evaluate({
  ci: Number(process.env.OMK_RELEASE_CI ?? "1"),
  schema: Number(process.env.OMK_RELEASE_SCHEMA ?? "1"),
  docs: Number(process.env.OMK_RELEASE_DOCS ?? "1"),
  proofMedian: Number(process.env.OMK_RELEASE_PROOF ?? "1"),
  providerMinimum: Number(process.env.OMK_RELEASE_PROVIDER ?? "1"),
  regressionSeverity: Number(process.env.OMK_RELEASE_REGRESSION ?? "0"),
  freshInstallSmoke: Number(process.env.OMK_RELEASE_INSTALL ?? "1"),
  semver: Number(process.env.OMK_RELEASE_SEMVER ?? "1"),
});

console.log(JSON.stringify(result, null, 2));

if (result.verdict === "block") {
  process.exit(1);
}
