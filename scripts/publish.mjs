#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// npm provenance attestations require a Sigstore-capable CI provider (GitHub
// Actions). Local publishes fail with EUSAGE "Automatic provenance generation
// not supported for provider: null", so provenance is attached automatically
// in CI and skipped locally unless forced with --provenance.
export function provenanceSupported(env = process.env) {
	return env.GITHUB_ACTIONS === "true" && Boolean(env.ACTIONS_ID_TOKEN_REQUEST_TOKEN);
}

export function resolveProvenance(argv, env = process.env) {
	if (argv.includes("--no-provenance")) return false;
	if (argv.includes("--provenance")) return true;
	return provenanceSupported(env);
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

const packages = [
	{ directory: "packages/ai", name: "omk-ai" },
	{ directory: "packages/tui", name: "omk-tui" },
	{ directory: "packages/agent", name: "omk-agent-core" },
	{ directory: "packages/protocol", name: "omk-protocol" },
	{ directory: "packages/adaptorch-wpl", name: "omk-adaptorch-wpl" },
	{ directory: "packages/coding-agent", name: "open-multi-agent-kit" },
	{ directory: "packages/book-to-skill", name: "omk-book-to-skill" },
];

const dryRun = process.argv.includes("--dry-run");
const provenance = resolveProvenance(process.argv);

/**
 * Candidate binding: the publish-eligible identity is (commit SHA, lockfile
 * hash). A local publish must run from a clean worktree so the artifact being
 * published is the candidate the tests ran against — not an edited tree with
 * someone else's green CI. `OMK_PUBLISH_REF` may name the expected tag (e.g.
 * `v0.99.0`); when set, HEAD must carry that tag so the release points at the
 * verified candidate rather than a nearby commit.
 */
function assertPublishCandidate() {
	if (dryRun) return;
	const dirty = spawnSync(commandForPlatform("git"), ["status", "--porcelain"], {
		encoding: "utf8",
		stdio: ["inherit", "pipe", "pipe"],
	});
	if (dirty.status !== 0) {
		throw new Error("git status failed; cannot bind the publish candidate");
	}
	if (dirty.stdout.trim().length > 0) {
		throw new Error(
			"Worktree is dirty. Publish requires a clean candidate so the published artifact matches the tested commit.",
		);
	}
	const expectedRef = process.env.OMK_PUBLISH_REF;
	if (expectedRef) {
		const head = spawnSync(commandForPlatform("git"), ["rev-parse", "HEAD"], {
			encoding: "utf8",
			stdio: ["inherit", "pipe", "pipe"],
		});
		const tag = spawnSync(commandForPlatform("git"), ["rev-list", "-n", "1", expectedRef], {
			encoding: "utf8",
			stdio: ["inherit", "pipe", "pipe"],
		});
		if (head.status !== 0 || tag.status !== 0) {
			throw new Error(`Could not resolve HEAD or ${expectedRef}; refusing to publish an unbound candidate`);
		}
		if (head.stdout.trim() !== tag.stdout.trim()) {
			throw new Error(`HEAD (${head.stdout.trim().slice(0, 12)}) does not match ${expectedRef} (${tag.stdout.trim().slice(0, 12)}); refusing to publish`);
		}
	}
}
const unknownArgs = process.argv.slice(2).filter(
	(arg) => arg !== "--dry-run" && arg !== "--no-provenance" && arg !== "--provenance",
);

if (isMain && unknownArgs.length > 0) {
	console.error(`Usage: node scripts/publish.mjs [--dry-run] [--no-provenance|--provenance]`);
	process.exit(1);
}

function commandForPlatform(command) {
	return process.platform === "win32" ? `${command}.cmd` : command;
}

function run(command, args, options = {}) {
	console.log(`$ ${[command, ...args].join(" ")}`);
	const result = spawnSync(commandForPlatform(command), args, {
		cwd: options.cwd,
		encoding: "utf8",
		stdio: options.capture ? ["inherit", "pipe", "pipe"] : "inherit",
	});

	if (result.status !== 0) {
		const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
		throw new Error(output ? `Command failed: ${command} ${args.join(" ")}\n${output}` : `Command failed: ${command} ${args.join(" ")}`);
	}

	return result;
}

function readPackageJson(directory) {
	return JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
}

function assertBuildOutputExists(directory) {
	if (!existsSync(join(directory, "dist"))) {
		throw new Error(`${directory}/dist does not exist. Run npm run build before publishing.`);
	}
}

function validatePack(directory) {
	const result = run("npm", ["pack", "--dry-run", "--ignore-scripts", "--json"], { capture: true, cwd: directory });
	const packed = JSON.parse(result.stdout)[0];
	console.log(`  ${packed.filename}: ${packed.files.length} files, ${packed.size} bytes packed, ${packed.unpackedSize} bytes unpacked`);
}

function isPublished(name, version) {
	const result = spawnSync(commandForPlatform("npm"), ["view", `${name}@${version}`, "version", "--json"], {
		encoding: "utf8",
		stdio: ["inherit", "pipe", "pipe"],
	});

	if (result.status === 0 && result.stdout.trim()) {
		return true;
	}

	const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
	if (result.status !== 0 && (output.includes("E404") || output.includes("404 Not Found"))) {
		return false;
	}

	throw new Error(output ? `Failed to query ${name}@${version}\n${output}` : `Failed to query ${name}@${version}`);
}

// Main flow (only when invoked directly; importers get the exported helpers)
if (isMain) {
	assertPublishCandidate();
	const packageVersions = new Map();
	for (const pkg of packages) {
		const packageJson = readPackageJson(pkg.directory);
		if (packageJson.name !== pkg.name) {
			throw new Error(`${pkg.directory}/package.json has name ${packageJson.name}, expected ${pkg.name}`);
		}
		packageVersions.set(pkg.name, packageJson.version);
	}

	const versions = [...new Set(packageVersions.values())];
	if (versions.length !== 1) {
		throw new Error(`Publish packages are not lockstep versioned: ${versions.join(", ")}`);
	}

	console.log(
		`Publishing OMK packages at ${versions[0]}${dryRun ? " (dry run)" : ""} (provenance: ${provenance ? "on" : "off — no provenance attestation"})`,
	);
	console.log();

	for (const pkg of packages) {
		const version = packageVersions.get(pkg.name);
		assertBuildOutputExists(pkg.directory);
		const published = isPublished(pkg.name, version);

		if (dryRun) {
			if (published) {
				console.log(`${pkg.name}@${version} is already published; validating package contents only.`);
			} else {
				console.log(`${pkg.name}@${version} is not published; validating package contents before publish.`);
			}
			validatePack(pkg.directory);
			console.log();
			continue;
		}

		if (published) {
			console.log(`Skipping ${pkg.name}@${version}: already published\n`);
			continue;
		}

		const publishArgs = ["publish", "--access", "public"];
		if (provenance) {
			publishArgs.push("--provenance");
		}
		publishArgs.push("--ignore-scripts");
		run("npm", publishArgs, { cwd: pkg.directory });
		console.log();
	}
}
