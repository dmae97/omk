import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { createReleasePromotionGate } = await import("../dist/cli/release-promotion-gate.js");

test("verify:no-kimi includes native non-smoke execution coverage", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const scripts = pkg.scripts ?? {};
  const verifyNoKimi = String(scripts["verify:no-kimi"] ?? "");
  const nativeTurn = String(scripts["native:no-kimi:turn"] ?? "");

  assert.match(verifyNoKimi, /native:no-kimi:turn/);
  assert.match(nativeTurn, /no-kimi-native-turn\.test\.mjs/);
  assert.doesNotMatch(nativeTurn, /--smoke/);
  assert.ok(
    verifyNoKimi
      .split("&&")
      .map((part) => part.trim())
      .some((part) => part.includes("native:no-kimi:turn") && !part.includes("smoke")),
    "verify:no-kimi must not remain smoke-only"
  );
});

test("release:check package contract includes no-Kimi, contract, proof, smoke, pack, and audit gates", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const scripts = pkg.scripts ?? {};
  const releaseCheck = String(scripts["release:check"] ?? "");
  const releaseCommands = releaseCheck
    .split("&&")
    .map((part) => part.trim())
    .filter(Boolean);
  const requiredGates = [
    "verify:no-kimi",
    "contract:check",
    "schema:check",
    "version:check",
    "proof:check",
    "smoke:execution",
    "pack:dry",
    "audit:package",
    "smoke:pack",
  ];

  for (const gate of requiredGates) {
    assert.ok(String(scripts[gate] ?? "").length > 0, `${gate} script must exist`);
    assert.ok(
      releaseCommands.includes(`npm run ${gate}`),
      `release:check must include npm run ${gate}`
    );
  }

  assert.match(String(scripts["verify:no-kimi"] ?? ""), /npm run native:no-kimi:turn/);
  assert.match(String(scripts["verify:no-kimi"] ?? ""), /npm run no-kimi:default-surface/);
  assert.match(String(scripts["verify:no-kimi"] ?? ""), /npm run test:no-kimi:runtime-routing/);
  assert.match(String(scripts["test:no-kimi:runtime-routing"] ?? ""), /provider-router\.test\.mjs/);
  assert.match(String(scripts["test:no-kimi:runtime-routing"] ?? ""), /runtime-router\.test\.mjs/);
  assert.match(String(scripts["test:no-kimi:runtime-routing"] ?? ""), /provider-routing\.test\.mjs/);
});

test("all package release commands finish with the final release promotion gate", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const scripts = pkg.scripts ?? {};

  for (const command of ["release:check", "release:full", "release:rc"]) {
    const script = String(scripts[command] ?? "");
    assert.match(script, /npm run version:check/);
    assert.match(script, /npm run proof:check/);
    assert.match(script, /npm run smoke:pack/);
    assert.match(script, /OMK_RELEASE_DEMO=1 node scripts\/release-gate\.mjs$/);
  }
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
