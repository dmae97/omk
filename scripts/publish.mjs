#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const internalPackageNames = [
	"@earendil-works/omk-ai",
	"@earendil-works/omk-tui",
	"@earendil-works/omk-agent-core",
];

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

const codingAgentPackageJson = readPackageJson("packages/coding-agent");
const codingAgentDeps = codingAgentPackageJson.dependencies ?? {};
const usesPublishedInternalAliases = internalPackageNames.every((name) =>
	String(codingAgentDeps[name] ?? "").startsWith("npm:@earendil-works/pi-"),
);
const publishPackages = usesPublishedInternalAliases
	? packages.filter((pkg) => pkg.name === "open-multi-agent-kit")
	: packages;

console.log(`Publishing OMK packages at ${versions[0]}${dryRun ? " (dry run)" : ""}`);
if (usesPublishedInternalAliases) {
	console.log("Skipping OMK-scoped internal package publish because open-multi-agent-kit uses published pi package aliases.");
}
console.log();

for (const pkg of publishPackages) {
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
	if (!noProvenance) {
		publishArgs.push("--provenance");
	}
	publishArgs.push("--ignore-scripts");
	run("npm", publishArgs, { cwd: pkg.directory });
	console.log();
}
