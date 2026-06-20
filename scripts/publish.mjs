#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const packages = [
	{ directory: "packages/ai", name: "@earendil-works/omk-ai" },
	{ directory: "packages/tui", name: "@earendil-works/omk-tui" },
	{ directory: "packages/agent", name: "@earendil-works/omk-agent-core" },
	{ directory: "packages/coding-agent", name: "open-multi-agent-kit" },
];

const dryRun = process.argv.includes("--dry-run");
const noProvenance = process.argv.includes("--no-provenance");
const unknownArgs = process.argv.slice(2).filter(
	(arg) => arg !== "--dry-run" && arg !== "--no-provenance",
);

if (unknownArgs.length > 0) {
	console.error(`Usage: node scripts/publish.mjs [--dry-run] [--no-provenance]`);
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
		env: options.env,
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

function getPublishAuthMode() {
	if (process.env.GITHUB_ACTIONS !== "true") return "local";
	const hasOidc = !!process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
	const hasToken = !!process.env.NPM_TOKEN;
	if (hasOidc && hasToken) return "hybrid";
	if (hasOidc) return "oidc";
	if (hasToken) return "npm-token";
	return "missing";
}

function getPublishEnv() {
	// Do not strip env. The workflow writes ~/.npmrc with NPM_TOKEN when
	// available, so npm authenticates via that .npmrc; the OIDC token is still
	// used for the --provenance attestation when present. Earlier revisions
	// stripped NODE_AUTH_TOKEN/NPM_TOKEN/NPM_CONFIG_USERCONFIG to force the OIDC
	// trusted-publishing path, but trusted publishing only works when a binding
	// exists on npmjs.com — when it does not, that strip turned a recoverable
	// NPM_TOKEN publish into a hard ENEEDAUTH/404 "package not found".
	return { ...process.env };
}

function preflightAccessCheck() {
	const mode = getPublishAuthMode();
	console.log(`Publish auth mode: ${mode}`);
	if (mode === "missing") {
		throw new Error(
			"npm publish prerequisites missing in CI:\n" +
				"  - ACTIONS_ID_TOKEN_REQUEST_TOKEN is empty (OIDC trusted publishing unavailable)\n" +
				"  - NPM_TOKEN secret is not set (classic auth unavailable)\n" +
				"Fix one of:\n" +
				"  1. Configure a trusted publisher on npmjs.com at\n" +
				"     https://www.npmjs.com/settings/<npm-user>/trusted-publishers\n" +
				"     binding package + repo owner + repo name + workflow file + environment name.\n" +
				"  2. Add an NPM_TOKEN automation token as a secret on the 'npm-publish'\n" +
				"     GitHub Actions environment.",
		);
	}
	if (mode === "npm-token") {
		console.warn(
			"OIDC token absent; authenticating with NPM_TOKEN only. Provenance attestation will be skipped (requires OIDC).",
		);
	} else if (mode === "hybrid") {
		console.log(
			"Hybrid auth: NPM_TOKEN authenticates the publish, OIDC token signs the provenance attestation.",
		);
	}
	const whoami = spawnSync(
		commandForPlatform("npm"),
		["whoami", "--registry=https://registry.npmjs.org/"],
		{ encoding: "utf8", env: getPublishEnv() },
	);
	if (whoami.status === 0 && whoami.stdout.trim()) {
		console.log(`Authenticated npm user: ${whoami.stdout.trim()}`);
		return;
	}
	const output = [whoami.stdout, whoami.stderr]
		.filter(Boolean)
		.join("\n")
		.trim();
	if (mode === "oidc") {
		// Pure-OIDC path: whoami has no token to exchange (the exchange happens
		// inside npm publish), so ENEEDAUTH is expected. Warn so verbose logs are
		// still visible if publish itself fails because no trusted publisher
		// binding exists for the package.
		console.log(
			`Preflight whoami unauthenticated (expected under OIDC): ${output || "(no output)"}`,
		);
		return;
	}
	// hybrid / npm-token: ~/.npmrc should already be configured by the workflow.
	// If whoami still fails, the .npmrc is broken or the token lacks publish
	// rights — surface that immediately instead of letting npm publish emit a
	// confusing ENEEDAUTH downstream.
	throw new Error(
		`npm whoami failed under ${mode} auth (cannot publish):\n${output || "(no output from npm)"}`,
	);
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

console.log(`Publishing OMK packages at ${versions[0]}${dryRun ? " (dry run)" : ""}`);
console.log();

if (!dryRun) {
	preflightAccessCheck();
	console.log();
}

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
	// --provenance only requires an OIDC token (id-token: write) and the
	// Sigstore attestation endpoint; it does NOT require a trusted publisher
	// binding. So enable it whenever an OIDC token is present, regardless of
	// whether NPM_TOKEN or OIDC is the actual auth path for the publish itself.
	const useProvenance =
		!noProvenance && !!process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
	if (useProvenance) {
		publishArgs.push("--provenance");
	}
	publishArgs.push("--ignore-scripts");
	run("npm", publishArgs, { cwd: pkg.directory, env: getPublishEnv() });
	console.log();
}
