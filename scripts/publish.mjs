#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { verifyArtifactReleaseGate } from "./lib/release-artifact-gate.mjs";
export { verifyArtifactReleaseGate };
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

/** An existing version is reusable only when the registry artifact is this exact candidate. */
export function decideExistingPublication(local, registry) {
	if (!registry?.integrity || !local?.integrity) return "unverifiable";
	if (registry.integrity !== local.integrity) return "conflict";
	if (registry.gitHead && local.gitHead && registry.gitHead !== local.gitHead) return "conflict";
	return "reuse";
}

/** Every lockstep package must resolve `latest` to the release version before release completion. */
export function latestMismatches(version, latestByName) {
	return Object.entries(latestByName).filter(([, latest]) => latest !== version).map(([name]) => name);
}

/** npm can take minutes to expose a fresh publish (404 or the old `latest`); poll a bounded number of times before failing. */
export async function waitForLatest(version, names, readLatest, { attempts = 30, delayMs = 30_000, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
	let mismatched = names;
	for (let attempt = 1; ; attempt++) {
		mismatched = latestMismatches(version, Object.fromEntries(mismatched.map((name) => [name, readLatest(name)])));
		if (mismatched.length === 0 || attempt >= attempts) return mismatched;
		console.log(`npm latest is not ${version} yet for: ${mismatched.join(", ")}; retry ${attempt}/${attempts - 1} in ${delayMs / 1000}s`);
		await sleep(delayMs);
	}
}

const REGISTRY = "https://registry.npmjs.org";
const TOKEN_HELP =
	'Create a granular access token with "Bypass two-factor authentication (2FA)" checked and read-write access to all eight packages, then set it as the npm-publish environment secret NPM_TOKEN.';

/**
 * Why the registry would refuse `npm publish` with this token, or null. The token listing masks each
 * token as its first 8 and last 4 characters; publishing without an OTP needs bypass_2fa (granular)
 * or an automation token (classic). Messages name the token, never its value.
 */
export function tokenPublishBlocker(token, listing) {
	const matches = (listing?.objects ?? []).filter(
		(entry) => entry.token === `${token.slice(0, 8)}...${token.slice(-4)}`,
	);
	if (matches.length === 0) return `NODE_AUTH_TOKEN is not in the account's npm token list. ${TOKEN_HELP}`;
	if (matches.length > 1) return `${matches.length} tokens share NODE_AUTH_TOKEN's masked form; cannot tell which one is in use.`;
	const [entry] = matches;
	if (entry.bypass_2fa === true || entry.automation === true) return null;
	return `npm token "${entry.name ?? "unnamed"}" cannot publish without a one-time password (bypass_2fa is false). ${TOKEN_HELP}`;
}

/** Fail before the first publish instead of on it (E404 for a dead token, E403/EOTP without 2FA bypass). */
export async function assertPublishToken(env = process.env, fetchJson = fetchRegistryJson) {
	const token = env.NODE_AUTH_TOKEN;
	if (!token) return "skipped";
	const headers = { authorization: `Bearer ${token}` };
	const objects = [];
	let next = "/-/npm/v1/tokens?perPage=100";
	for (let page = 0; next && page < 20; page++) {
		const { status, body } = await fetchJson(`${REGISTRY}${next}`, headers);
		if (status !== 200) throw new Error(`npm registry rejected NODE_AUTH_TOKEN (HTTP ${status}). ${TOKEN_HELP}`);
		objects.push(...(body?.objects ?? []));
		const listing = { objects };
		if (tokenPublishBlocker(token, listing) === null) return "ok";
		next = body?.urls?.next;
	}
	const blocker = tokenPublishBlocker(token, { objects });
	if (blocker) throw new Error(blocker);
	return "ok";
}

async function fetchRegistryJson(url, headers) {
	const response = await fetch(url, { headers: { ...headers, accept: "application/json" } });
	return { status: response.status, body: response.ok ? await response.json() : null };
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
	{ directory: "packages/speak-like-you-eat", name: "omk-speak-like-you-eat" },
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
	let packed;
	try {
		packed = JSON.parse(result.stdout)[0];
	} catch (error) {
		throw new Error(`npm pack returned invalid JSON for ${directory}`, { cause: error });
	}
	console.log(`  ${packed.filename}: ${packed.files.length} files, ${packed.size} bytes packed, ${packed.unpackedSize} bytes unpacked`);
	return packed;
}

function registryJson(args) {
	const output = run("npm", ["view", ...args, "--json"], { capture: true }).stdout || "null";
	try {
		return JSON.parse(output);
	} catch (error) {
		throw new Error(`npm view returned invalid JSON for ${args.join(" ")}`, { cause: error });
	}
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

	let tokenChecked = false;
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
			const local = { integrity: validatePack(pkg.directory).integrity, gitHead: run("git", ["rev-parse", "HEAD"], { capture: true }).stdout.trim() };
			const registry = { integrity: registryJson([`${pkg.name}@${version}`, "dist.integrity"]), gitHead: registryJson([`${pkg.name}@${version}`, "gitHead"]) };
			const decision = decideExistingPublication(local, registry);
			if (decision !== "reuse") throw new Error(`${pkg.name}@${version} already exists with ${decision} identity; refusing to treat it as this candidate`);
			console.log(`Reusing ${pkg.name}@${version}: registry identity matches this candidate\n`);
			continue;
		}

		// Only before a real publish: a rerun that reuses every package needs no publish rights.
		if (!tokenChecked) {
			await assertPublishToken();
			tokenChecked = true;
		}
		const publishArgs = ["publish", "--access", "public"];
		if (provenance) {
			publishArgs.push("--provenance");
		}
		publishArgs.push("--ignore-scripts");
		run("npm", publishArgs, { cwd: pkg.directory });
		console.log();
	}
	if (!dryRun) {
		const readLatest = (name) => {
			try {
				return registryJson([name, "dist-tags.latest"]);
			} catch (error) {
				// A first-ever publish 404s until the registry catches up; other failures stay fatal.
				if (String(error?.message).includes("E404")) return null;
				throw error;
			}
		};
		const mismatched = await waitForLatest(versions[0], packages.map((pkg) => pkg.name), readLatest);
		if (mismatched.length > 0) throw new Error(`npm latest does not match ${versions[0]} for: ${mismatched.join(", ")}`);
	}
}
