#!/usr/bin/env bun
/**
 * Release script for pi-mono
 *
 * Usage:
 *   bun scripts/release.ts <version>   Full release (preflight, version, changelog, commit, push, watch)
 *   bun scripts/release.ts watch       Watch CI for current commit
 *
 * Example: bun scripts/release.ts 3.10.0
 */

import { $, Glob } from "bun";

const changelogGlob = new Glob("packages/*/CHANGELOG.md");
const packageJsonGlob = new Glob("packages/*/package.json");

// =============================================================================
// Shared functions
// =============================================================================

async function watchCI(): Promise<boolean> {
	const commitSha = (await $`git rev-parse HEAD`.text()).trim();
	console.log(`  Commit: ${commitSha.slice(0, 8)}`);

	while (true) {
		const runsOutput = await $`gh run list --commit ${commitSha} --json databaseId,status,conclusion,name`.text();
		const runs: Array<{ databaseId: number; status: string; conclusion: string | null; name: string }> =
			JSON.parse(runsOutput);

		if (runs.length === 0) {
			console.log("  Waiting for CI to start...");
			await Bun.sleep(3000);
			continue;
		}

		const pending = runs.filter((r) => r.status !== "completed");
		const failed = runs.filter((r) => r.status === "completed" && r.conclusion !== "success");
		const passed = runs.filter((r) => r.status === "completed" && r.conclusion === "success");

		console.log(`  ${passed.length} passed, ${pending.length} pending, ${failed.length} failed`);

		if (failed.length > 0) {
			console.error("\nCI failed:");
			for (const r of failed) {
				console.error(`  - ${r.name}: ${r.conclusion}`);
			}
			return false;
		}

		if (pending.length === 0) {
			console.log("  All CI checks passed!\n");
			return true;
		}

		await Bun.sleep(5000);
	}
}

function hasUnreleasedContent(content: string): boolean {
	const unreleasedMatch = content.match(/## \[Unreleased\]\s*\n([\s\S]*?)(?=## \[\d|$)/);
	if (!unreleasedMatch) return false;
	const sectionContent = unreleasedMatch[1].trim();
	return sectionContent.length > 0;
}

function removeEmptyVersionEntries(content: string): string {
	// Remove version entries that have no content (just whitespace until next ## [ or EOF)
	return content.replace(/## \[\d+\.\d+\.\d+\] - \d{4}-\d{2}-\d{2}\s*\n(?=## \[|\s*$)/g, "");
}

async function updateChangelogsForRelease(version: string): Promise<void> {
	const date = new Date().toISOString().split("T")[0];

	for await (const changelog of changelogGlob.scan(".")) {
		let content = await Bun.file(changelog).text();

		if (!content.includes("## [Unreleased]")) {
			console.log(`  Skipping ${changelog}: no [Unreleased] section`);
			continue;
		}

		// Only create version entry if [Unreleased] has content
		if (hasUnreleasedContent(content)) {
			content = content.replace("## [Unreleased]", `## [${version}] - ${date}`);
			content = content.replace(/^(# Changelog\n\n)/, `$1## [Unreleased]\n\n`);
		}

		// Clean up any existing empty version entries
		content = removeEmptyVersionEntries(content);

		await Bun.write(changelog, content);
		console.log(`  Updated ${changelog}`);
	}
}

// =============================================================================
// Subcommands
// =============================================================================

async function cmdWatch(): Promise<void> {
	console.log("\n=== Watching CI ===\n");
	const success = await watchCI();
	process.exit(success ? 0 : 1);
}

function parseVersion(v: string): [number, number, number] {
	const match = v.replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)/);
	if (!match) throw new Error(`Invalid version: ${v}`);
	return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
}

function compareVersions(a: string, b: string): number {
	const [aMajor, aMinor, aPatch] = parseVersion(a);
	const [bMajor, bMinor, bPatch] = parseVersion(b);
	if (aMajor !== bMajor) return aMajor - bMajor;
	if (aMinor !== bMinor) return aMinor - bMinor;
	return aPatch - bPatch;
}

async function cmdRelease(version: string): Promise<void> {
	console.log("\n=== Release Script ===\n");

	// 1. Pre-flight checks
	console.log("Pre-flight checks...");

	const branch = await $`git branch --show-current`.text();
	if (branch.trim() !== "main") {
		console.error(`Error: Must be on main branch (currently on '${branch.trim()}')`);
		process.exit(1);
	}
	console.log("  On main branch");

	const status = await $`git status --porcelain`.text();
	if (status.trim()) {
		console.error("Error: Uncommitted changes detected. Commit or stash first.");
		console.error(status);
		process.exit(1);
	}
	console.log("  Working directory clean");

	const latestTag = (await $`git describe --tags --abbrev=0`.text()).trim();
	if (compareVersions(version, latestTag) <= 0) {
		console.error(`Error: Version ${version} must be greater than latest tag ${latestTag}`);
		process.exit(1);
	}
	console.log(`  Version ${version} > ${latestTag}\n`);

	// 2. Update package versions
	console.log(`Updating package versions to ${version}...`);
	const pkgJsonPaths = await Array.fromAsync(packageJsonGlob.scan("."));
	await $`sd '"version": "[^"]+"' ${`"version": "${version}"`} ${pkgJsonPaths}`;

	// Verify
	console.log("  Verifying versions:");
	for (const pkgPath of pkgJsonPaths) {
		const pkgJson = await Bun.file(pkgPath).json();
		console.log(`    ${pkgJson.name}: ${pkgJson.version}`);
	}
	console.log();

	// 3. Regenerate lockfile
	console.log("Regenerating lockfile...");
	await $`rm -f bun.lock`;
	await $`bun install`;
	console.log();

	// 4. Update changelogs
	console.log("Updating CHANGELOGs...");
	await updateChangelogsForRelease(version);
	console.log();

	// 5. Run checks
	console.log("Running checks...");
	await $`bun run check`;
	console.log();

	// 6. Commit and tag
	console.log("Committing and tagging...");
	await $`git add .`;
	await $`git commit -m ${`chore: bump version to ${version}`}`;
	await $`git tag ${`v${version}`}`;
	console.log();

	// 7. Push
	console.log("Pushing to remote...");
	await $`git push origin main`;
	await $`git push origin ${`v${version}`}`;
	console.log();

	// 8. Watch CI
	console.log("Watching CI...");
	const success = await watchCI();

	if (success) {
		console.log(`=== Released v${version} ===`);
	} else {
		console.log("\nTo retry after fixing:");
		console.log("  git commit --amend --no-edit");
		console.log("  git push origin main --force");
		console.log(`  git tag -f v${version} && git push origin v${version} --force`);
		console.log("  bun scripts/release.ts watch");
		process.exit(1);
	}
}

// =============================================================================
// Main
// =============================================================================

const arg = process.argv[2];

if (!arg) {
	console.error("Usage:");
	console.error("  bun scripts/release.ts <version>   Full release");
	console.error("  bun scripts/release.ts watch       Watch CI for current commit");
	process.exit(1);
}

if (arg === "watch") {
	await cmdWatch();
} else if (/^\d+\.\d+\.\d+/.test(arg)) {
	await cmdRelease(arg);
} else {
	console.error(`Unknown command or invalid version: ${arg}`);
	console.error("Usage:");
	console.error("  bun scripts/release.ts <version>   Full release");
	console.error("  bun scripts/release.ts watch       Watch CI for current commit");
	process.exit(1);
}
