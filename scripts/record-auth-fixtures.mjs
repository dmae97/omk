#!/usr/bin/env node
/** Independent real Node AuthStorage/config oracle, never imports Rust. */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.length > 1 || args.some(arg => arg !== "--check")) throw new Error("usage: record-auth-fixtures.mjs [--check]");
const home = mkdtempSync(join(tmpdir(), "omk-auth-recorder-"));
try {
	const env = { HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: home, OMK_CODING_AGENT_DIR: join(home, "agent") };
	for (const key of ["PATH", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT"]) if (process.env[key]) env[key] = process.env[key];
	const run = spawnSync(process.execPath, ["--import", "tsx", "scripts/fixtures/auth-recorder.ts"], {
		cwd: root, env, encoding: "utf8", timeout: 30_000, maxBuffer: 2 * 1024 * 1024,
	});
	if (run.error || run.status !== 0) throw new Error(`auth recorder failed: ${run.error?.message ?? run.stderr}`);
	const fixture = JSON.parse(run.stdout);
	if (fixture.schema !== "omk.auth-resolution.v1" || fixture.cases.length !== 52) throw new Error("incomplete auth oracle");
	if (/\/home\/|\/mnt\/|\/Users\/|sk-ant-|Bearer /.test(run.stdout)) throw new Error("auth fixture privacy scan failed");
	const output = `${JSON.stringify(fixture, null, 2)}\n`;
	const target = join(root, "native/omk-providers/tests/fixtures/auth.json");
	if (args.includes("--check")) {
		if (readFileSync(target, "utf8") !== output) throw new Error("Node auth recording drift; do not regenerate to satisfy Rust");
	} else {
		writeFileSync(target, output, { flag: "wx" });
	}
	console.log(`PASS: ${fixture.cases.length} independent auth cases`);
} finally {
	rmSync(home, { recursive: true, force: true });
}
