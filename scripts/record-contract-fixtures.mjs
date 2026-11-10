#!/usr/bin/env node
/**
 * Spec 120 K0 (T005): record synthetic contract fixtures from the TypeScript
 * implementation. No provider call, no credential, no real session.
 *
 * Sources, all existing offline recorders:
 *   - test/suite/g0-session-hash.ts (G0_DUMP): canonical session JSONL and
 *     provider request contexts.
 *   - test/suite/fixtures/session-equivalence/*.json: normalized golden records
 *     of provider requests, session events and traces, copied unchanged.
 *   - scripts/fixtures/rpc-recorder-driver.ts: a real runRpcMode session driven
 *     over stdin/stdout, recorded as an RPC transcript.
 *
 * Usage:
 *   node scripts/record-contract-fixtures.mjs           # write fixtures
 *   node scripts/record-contract-fixtures.mjs --check   # re-record and compare
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE = join(ROOT, "packages/coding-agent");
const FIXTURES = join(ROOT, "native/omk-contract/tests/fixtures");
const CHECK = process.argv.includes("--check");

function run(command, args, options) {
	const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options });
	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(" ")} failed (${result.status})\n${result.stdout}\n${result.stderr}`);
	}
	return result;
}

function normalize(text, replacements) {
	let out = text;
	for (const [from, to] of replacements) out = out.split(from).join(to);
	const ids = new Map();
	return out
		.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, (uuid) => {
			const key = uuid.toLowerCase();
			if (!ids.has(key)) ids.set(key, `<id-${ids.size + 1}>`);
			return ids.get(key);
		})
		.replace(/"faux:\d+:[a-z0-9]+"/g, '"faux:<api>"')
		.replace(/"durationMs":\d+(?:\.\d+)?/g, '"durationMs":"<ms>"');
}

function normalizeForCheckout(text, workDir) {
	return normalize(text, [
		[workDir, "<tmp>"],
		[tmpdir(), "<tmpdir>"],
		[PACKAGE, "<pkg>"],
		[ROOT, "<repo>"],
	]);
}

async function recordRpc(workDir) {
	const child = spawn("npx", ["tsx", join(ROOT, "scripts/fixtures/rpc-recorder-driver.ts")], {
		cwd: ROOT,
		env: { ...process.env, OMK_BASH_SANDBOX: "off" },
		stdio: ["pipe", "pipe", "inherit"],
	});
	const lines = [];
	let buffer = "";
	child.stdout.on("data", (chunk) => {
		buffer += chunk.toString("utf8");
		for (;;) {
			const index = buffer.indexOf("\n");
			if (index < 0) break;
			const line = buffer.slice(0, index);
			buffer = buffer.slice(index + 1);
			if (line.trim().length > 0) lines.push(line);
		}
	});
	const send = (value) => {
		const line = JSON.stringify(value);
		lines.push(line);
		child.stdin.write(`${line}\n`);
	};
	const waitFor = async (predicate, label) => {
		const deadline = Date.now() + 120_000;
		while (!lines.some(predicate)) {
			if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
			if (child.exitCode !== null) throw new Error(`RPC driver exited early (${child.exitCode})`);
			await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
		}
	};
	const exited = new Promise((resolvePromise) => child.on("exit", resolvePromise));

	try {
		// RPC mode emits nothing until it receives a command; the pipe buffers
		// anything sent before the driver attaches its reader.
		send({ id: "state-1", type: "get_state" });
		await waitFor((line) => line.includes("state-1"), "get_state response");
		send({ id: "prompt-1", type: "prompt", message: "hello" });
		await waitFor((line) => line.includes('"prompt_settled"'), "prompt_settled");
		send({ id: "prompt-2", type: "prompt", message: "second" });
		await waitFor(
			() => lines.filter((l) => l.includes('"prompt_settled"')).length >= 2,
			"second prompt_settled",
		);
		send({ id: "state-2", type: "get_state" });
		await waitFor((line) => line.includes("state-2"), "second get_state response");
		child.stdin.end();
		await exited;
	} finally {
		if (child.exitCode === null) child.kill("SIGKILL");
	}

		const transcript = normalizeForCheckout(lines.join("\n"), workDir);
		return transcript;
	}

async function recordAll(destination) {
	mkdirSync(destination, { recursive: true });
	const workDir = mkdtempSync(join(tmpdir(), "omk-contract-fixtures-"));
	try {
		// 1. G0 canonical session and provider requests.
		const g0Dump = join(workDir, "g0");
		mkdirSync(g0Dump, { recursive: true });
		run("npx", ["tsx", "test/suite/g0-session-hash.ts"], {
			cwd: PACKAGE,
			env: { ...process.env, OMK_BASH_SANDBOX: "off", G0_DUMP: g0Dump },
		});
		mkdirSync(join(destination, "g0"), { recursive: true });
		for (const name of ["session.jsonl", "requests.jsonl"]) {
			const target = name === "session.jsonl" ? "session.jsonl" : "provider-requests.jsonl";
			writeFileSync(
				join(destination, "g0", target),
				normalizeForCheckout(readFileSync(join(g0Dump, name), "utf8"), workDir),
			);
		}

		// 2. Normalized session-equivalence goldens, copied unchanged.
		const goldenDir = join(PACKAGE, "test/suite/fixtures/session-equivalence");
		const goldenOut = join(destination, "session-equivalence");
		mkdirSync(goldenOut, { recursive: true });
		for (const file of readdirSync(goldenDir).filter((name) => name.endsWith(".json"))) {
			copyFileSync(join(goldenDir, file), join(goldenOut, file));
		}

		// 3. RPC transcript from a real runRpcMode session.
		const transcript = await recordRpc(workDir);
		writeFileSync(join(destination, "rpc-transcript.jsonl"), `${transcript}\n`);

		// Manifest with per-file digests.
		const files = [];
		const walk = (dir) => {
			for (const entry of readdirSync(dir, { withFileTypes: true })) {
				const full = join(dir, entry.name);
				if (entry.isDirectory()) walk(full);
				else if (entry.name !== "manifest.json") files.push(full);
			}
		};
		walk(destination);
		const manifest = {
			schema: "omk.contract.fixtures.v1",
			generatedBy: "scripts/record-contract-fixtures.mjs",
			sources: [
				"packages/coding-agent/test/suite/g0-session-hash.ts",
				"packages/coding-agent/test/suite/fixtures/session-equivalence",
				"scripts/fixtures/rpc-recorder-driver.ts",
			],
			files: files
				.map((file) => ({
					path: file.slice(destination.length + 1),
					sha256: createHash("sha256").update(readFileSync(file)).digest("hex"),
				}))
				.sort((a, b) => a.path.localeCompare(b.path)),
		};
		writeFileSync(join(destination, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
		return manifest;
	} finally {
		rmSync(workDir, { recursive: true, force: true });
	}
}

function privacyScan(directory) {
	const forbidden = [process.env.HOME, tmpdir(), "/home/", "/mnt/", "/Users/", "C:\\Users"].filter(Boolean);
	const walk = (dir) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else {
				const text = readFileSync(full, "utf8");
				for (const needle of forbidden) {
					if (text.includes(needle)) throw new Error(`private path ${needle} in ${full}`);
				}
			}
		}
	};
	walk(directory);
}

const workDestination = CHECK ? mkdtempSync(join(tmpdir(), "omk-contract-check-")) : FIXTURES;
const manifest = await recordAll(workDestination);
privacyScan(workDestination);
console.log(`recorded ${manifest.files.length} fixture files into ${workDestination}`);

if (CHECK) {
	let mismatches = 0;
	for (const file of manifest.files) {
		const fresh = readFileSync(join(workDestination, file.path), "utf8");
		const committedPath = join(FIXTURES, file.path);
		if (!existsSync(committedPath)) {
			console.error(`missing committed fixture ${file.path}`);
			mismatches += 1;
			continue;
		}
		if (readFileSync(committedPath, "utf8") !== fresh) {
			console.error(`fixture differs: ${file.path}`);
			mismatches += 1;
		}
	}
	rmSync(workDestination, { recursive: true, force: true });
	if (mismatches > 0) {
		console.error(`${mismatches} fixture mismatch(es)`);
		process.exit(1);
	}
	console.log("all fixtures match a fresh recording");
}
