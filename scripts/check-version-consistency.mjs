#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const expectedPackageName = "open-multi-agent-kit";
const expectedRuntimeVersion = "v1.2";
const expectedContractVersion = "omk.contract.v1";
const expectedPackageVersion = "0.78.1";

const schemaFiles = {
  "omk.contract.v1": "schemas/omk.contract.v1.schema.json",
  "omk.evidence.v1": "schemas/omk.evidence.v1.schema.json",
  "omk.decision.v1": "schemas/omk.decision.v1.schema.json",
  "omk.run-manifest.v1": "schemas/omk.run-manifest.v1.schema.json",
  "omk.provider.v1": "schemas/omk.provider.v1.schema.json",
  "omk.version.v1": "schemas/omk.version.v1.schema.json",
  "omk.proof-bundle.v1": "schemas/omk.proof-bundle.v1.schema.json",
};

const mismatches = [];

async function readJson(relativePath) {
  return JSON.parse(await readFile(join(root, relativePath), "utf8"));
}

function expectEqual(file, field, expected, actual) {
  if (actual !== expected) {
    mismatches.push({ file, field, expected, actual });
  }
}

const pkg = await readJson("package.json");
expectEqual("package.json", "name", expectedPackageName, pkg.name);
expectEqual("package.json", "version", expectedPackageVersion, pkg.version);

const lock = await readJson("package-lock.json");
expectEqual("package-lock.json", "version", expectedPackageVersion, lock.version);
expectEqual("package-lock.json", "packages[''].version", expectedPackageVersion, lock.packages?.[""]?.version);

const sourceVersion = await readFile(join(root, "src/version.ts"), "utf8");
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
  checkedFiles: ["package.json", "package-lock.json", "src/version.ts", ...Object.values(schemaFiles)],
}, null, 2));
