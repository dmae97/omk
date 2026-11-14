#!/usr/bin/env node
/** Independent Node oracle for the next K1 unit; no Rust imports or existing corpus writes. */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.length > 1 || args.some((arg) => arg !== "--check")) throw new Error("usage: record-anthropic-history-fixtures.mjs [--check]");
const target = join(root, "native/omk-providers/tests/fixtures/anthropic-history.json");
const home = mkdtempSync(join(tmpdir(), "omk-history-recorder-"));
try {
	const env = { HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: home };
	for (const key of ["PATH", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT"]) if (process.env[key]) env[key] = process.env[key];
	const run = spawnSync(process.execPath, ["--import", "tsx", "scripts/fixtures/anthropic-history-recorder.ts"], {
		cwd: root, env, encoding: "utf8", timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
	});
	if (run.error || run.status !== 0) throw new Error(`history recorder failed: ${run.stderr}`);
	const fixture = JSON.parse(run.stdout);
	if (fixture.schema !== "omk.anthropic.text-history.v1" || fixture.cases.length !== 12) throw new Error("incomplete history oracle");
	if (/\/home\/|\/mnt\/|\/Users\/|sk-ant-|Bearer /.test(run.stdout)) throw new Error("history fixture privacy scan failed");
	for (const entry of fixture.cases) {
		if (entry.request.url !== "https://synthetic.invalid/v1/messages" || entry.request.headers["x-api-key"] !== "faux-key" || entry.request.headers.authorization) throw new Error("non-synthetic request");
	}
	const output = `${JSON.stringify(fixture, null, 2)}\n`;
	if (args.includes("--check")) {
		if (readFileSync(target, "utf8") !== output) throw new Error("Node history recording drift; do not regenerate to satisfy Rust");
	} else {
		writeFileSync(target, output);
	}
	console.log(`PASS: ${fixture.cases.length} text-history requests`);
} finally {
	rmSync(home, { recursive: true, force: true });
}
