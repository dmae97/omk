#!/usr/bin/env node
/** Synthetic K0 evidence. Recorders run in isolated homes; no credentials or network lookup. */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inventory, normalizeJsonl, parseJson, privacyScan, sha256, validateManifest } from "./fixtures/contract-fixture-utils.mjs";
import { recordRpc } from "./fixtures/contract-rpc-recording.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE = join(ROOT, "packages/coding-agent");
const FIXTURES = join(ROOT, "native/omk-contract/tests/fixtures");
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--check") || args.length > 1) throw new Error("usage: record-contract-fixtures.mjs [--check]");
const check = args.includes("--check");
const work = mkdtempSync(join(tmpdir(), "omk-contract-fixtures-"));
const fresh = join(work, "fixtures");

function run(command, args, options) {
	const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 180_000, ...options });
	if (result.error || result.signal || result.status !== 0) throw new Error(`offline recorder failed (exit=${result.status}, signal=${result.signal ?? "none"})`);
	return result.stdout;
}

function sourceIdentity() {
	const files = run("git", ["ls-files", "-z", "packages/*/src", "packages/*/test", "scripts/fixtures", "scripts/record-contract-fixtures.mjs"], { cwd: ROOT }).split("\0").filter(Boolean);
	files.push("scripts/fixtures/contract-fixture-utils.mjs", "scripts/fixtures/contract-rpc-recording.mjs");
	return {
		head: run("git", ["rev-parse", "HEAD"], { cwd: ROOT }).trim(),
		// The old golden corpus is copied evidence, not a fresh behavior/parity pass.
		selectedSourceSha256: sha256([...new Set(files)].sort().map((path) => `${path}:${sha256(readFileSync(join(ROOT, path)))}`).join("\n")),
	};
}

async function record() {
	for (const path of [fresh, join(work, "home"), join(work, "tmp"), join(work, "g0")]) mkdirSync(path, { recursive: true });
	const env = {};
	for (const key of ["PATH", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT"]) if (process.env[key]) env[key] = process.env[key];
	Object.assign(env, {
		HOME: join(work, "home"), USERPROFILE: join(work, "home"), XDG_CONFIG_HOME: join(work, "home"),
		TMPDIR: join(work, "tmp"), TEMP: join(work, "tmp"), TMP: join(work, "tmp"),
		OMK_CODING_AGENT_DIR: join(work, "home/agent"), OMK_BASH_SANDBOX: "off", G0_DUMP: join(work, "g0"),
	});
	const normalize = (text) => normalizeJsonl(text, [[join(work, "tmp"), "<tmpdir>"], [work, "<work>"], [PACKAGE, "<pkg>"], [ROOT, "<repo>"]]);
	const origin = sourceIdentity();
	run(process.execPath, ["--import", "tsx", "test/suite/g0-session-hash.ts"], { cwd: PACKAGE, env });
	mkdirSync(join(fresh, "g0"));
	for (const [source, target] of [["session.jsonl", "session.jsonl"], ["requests.jsonl", "provider-requests.jsonl"]])
		writeFileSync(join(fresh, "g0", target), normalize(readFileSync(join(work, "g0", source), "utf8")));

	const goldenDir = join(PACKAGE, "test/suite/fixtures/session-equivalence");
	mkdirSync(join(fresh, "session-equivalence"));
	for (const name of readdirSync(goldenDir).filter((name) => name.endsWith(".json")).sort())
		copyFileSync(join(goldenDir, name), join(fresh, "session-equivalence", name));

	const transcript = await recordRpc(process.execPath, ["--import", "tsx", join(ROOT, "scripts/fixtures/rpc-recorder-driver.ts")], { cwd: ROOT, env });
	writeFileSync(join(fresh, "rpc-transcript.jsonl"), normalize(transcript.map((row) => JSON.stringify(row)).join("\n")));
	if (JSON.stringify(sourceIdentity()) !== JSON.stringify(origin)) throw new Error("source changed during recording");
	const manifest = {
		schema: "omk.contract.fixtures.v2", generatedBy: "scripts/record-contract-fixtures.mjs", origin,
		normalization: { paths: "synthetic placeholders", uuids: "first occurrence", fauxApi: "faux:<api>", promptSettledDurationMs: 0 },
		copiedGoldenEvidence: "archived synthetic records only; not fresh parity evidence",
		files: inventory(fresh),
	};
	writeFileSync(join(fresh, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
	privacyScan(fresh);
	validateManifest(fresh);
	return manifest;
}

try {
	if (check) validateManifest(FIXTURES);
	const manifest = await record();
	if (check) {
		const expected = validateManifest(FIXTURES);
		if (JSON.stringify(expected.files) !== JSON.stringify(manifest.files)) throw new Error("fixture bytes or file set differ from fresh recording");
		console.log(`PASS: ${manifest.files.length} fixtures match a fresh recording; manifest digests verified`);
	} else {
		// Publish only validated, path-free records. Do not remove or overwrite unrelated files.
		const allowed = new Set(manifest.files.map((entry) => entry.path));
		if (existsSync(FIXTURES) && inventory(FIXTURES).some((entry) => !allowed.has(entry.path))) throw new Error("unexpected existing fixture; publication refused");
		for (const name of [...allowed, "manifest.json"]) {
			mkdirSync(dirname(join(FIXTURES, name)), { recursive: true });
			writeFileSync(join(FIXTURES, name), readFileSync(join(fresh, name)));
		}
		console.log(`RECORDED: ${manifest.files.length} validated synthetic fixtures (v2)`);
	}
} catch (error) {
	console.error(error instanceof Error ? error.message : "fixture recording failed");
	process.exitCode = 1;
} finally {
	rmSync(work, { recursive: true, force: true });
}
