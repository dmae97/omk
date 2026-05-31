import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import { versionCommand } from "../dist/commands/version.js";
import {
  OmkEnvelopeSchema,
  VersionReportSchema,
} from "../dist/schema/index.js";

function captureOutput() {
  const stdout = [];
  const stderr = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args) => stdout.push(args.join(" "));
  console.error = (...args) => stderr.push(args.join(" "));
  return {
    stdout,
    stderr,
    restore() {
      console.log = origLog;
      console.error = origErr;
    },
  };
}

test("version --json emits one OMK contract envelope", async () => {
  const cap = captureOutput();
  try {
    await versionCommand({ json: true });
  } finally {
    cap.restore();
  }

  assert.equal(cap.stdout.length, 1);
  assert.equal(cap.stderr.length, 0);
  assert.doesNotMatch(cap.stdout[0], /\u001b\[[0-9;]*m/);

  const parsed = JSON.parse(cap.stdout[0]);
  OmkEnvelopeSchema.parse(parsed);
  VersionReportSchema.parse(parsed.data);
  assert.equal(parsed.schemaVersion, "omk.contract.v1");
  assert.equal(parsed.command, "version");
  assert.equal(parsed.runtimeVersion, "v1.2");
  assert.equal(parsed.data.schemaVersion, "omk.version.v1");
});

test("dist cli version --json stdout is exactly one parseable JSON document", () => {
  const result = spawnSync(process.execPath, ["dist/cli.js", "version", "--json"], {
    encoding: "utf8",
    env: {
      ...process.env,
      OMK_MCP_PREFLIGHT: "off",
    },
  });

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  OmkEnvelopeSchema.parse(parsed);
  assert.equal(parsed.command, "version");
  assert.equal(parsed.schemaVersion, "omk.contract.v1");
  assert.doesNotMatch(result.stdout, /\u001b\[[0-9;]*m/);
});
