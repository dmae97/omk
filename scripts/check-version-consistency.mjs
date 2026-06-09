#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const expectedPackageName = "open-multi-agent-kit";
const expectedRuntimeVersion = "v1.2";
const expectedContractVersion = "omk.contract.v1";

const schemaFiles = {
  "omk.contract.v1": "schemas/omk.contract.v1.schema.json",
  "omk.evidence.v1": "schemas/omk.evidence.v1.schema.json",
  "omk.decision.v1": "schemas/omk.decision.v1.schema.json",
  "omk.run-manifest.v1": "schemas/omk.run-manifest.v1.schema.json",
  "omk.provider.v1": "schemas/omk.provider.v1.schema.json",
  "omk.version.v1": "schemas/omk.version.v1.schema.json",
  "omk.proof-bundle.v1": "schemas/omk.proof-bundle.v1.schema.json",
};

const docsVersionFiles = [
  "README.md",
  "docs/versioning.md",
  "docs/getting-started.md",
  "docs/provider-maturity.md",
  "MATURITY.md",
];

const requiredBins = {
  omk: "dist/cli.js",
  "omk-project-mcp": "dist/mcp/omk-project-server.js",
  "omk-acp": "dist/mcp/acp-server.js",
  "omk-mcp-host": "dist/mcp/host.js",
};

const mismatches = [];

async function readJson(relativePath) {
  return JSON.parse(await readFile(join(root, relativePath), "utf8"));
}

async function readText(relativePath) {
  return readFile(join(root, relativePath), "utf8");
}

function expectEqual(file, field, expected, actual) {
  if (actual !== expected) {
    mismatches.push({ file, field, expected, actual });
  }
}

async function findLatestReleaseTruthProof() {
  const proofRoot = join(root, "proof/verified-runs");
  if (!existsSync(proofRoot)) return undefined;

  const entries = await readdir(proofRoot, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const proofPath = join("proof/verified-runs", entry.name, "proof-bundle.json");
    const absolute = join(root, proofPath);
    if (!existsSync(absolute)) continue;
    try {
      const bundle = await readJson(proofPath);
      if (bundle?.scenario !== "release-truthfulness") continue;
      const order = Number.parseInt(entry.name.match(/^(\d+)/)?.[1] ?? "0", 10);
      candidates.push({ proofPath, order, bundle });
    } catch {
      // Ignore malformed bundles here; proof:check reports shape errors.
    }
  }

  candidates.sort((a, b) => b.order - a.order || b.proofPath.localeCompare(a.proofPath));
  return candidates[0];
}

const pkg = await readJson("package.json");
const expectedPackageVersion = pkg.version;
expectEqual("package.json", "name", expectedPackageName, pkg.name);
if (typeof expectedPackageVersion !== "string" || expectedPackageVersion.length === 0) {
  mismatches.push({ file: "package.json", field: "version", expected: "non-empty string", actual: expectedPackageVersion });
}

for (const [name, target] of Object.entries(requiredBins)) {
  expectEqual("package.json", `bin.${name}`, target, pkg.bin?.[name]);
}

const lock = await readJson("package-lock.json");
expectEqual("package-lock.json", "version", expectedPackageVersion, lock.version);
expectEqual("package-lock.json", "packages[''].version", expectedPackageVersion, lock.packages?.[""]?.version);
for (const [name, target] of Object.entries(requiredBins)) {
  expectEqual("package-lock.json", `packages[''].bin.${name}`, target, lock.packages?.[""]?.bin?.[name]);
}

for (const file of docsVersionFiles) {
  const text = await readText(file);
  if (!text.includes(expectedPackageVersion)) {
    mismatches.push({ file, field: "current package version reference", expected: expectedPackageVersion, actual: "missing" });
  }
}

const releaseProof = await findLatestReleaseTruthProof();
if (!releaseProof) {
  mismatches.push({ file: "proof/verified-runs", field: "release-truthfulness proof", expected: expectedPackageVersion, actual: "missing" });
} else {
  expectEqual(releaseProof.proofPath, "omkVersion", expectedPackageVersion, releaseProof.bundle.omkVersion);
}

const sourceVersion = await readText("src/version.ts");
for (const token of [
  expectedRuntimeVersion,
  expectedContractVersion,
  "omk.evidence.v1",
  "omk.decision.v1",
  "omk.run-manifest.v1",
  "omk.provider.v1",
  "omk.version.v1",
  "omk.proof-bundle.v1",
]) {
  if (!sourceVersion.includes(token)) {
    mismatches.push({ file: "src/version.ts", field: "constant", expected: token, actual: "missing" });
  }
}

for (const [schemaVersion, file] of Object.entries(schemaFiles)) {
  const schema = await readJson(file);
  expectEqual(file, "properties.schemaVersion.const", schemaVersion, schema.properties?.schemaVersion?.const);
}

if (mismatches.length > 0) {
  console.error(JSON.stringify({ ok: false, mismatches }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  packageName: expectedPackageName,
  packageVersion: expectedPackageVersion,
  runtimeVersion: expectedRuntimeVersion,
  contractVersion: expectedContractVersion,
  releaseTruthProof: releaseProof?.proofPath,
  checkedFiles: [
    "package.json",
    "package-lock.json",
    ...docsVersionFiles,
    releaseProof?.proofPath,
    "src/version.ts",
    ...Object.values(schemaFiles),
  ].filter(Boolean),
}, null, 2));
