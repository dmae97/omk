#!/usr/bin/env node
/**
 * Reconcile a GitHub Release with a verified local release bundle.
 *
 * Default is a dry run. `--apply` creates a missing Release or uploads only the
 * missing assets. Existing assets are never overwritten: a same-name asset with
 * a different digest is a conflict and stops the run.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
	RELEASE_MANIFEST_FILE,
	sha256File,
	validateManifestShape,
	verifyBundle,
} from "./release-manifest.mjs";
import {
	classifyReleaseAssets,
	localAssetsFromManifest,
	planReleaseReconciliation,
	RELEASE_ASSET_STATE,
	summarizeState,
} from "./release-asset-state.mjs";

export function normalizeRemoteAssets(assets) {
	return (assets ?? []).map((asset) => {
		const digest = typeof asset.digest === "string" ? asset.digest : "";
		return {
			name: String(asset.name ?? ""),
			sha256: digest.startsWith("sha256:") ? digest.slice("sha256:".length) : undefined,
			size: Number.isSafeInteger(asset.size) ? asset.size : undefined,
		};
	});
}

export function buildCreateArgs({ tag, notesFile, prerelease, files }) {
	const args = ["release", "create", tag, "--title", tag, "--notes-file", notesFile];
	if (prerelease) args.push("--prerelease");
	args.push(...files);
	return args;
}

export function buildUploadArgs({ tag, files }) {
	return ["release", "upload", tag, ...files];
}

export function parseArgs(argv) {
	const options = {
		apply: false,
		json: false,
		verifyDownloads: false,
	};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--apply") options.apply = true;
		else if (arg === "--dry-run") options.apply = false;
		else if (arg === "--json") options.json = true;
		else if (arg === "--verify-downloads") options.verifyDownloads = true;
		else if (arg === "--prerelease") options.prerelease = true;
		else if (arg === "--tag") options.tag = argv[++index];
		else if (arg === "--bundle") options.bundle = argv[++index];
		else if (arg === "--repo") options.repo = argv[++index];
		else if (arg === "--notes-file") options.notesFile = argv[++index];
		else throw new Error(`unknown argument: ${arg}`);
	}
	if (!options.tag) throw new Error("--tag is required");
	if (!options.bundle) throw new Error("--bundle is required");
	return options;
}

function runGh(args, { repo, capture = true } = {}) {
	const result = spawnSync("gh", repo ? [...args, "--repo", repo] : args, {
		encoding: "utf8",
		stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
	});
	if (result.status !== 0) {
		const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
		const error = new Error(output || `gh ${args.join(" ")} failed`);
		error.status = result.status;
		throw error;
	}
	return result.stdout;
}

function parseJson(text, label) {
	try {
		return JSON.parse(text);
	} catch {
		throw new Error(`${label} returned invalid JSON`);
	}
}

function fetchRelease(tag, repo) {
	const result = spawnSync(
		"gh",
		["release", "view", tag, "--json", "assets,isPrerelease,tagName,targetCommitish", ...(repo ? ["--repo", repo] : [])],
		{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
	);
	if (result.status !== 0) {
		const output = `${result.stdout}\n${result.stderr}`;
		if (/release not found|not found/i.test(output)) return { exists: false, assets: [], isPrerelease: false };
		throw new Error(output.trim() || `failed to inspect release ${tag}`);
	}
	const parsed = parseJson(result.stdout, `gh release view ${tag}`);
	return {
		exists: true,
		assets: normalizeRemoteAssets(parsed.assets),
		isPrerelease: Boolean(parsed.isPrerelease),
		tagName: parsed.tagName,
	};
}

function resolveMissingDigests({ tag, repo, assets, verifyDownloads, expectedNames }) {
	if (!verifyDownloads) return assets;
	const expected = new Set(expectedNames ?? assets.map((asset) => asset.name));
	const directory = mkdtempSync(join(tmpdir(), "omk-release-digest-"));
	try {
		return assets.map((asset) => {
			if (asset.sha256 !== undefined || !expected.has(asset.name)) return asset;
			runGh(["release", "download", tag, "--pattern", asset.name, "--dir", directory], { repo });
			const path = join(directory, asset.name);
			return existsSync(path) ? { ...asset, sha256: sha256File(path) } : asset;
		});
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

function requireNotesFile(options) {
	const notesFile = options.notesFile ?? join(resolve(options.bundle), "release-notes.md");
	if (!existsSync(notesFile)) throw new Error(`release notes file is missing: ${notesFile}`);
	return notesFile;
}

function applyPlan(options, plan) {
	const bundle = resolve(options.bundle);
	const files = plan.uploadNames.map((name) => join(bundle, name));
	const repoArgs = { repo: options.repo };
	if (plan.action === "create") {
		const prerelease = options.prerelease ?? /-(?:alpha|beta|rc)\./i.test(options.tag);
		runGh(buildCreateArgs({ tag: options.tag, notesFile: requireNotesFile(options), prerelease, files }), repoArgs);
		return;
	}
	if (plan.action === "upload") {
		runGh(buildUploadArgs({ tag: options.tag, files }), repoArgs);
	}
}

function reconcile(options) {
	const bundle = resolve(options.bundle);
	const manifestPath = join(bundle, RELEASE_MANIFEST_FILE);
	if (!existsSync(manifestPath)) throw new Error(`missing ${RELEASE_MANIFEST_FILE} in ${bundle}`);
	const manifest = parseJson(readFileSync(manifestPath, "utf8"), RELEASE_MANIFEST_FILE);
	const shapeErrors = validateManifestShape(manifest);
	if (shapeErrors.length > 0) throw new Error(`invalid release manifest: ${shapeErrors.join("; ")}`);
	if (manifest.tag !== options.tag) throw new Error(`manifest tag ${manifest.tag} does not match --tag ${options.tag}`);
	const verification = verifyBundle(bundle, manifest);
	if (!verification.ok) throw new Error(`bundle verification failed: ${verification.errors.join("; ")}`);
	const localAssets = localAssetsFromManifest(bundle, manifest);
	const release = fetchRelease(options.tag, options.repo);
	const tagIsPrerelease = /-(?:alpha|beta|rc)\./i.test(options.tag);
	if (release.exists && release.isPrerelease && !tagIsPrerelease) {
		throw new Error(`release ${options.tag} is marked prerelease but the tag has no prerelease suffix`);
	}
	const expectedNames = localAssets.map((asset) => asset.name);
	const assets = resolveMissingDigests({
		tag: options.tag,
		repo: options.repo,
		assets: release.assets,
		verifyDownloads: options.verifyDownloads,
		expectedNames,
	});
	const state = classifyReleaseAssets({
		releaseExists: release.exists,
		localAssets,
		remoteAssets: assets,
	});
	const plan = planReleaseReconciliation(state);
	const result = {
		ok: plan.errors.length === 0 && (plan.action !== "abort"),
		tag: options.tag,
		applied: false,
		state: summarizeState(state),
		plan,
		remote: { exists: release.exists, isPrerelease: release.isPrerelease },
	};
	if (!options.apply || plan.action === "none") return result;
	if (plan.action === "abort") throw new Error(`cannot reconcile: ${plan.errors.join("; ")}`);
	applyPlan(options, plan);
	const afterRelease = fetchRelease(options.tag, options.repo);
	const afterAssets = resolveMissingDigests({
		tag: options.tag,
		repo: options.repo,
		assets: afterRelease.assets,
		verifyDownloads: options.verifyDownloads,
		expectedNames,
	});
	const afterState = classifyReleaseAssets({
		releaseExists: afterRelease.exists,
		localAssets,
		remoteAssets: afterAssets,
	});
	const afterPlan = planReleaseReconciliation(afterState);
	if (afterState.state !== RELEASE_ASSET_STATE.COMPLETE) {
		throw new Error(`post-upload verification failed: ${afterState.state} ${afterPlan.errors.join("; ")}`);
	}
	return { ...result, applied: true, after: summarizeState(afterState) };
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
	try {
		const options = parseArgs(process.argv.slice(2));
		const result = reconcile(options);
		process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
		if (!result.ok) process.exit(1);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
