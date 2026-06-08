#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();

const expectedSchemas = [
  ["omk.contract.v1", "schemas/omk.contract.v1.schema.json"],
  ["omk.evidence.v1", "schemas/omk.evidence.v1.schema.json"],
  ["omk.decision.v1", "schemas/omk.decision.v1.schema.json"],
  ["omk.run-manifest.v1", "schemas/omk.run-manifest.v1.schema.json"],
  ["omk.provider.v1", "schemas/omk.provider.v1.schema.json"],
  ["omk.version.v1", "schemas/omk.version.v1.schema.json"],
  ["omk.proof-bundle.v1", "schemas/omk.proof-bundle.v1.schema.json"],
  ["omk.interview.v1", "schemas/omk.interview.v1.schema.json"],
];

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

for (const [version, relativePath] of expectedSchemas) {
  try {
    const parsed = JSON.parse(await readFile(join(root, relativePath), "utf8"));
    if (!parsed.$schema) fail(`${relativePath}: missing $schema`);
    if (!parsed.$id) fail(`${relativePath}: missing $id`);
    if (!parsed.properties?.schemaVersion?.const && version !== "omk.contract.v1") {
      fail(`${relativePath}: missing schemaVersion const`);
    }
    if (version === "omk.contract.v1" && parsed.properties?.schemaVersion?.const !== version) {
      fail(`${relativePath}: schemaVersion const mismatch`);
    }
    if (version !== "omk.contract.v1" && parsed.properties?.schemaVersion?.const !== version) {
      fail(`${relativePath}: schemaVersion const mismatch`);
    }
  } catch (error) {
    fail(`${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

try {
  const { VersionReportSchema, OmkEnvelopeSchema } = await import("../dist/schema/index.js");
  const { buildVersionReport } = await import("../dist/commands/version.js");
  const { createOmkJsonEnvelope } = await import("../dist/util/json-envelope.js");
  const report = buildVersionReport();
  VersionReportSchema.parse(report);
  OmkEnvelopeSchema.parse(createOmkJsonEnvelope({
    command: "version",
    status: report.consistent ? "passed" : "failed",
    ok: report.consistent,
    data: report,
    durationMs: 0,
  }));
} catch (error) {
  fail(`dist schema validation failed: ${error instanceof Error ? error.message : String(error)}`);
}

if (process.exitCode) process.exit(process.exitCode);
console.log(`validated ${expectedSchemas.length} OMK JSON contract schemas`);
