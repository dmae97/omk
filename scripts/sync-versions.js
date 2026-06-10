#!/usr/bin/env node

/**
 * Syncs all workspace package dependency versions to match their current versions.
 * This ensures lockstep versioning across the monorepo.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const rootPackagePath = join(process.cwd(), "package.json");
const rootLockfilePath = join(process.cwd(), "package-lock.json");
const rootPackage = JSON.parse(readFileSync(rootPackagePath, "utf8"));
const rootLockfile = existsSync(rootLockfilePath) ? JSON.parse(readFileSync(rootLockfilePath, "utf8")) : undefined;
const packagesDir = join(process.cwd(), "packages");
const packageDirs = readdirSync(packagesDir, { withFileTypes: true })
	.filter((dirent) => dirent.isDirectory())
	.map((dirent) => dirent.name);

// Read all package.json files and build version map.
const packages = {};
const versionMap = {};

for (const dir of packageDirs) {
	const pkgPath = join(packagesDir, dir, "package.json");
	try {
		const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
		packages[dir] = { path: pkgPath, data: pkg };
		versionMap[pkg.name] = pkg.version;
	} catch (error) {
		console.error(`Failed to read ${pkgPath}:`, error.message);
	}
}

console.log("Current versions:");
for (const [name, version] of Object.entries(versionMap).sort()) {
	console.log(`  ${name}: ${version}`);
}

// Verify all workspace package versions are the same (lockstep).
const versions = new Set(Object.values(versionMap));
if (versions.size > 1) {
	console.error("\nERROR: Not all packages have the same version!");
	console.error("Expected lockstep versioning. Run one of:");
	console.error("  npm run version:patch");
	console.error("  npm run version:minor");
	console.error("  npm run version:major");
	process.exit(1);
}

const [lockstepVersion] = versions;

if (rootPackage.version !== lockstepVersion) {
	console.log(`\n${rootPackage.name}:`);
	console.log(`  version: ${rootPackage.version} -> ${lockstepVersion}`);
	rootPackage.version = lockstepVersion;
	writeFileSync(rootPackagePath, `${JSON.stringify(rootPackage, null, "\t")}\n`);
}

if (rootLockfile) {
	let lockfileUpdated = false;
	const expectedRoot = { name: rootPackage.name, version: lockstepVersion };
	for (const [label, entry] of [
		["package-lock root", rootLockfile],
		["package-lock packages[\"\"]", rootLockfile.packages?.[""]],
	]) {
		if (!entry) continue;
		if (entry.name !== expectedRoot.name) {
			console.log(`\n${label}:`);
			console.log(`  name: ${entry.name} -> ${expectedRoot.name}`);
			entry.name = expectedRoot.name;
			lockfileUpdated = true;
		}
		if (entry.version !== expectedRoot.version) {
			console.log(`\n${label}:`);
			console.log(`  version: ${entry.version} -> ${expectedRoot.version}`);
			entry.version = expectedRoot.version;
			lockfileUpdated = true;
		}
	}
	if (lockfileUpdated) {
		writeFileSync(rootLockfilePath, `${JSON.stringify(rootLockfile, null, "\t")}\n`);
	}
}

console.log("\nAll packages at same version (lockstep)");

// Update all inter-package dependencies.
let totalUpdates = 0;
for (const pkg of Object.values(packages)) {
	let updated = false;

	// Check dependencies.
	if (pkg.data.dependencies) {
		for (const [depName, currentVersion] of Object.entries(pkg.data.dependencies)) {
			if (versionMap[depName]) {
				const newVersion = `^${versionMap[depName]}`;
				if (currentVersion !== newVersion) {
					console.log(`\n${pkg.data.name}:`);
					console.log(`  ${depName}: ${currentVersion} -> ${newVersion}`);
					pkg.data.dependencies[depName] = newVersion;
					updated = true;
					totalUpdates++;
				}
			}
		}
	}

	// Check devDependencies.
	if (pkg.data.devDependencies) {
		for (const [depName, currentVersion] of Object.entries(pkg.data.devDependencies)) {
			if (versionMap[depName]) {
				const newVersion = `^${versionMap[depName]}`;
				if (currentVersion !== newVersion) {
					console.log(`\n${pkg.data.name}:`);
					console.log(`  ${depName}: ${currentVersion} -> ${newVersion} (devDependencies)`);
					pkg.data.devDependencies[depName] = newVersion;
					updated = true;
					totalUpdates++;
				}
			}
		}
	}

	// Write if updated.
	if (updated) {
		writeFileSync(pkg.path, `${JSON.stringify(pkg.data, null, "\t")}\n`);
	}
}

if (totalUpdates === 0) {
	console.log("\nAll inter-package dependencies already in sync.");
} else {
	console.log(`\nUpdated ${totalUpdates} dependency version(s)`);
}
