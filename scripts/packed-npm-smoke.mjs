#!/usr/bin/env node
/**
 * Consumer gate for packed npm artifacts: pack every lockstep package, install
 * those exact tarballs into an empty prefix with lifecycle scripts disabled,
 * then execute the installed `omk` binary.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packages = ["ai", "tui", "agent", "protocol", "adaptorch-wpl", "coding-agent", "book-to-skill"];
const work = mkdtempSync(join(tmpdir(), "omk-packed-smoke-"));

function run(command, args, options = {}) {
	const result = spawnSync(command, args, { encoding: "utf8", ...options });
	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(" ")} failed (${result.status})\n${result.stderr || result.stdout}`);
	}
	return result.stdout.trim();
}

try {
	const tarballs = packages.map((name) => {
		const packed = JSON.parse(run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", work], { cwd: join(root, "packages", name) }));
		return join(work, packed[0].filename);
	});
	const prefix = join(work, "prefix");
	run("npm", ["install", "--global", "--prefix", prefix, "--ignore-scripts", "--no-audit", "--no-fund", ...tarballs]);
	const bin = join(prefix, "bin", "omk");
	const version = run(bin, ["--version"], { env: { ...process.env, OMK_OFFLINE: "1" } });
	run(bin, ["--help"], { env: { ...process.env, OMK_OFFLINE: "1" } });
	console.log(JSON.stringify({ ok: true, version, tarballs: tarballs.length }));
} finally {
	if (process.env.OMK_KEEP_PACKED_SMOKE !== "1") rmSync(work, { recursive: true, force: true });
}
