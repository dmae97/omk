#!/usr/bin/env node
/** New Node-only oracle. Does not read Rust or write any existing corpus. */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "./fixtures/contract-fixture-utils.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.length > 1 || args.some((arg) => arg !== "--check")) throw new Error("usage: record-anthropic-json-fixtures.mjs [--check]");
const target = join(root, "native/omk-providers/tests/fixtures/anthropic-json.json");
const home = mkdtempSync(join(tmpdir(), "omk-json-recorder-"));
try {
	const env = { HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: home };
	for (const key of ["PATH", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT"]) if (process.env[key]) env[key] = process.env[key];
	const run = spawnSync(process.execPath, ["--import", "tsx", "scripts/fixtures/anthropic-json-recorder.ts"], { cwd: root, env, encoding: "utf8", timeout: 30_000, maxBuffer: 16 * 1024 * 1024 });
	if (run.error || run.status !== 0) throw new Error(`JSON recorder failed: ${run.stderr}`);
	const fixture = JSON.parse(run.stdout);
	if (fixture.schema !== "omk.anthropic.json.v1" || fixture.values.length < 100 || fixture.streams.length !== 17) throw new Error("incomplete JSON recorder");
	if (/\/home\/|\/mnt\/|\/Users\/|sk-ant-|Bearer /.test(run.stdout)) throw new Error("JSON fixture privacy scan failed");
	for (const entry of fixture.streams) {
		if (entry.request.headers["x-api-key"] !== "faux-key" || entry.request.headers.authorization) throw new Error("non-synthetic credentials");
		if (entry.events.filter((event) => ["done", "error"].includes(event.type)).length !== 1) throw new Error("missing terminal event");
		if (entry.toolArguments.length !== entry.events.filter((event) => event.type.startsWith("toolcall_")).length) throw new Error("missing tool argument snapshot");
	}
	const output = `${JSON.stringify(fixture, null, 2)}\n`;
	if (args.includes("--check")) {
		if (readFileSync(target, "utf8") !== output) throw new Error("Node JSON oracle drift; do not regenerate to satisfy Rust");
	} else { mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, output); }
	console.log(`PASS: ${fixture.values.length} JSON observations, ${fixture.streams.length} streams; sha256=${sha256(output)}`);
} finally { rmSync(home, { recursive: true, force: true }); }
