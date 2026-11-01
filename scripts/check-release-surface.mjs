#!/usr/bin/env node

// Release-surface guard: the published npm tarballs and binary staging must never
// contain .omk project/local state, paths escaping the package root, or nested
// node_modules inside shipped examples. They must also contain their license
// and selected notices for third-party material shipped by these packages.
//
// Usage: node scripts/check-release-surface.mjs

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packages = [
	"packages/ai",
	"packages/tui",
	"packages/agent",
	"packages/protocol",
	"packages/adaptorch-wpl",
	"packages/coding-agent",
	"packages/book-to-skill",
];

// book-to-skill has its own upstream-derived LICENSE, so it must not be
// replaced with the root license. The other packages ship the root license.
const rootLicensePackages = new Set(packages.filter((pkg) => pkg !== "packages/book-to-skill"));
const additionalNotices = new Map([
	["packages/ai", ["DEVIN-NOTICE"]],
	["packages/coding-agent", ["resources/pstack/LICENSE"]],
	["packages/book-to-skill", ["vendor/book-to-skill/LICENSE.md"]],
]);
const rootLicense = readFileSync(join(repoRoot, "LICENSE"));

const forbidden = [
	{
		name: ".omk project/local state",
		test: (path) => /(^|\/)\.omk(\/|$)/.test(path),
	},
	{
		name: "path escaping package root",
		test: (path) => path.startsWith(".."),
	},
	{
		name: "nested node_modules in shipped examples",
		test: (path) => /^examples\/.*node_modules\//.test(path),
	},
];

const failures = [];

for (const pkg of packages) {
	const result = spawnSync("npm", ["pack", "--dry-run", "--ignore-scripts", "--json"], {
		cwd: join(repoRoot, pkg),
		encoding: "utf8",
		stdio: ["inherit", "pipe", "pipe"],
	});
	if (result.status !== 0) {
		failures.push(`${pkg}: npm pack --dry-run failed\n${result.stderr}`);
		continue;
	}
	// npm lifecycle output (prepare/postinstall logs) can precede the JSON payload
	// on some npm versions; slice from the first JSON array token.
	const jsonStart = result.stdout.indexOf("[{");
	const packed = JSON.parse(jsonStart > 0 ? result.stdout.slice(jsonStart) : result.stdout)[0];
	const packedPaths = new Set(packed.files.map((file) => file.path));
	for (const required of ["LICENSE", ...(additionalNotices.get(pkg) ?? [])]) {
		if (!packedPaths.has(required)) failures.push(`${pkg}: missing license or notice: ${required}`);
	}
	if (rootLicensePackages.has(pkg) && packedPaths.has("LICENSE")) {
		const packageLicense = readFileSync(join(repoRoot, pkg, "LICENSE"));
		if (!packageLicense.equals(rootLicense)) failures.push(`${pkg}: LICENSE differs from the root LICENSE`);
	}
	for (const file of packed.files) {
		for (const rule of forbidden) {
			if (rule.test(file.path)) {
				failures.push(`${pkg}: ${rule.name}: ${file.path}`);
			}
		}
	}
	console.log(`${pkg}: ${packed.files.length} files checked`);
}

if (failures.length > 0) {
	console.error("\nRelease-surface check failed:");
	for (const failure of failures) console.error(`  ${failure}`);
	process.exit(1);
}
console.log("Release surface OK: required license paths and selected notices found; no forbidden paths.");
