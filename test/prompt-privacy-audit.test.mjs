import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const result = spawnSync(process.execPath, ["scripts/prompt-privacy-audit.mjs"], {
  cwd: process.cwd(),
  encoding: "utf8",
});

test("prompt privacy audit script passes and writes proof artifact", () => {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /prompt privacy audit passed/);
  assert.ok(existsSync("proof/prompt-privacy-audit.json"));
  const proof = JSON.parse(readFileSync("proof/prompt-privacy-audit.json", "utf8"));
  assert.equal(proof.leakCount, 0);
  assert.ok(Number.isInteger(proof.auditedDecisionTraceFiles));
  assert.ok(Number.isInteger(proof.auditedGraphMemoryFiles));
});
