#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const check = process.argv[2] === "--check";
if (process.argv.length > (check ? 3 : 2)) throw new Error("usage: record-catalog-fixtures.mjs [--check]");
const home = mkdtempSync(join(tmpdir(), "omk-catalog-"));
try {
 const env = { PATH: process.env.PATH, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: home, OMK_CODING_AGENT_DIR: join(home, "agent") };
 const run = spawnSync(process.execPath, ["--import", "tsx", "scripts/fixtures/catalog-recorder.ts"], { env, encoding: "utf8", timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
 if (run.error || run.status !== 0) throw new Error(`catalog recorder failed: ${run.error?.message ?? run.stderr}`);
 const data = JSON.parse(run.stdout);
 if (data.fixture.cases.length !== 16 || data.builtin.models.length < 100) throw new Error("incomplete oracle");
 for (const [path, value] of [["native/omk-providers/catalog.json", data.builtin], ["native/omk-providers/tests/fixtures/catalog.json", data.fixture]]) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (/\/home\/|\/mnt\/|sk-ant-/.test(text)) throw new Error("fixture privacy scan failed");
  if (check) { if (readFileSync(path, "utf8") !== text) throw new Error(`Node catalog drift: ${path}`); }
  else writeFileSync(path, text, { flag: "wx" });
 }
 console.log(`PASS: ${data.builtin.models.length} catalog models, ${data.fixture.cases.length} overlay cases`);
} finally { rmSync(home, { recursive: true, force: true }); }
