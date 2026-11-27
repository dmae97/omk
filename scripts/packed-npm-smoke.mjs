#!/usr/bin/env node
/**
 * Consumer gate for packed npm artifacts: pack every lockstep package, install
 * those exact tarballs into an empty prefix with lifecycle scripts disabled,
 * then execute the installed `omk` binary.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { sha256File } from "./lib/release-artifact-gate.mjs";

const root = resolve(import.meta.dirname, "..");
const packages = ["ai", "tui", "agent", "protocol", "adaptorch-wpl", "coding-agent", "book-to-skill", "speak-like-you-eat"];

function parseFlag(argv, name) {
	const idx = argv.indexOf(name);
	return idx >= 0 && argv[idx + 1] ? resolve(argv[idx + 1]) : undefined;
}

const outDirArg = parseFlag(process.argv.slice(2), "--out-dir") ?? (process.env.OMK_PACKED_ARTIFACTS_DIR ? resolve(process.env.OMK_PACKED_ARTIFACTS_DIR) : undefined);
const manifestArg = parseFlag(process.argv.slice(2), "--manifest") ?? (process.env.OMK_VERIFIED_MANIFEST_PATH ? resolve(process.env.OMK_VERIFIED_MANIFEST_PATH) : undefined);
const work = mkdtempSync(join(tmpdir(), "omk-packed-smoke-"));
const tarballDir = outDirArg ?? work;
if (outDirArg) mkdirSync(outDirArg, { recursive: true });

function run(command, args, options = {}) {
	const result = spawnSync(command, args, { encoding: "utf8", ...options });
	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(" ")} failed (${result.status})\n${result.stderr || result.stdout}`);
	}
	return result.stdout.trim();
}

try {
	const packedItems = packages.map((name) => {
		const pkgDir = join(root, "packages", name);
		const pkgJson = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
		const packed = JSON.parse(run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", tarballDir], { cwd: pkgDir }));
		const filePath = join(tarballDir, packed[0].filename);
		return {
			id: basename(filePath),
			packageName: pkgJson.name,
			version: pkgJson.version,
			filePath,
			sha256: sha256File(filePath),
		};
	});
	const tarballs = packedItems.map((item) => item.filePath);
	const prefix = join(work, "prefix");
	run("npm", ["install", "--global", "--prefix", prefix, "--ignore-scripts", "--no-audit", "--no-fund", ...tarballs]);
	const bin = join(prefix, "bin", "omk");
	const version = run(bin, ["--version"], { env: { ...process.env, OMK_OFFLINE: "1" } });
	run(bin, ["--help"], { env: { ...process.env, OMK_OFFLINE: "1" } });
	if (manifestArg) {
		const manifest = {
			schemaVersion: "omk.verified-release-artifacts.v1",
			version: packedItems[0]?.version ?? version,
			artifacts: packedItems.map((item) => ({
				id: item.id,
				packageName: item.packageName,
				platform: "npm",
				sha256: item.sha256,
				installPassed: true,
				smokePassed: true,
			})),
		};
		writeFileSync(manifestArg, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
	}
	console.log(JSON.stringify({ ok: true, version, tarballs: tarballs.length, ...(manifestArg ? { manifestPath: manifestArg } : {}) }));
} finally {
	if (process.env.OMK_KEEP_PACKED_SMOKE !== "1") rmSync(work, { recursive: true, force: true });
}
