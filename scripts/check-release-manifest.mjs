#!/usr/bin/env node
/**
 * Verify a release manifest and its bundle before an upload or after a download.
 *
 * Usage:
 *   node scripts/check-release-manifest.mjs --bundle packages/coding-agent/binaries
 *   node scripts/check-release-manifest.mjs --bundle /tmp/omk-release --json
 *   node scripts/check-release-manifest.mjs --self-test
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
	CHECKSUM_FILE,
	RELEASE_MANIFEST_FILE,
	validateManifestShape,
	verifyBundle,
} from "./release-manifest.mjs";

function loadManifest(bundleDir, manifestPath) {
	const path = manifestPath ?? join(bundleDir, RELEASE_MANIFEST_FILE);
	if (!existsSync(path)) throw new Error(`manifest does not exist: ${path}`);
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		throw new Error(`manifest is not valid JSON: ${path}`);
	}
}

export function checkReleaseManifest({ bundleDir, manifest, expectedSourceSha, expectedVersion, expectedChannel }) {
	const errors = validateManifestShape(manifest);
	if (expectedSourceSha !== undefined && manifest.sourceSha !== expectedSourceSha) {
		errors.push(`sourceSha mismatch: expected ${expectedSourceSha}, got ${manifest.sourceSha}`);
	}
	if (expectedVersion !== undefined && manifest.version !== expectedVersion) {
		errors.push(`version mismatch: expected ${expectedVersion}, got ${manifest.version}`);
	}
	if (expectedChannel !== undefined && manifest.channel !== expectedChannel) {
		errors.push(`channel mismatch: expected ${expectedChannel}, got ${manifest.channel}`);
	}
	if (bundleDir === undefined) return { ok: errors.length === 0, errors, warnings: [], manifest };
	const verification = verifyBundle(bundleDir, manifest);
	return {
		ok: errors.length === 0 && verification.ok,
		errors: [...errors, ...verification.errors],
		warnings: verification.warnings,
		manifest,
	};
}

function parseArgs(argv) {
	const options = { json: false, selfTest: false };
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--json") options.json = true;
		else if (arg === "--self-test") options.selfTest = true;
		else if (arg === "--bundle") options.bundleDir = resolve(argv[++index]);
		else if (arg === "--manifest") options.manifestPath = resolve(argv[++index]);
		else if (arg === "--expected-source-sha") options.expectedSourceSha = argv[++index];
		else if (arg === "--expected-version") options.expectedVersion = argv[++index];
		else if (arg === "--expected-channel") options.expectedChannel = argv[++index];
		else throw new Error(`unknown argument: ${arg}`);
	}
	if (!options.selfTest && !options.bundleDir && !options.manifestPath) {
		throw new Error("--bundle or --manifest is required");
	}
	return options;
}

function selfTest() {
	const fixture = {
		schemaVersion: 1,
		tag: "v1.5.5",
		version: "1.5.5",
		channel: "stable",
		sourceSha: "741ac1c4734f66b4d6edb1d25e29198e66f26b20",
		builtAt: "2026-10-22T00:00:00.000Z",
		toolchain: { bun: "1.3.10", node: "24.x", os: "linux" },
		checksumFile: CHECKSUM_FILE,
		files: [
			{ name: "omk-linux-x64.tar.gz", sha256: "0".repeat(64), bytes: 1 },
			{ name: "install.sh", sha256: "1".repeat(64), bytes: 1 },
		],
	};
	const errors = validateManifestShape(fixture);
	return { ok: errors.length === 0, errors, warnings: [], manifest: fixture };
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
	try {
		const options = parseArgs(process.argv.slice(2));
		if (options.selfTest) {
			const result = selfTest();
			process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
			if (!result.ok) process.exit(1);
		} else {
			const bundleDir = options.bundleDir;
			const manifest = loadManifest(bundleDir, options.manifestPath);
			const result = checkReleaseManifest({
				bundleDir,
				manifest,
				expectedSourceSha: options.expectedSourceSha,
				expectedVersion: options.expectedVersion,
				expectedChannel: options.expectedChannel,
			});
			process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
			if (!result.ok) process.exit(1);
		}
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
