import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { createReleasePromotionGate } = await import("../dist/cli/release-promotion-gate.js");

test("verify:no-kimi includes no-kimi non-smoke execution coverage", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const scripts = pkg.scripts ?? {};
  const verifyNoKimi = String(scripts["verify:no-kimi"] ?? "");

  assert.ok(
    verifyNoKimi
      .split("&&")
      .map((part) => part.trim())
      .some((part) => part.includes("no-kimi") && !part.includes("smoke")),
    "verify:no-kimi must not remain smoke-only"
  );
});

test("release gate core package contract includes no-Kimi, authority, contract, proof, smoke, pack, and audit gates", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const scripts = pkg.scripts ?? {};
  const releaseGateCore = String(scripts["release:gate-core"] ?? "");
  const releaseCommands = releaseGateCore
    .split("&&")
    .map((part) => part.trim())
    .filter(Boolean);
  const requiredGates = [
    "verify:no-kimi",
    "verify:no-persona",
    "contract:check",
    "schema:check",
    "version:check",
    "proof:check",
    "authority:smoke",
    "prompt:privacy:check",
    "smoke:execution",
    "pack:dry",
    "audit:package",
    "smoke:pack",
  ];

  assert.equal(String(scripts["release:check"] ?? ""), "npm run release:gate-core");

  for (const gate of requiredGates) {
    assert.ok(String(scripts[gate] ?? "").length > 0, `${gate} script must exist`);
    assert.ok(
      releaseCommands.includes(`npm run ${gate}`),
      `release:gate-core must include npm run ${gate}`
    );
  }

  assert.match(String(scripts["verify:no-kimi"] ?? ""), /npm run no-kimi:default-surface/);
  assert.match(String(scripts["verify:no-kimi"] ?? ""), /npm run test:no-kimi:runtime-routing/);
  assert.match(String(scripts["test:no-kimi:runtime-routing"] ?? ""), /provider-router\.test\.mjs/);
  assert.match(String(scripts["test:no-kimi:runtime-routing"] ?? ""), /runtime-router\.test\.mjs/);
  assert.match(String(scripts["test:no-kimi:runtime-routing"] ?? ""), /provider-routing\.test\.mjs/);
});

test("all package release commands finish with the final release promotion gate", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const scripts = pkg.scripts ?? {};

  const core = String(scripts["release:gate-core"] ?? "");
  for (const gate of ["version:check", "proof:check", "authority:smoke", "prompt:privacy:check", "smoke:pack"]) {
    assert.match(core, new RegExp(`npm run ${gate}`));
  }
  assert.match(core, /OMK_RELEASE_DEMO=1 node scripts\/release-gate\.mjs$/);
  assert.equal(String(scripts["release:check"] ?? ""), "npm run release:gate-core");
  assert.equal(String(scripts["release:full"] ?? ""), "npm run verify && npm run release:gate-core");
  assert.equal(String(scripts["release:rc"] ?? ""), "npm run verify && npm run release:gate-core");
});

test("release truthfulness docs match package version and avoid unverified npm latest claims", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const changelog = await readFile("CHANGELOG.md", "utf-8");
  const readme = await readFile("README.md", "utf-8");

  assert.equal(changelog.match(/^##\s+(v\d+\.\d+\.\d+)\b/m)?.[1], `v${pkg.version}`);
  assert.doesNotMatch(readme, /Published npm [`']?latest[`']? is/i);
  assert.match(readme, /registry verification/);
});

test("stable release verdict requires exact-tag CI in addition to live benchmark and sandbox proof", () => {
  const gate = createReleasePromotionGate();
  const stableCandidate = {
    ci: 1,
    build: 1,
    types: 1,
    tests: 1,
    docs: 1,
    proofMedian: 1,
    maturity: 1,
    regressionSeverity: 0,
    freshInstallSmoke: 1,
    semver: 1,
    versionConsistency: 1,
    demoRun: true,
    liveBenchmarkPass: true,
    sandboxViolationCount: 0,
  };

  const missingExactTag = gate.evaluate(stableCandidate);
  assert.equal(missingExactTag.verdict, "pre-release");
  assert.match(missingExactTag.reasons.join("\n"), /exact-tag CI passes/);

  const exactTagVerified = gate.evaluate({ ...stableCandidate, exactTagCiPass: true });
  assert.equal(exactTagVerified.verdict, "stable");
});
