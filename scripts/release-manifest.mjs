#!/usr/bin/env node
/**
 * Build and verify the release manifest for a binary release bundle.
 *
 * The manifest is the authoritative list of payload files (the six platform
 * archives plus install.sh). `SHA256SUMS` covers those payloads and the manifest
 * itself; the manifest deliberately does not cover SHA256SUMS, which would be a
 * digest cycle. `release-notes.md` is a Release body input, not an asset.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const RELEASE_MANIFEST_SCHEMA_VERSION = 1;
export const RELEASE_MANIFEST_FILE = "release-manifest.json";
export const CHECKSUM_FILE = "SHA256SUMS";

const TAG_PATTERN = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;
const SOURCE_SHA_PATTERN = /^[0-9a-f]{40}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const PAYLOAD_PATTERN = /^omk-(?:darwin|linux|windows)-(?:x64|arm64)\.(?:tar\.gz|zip)$/;
const RESERVED_NAMES = new Set([RELEASE_MANIFEST_FILE, CHECKSUM_FILE, "release-notes.md"]);

export function normalizeTag(tag) {
	const value = String(tag ?? "").trim();
	const withPrefix = value.startsWith("v") ? value : `v${value}`;
	const match = TAG_PATTERN.exec(withPrefix);
	if (!match) throw new Error(`invalid release tag: ${JSON.stringify(tag)}`);
	return withPrefix;
}

export function versionFromTag(tag) {
	return TAG_PATTERN.exec(normalizeTag(tag))?.[1] ?? "";
}

export function deriveChannel(version) {
	return String(version).includes("-") ? "next" : "stable";
}

export function sha256File(path) {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function defaultToolchain() {
	return {
		bun: process.env.BUN_VERSION ?? null,
		node: process.version,
		os: process.platform,
	};
}

export function listPayloadFiles(bundleDir) {
	const root = resolve(bundleDir);
	if (!existsSync(root)) throw new Error(`bundle directory does not exist: ${root}`);
	const files = readdirSync(root)
		.filter((name) => PAYLOAD_PATTERN.test(name) || name === "install.sh")
		.sort((left, right) => left.localeCompare(right))
		.map((name) => {
			const path = join(root, name);
			const stat = statSync(path);
			if (!stat.isFile()) throw new Error(`payload is not a file: ${name}`);
			return { name, sha256: sha256File(path), bytes: stat.size };
		});
	if (!files.some((file) => file.name === "install.sh")) {
		throw new Error("bundle is missing install.sh");
	}
	if (!files.some((file) => file.name !== "install.sh")) {
		throw new Error("bundle is missing platform archives");
	}
	return files;
}

export function buildReleaseManifest(options) {
	const bundleDir = resolve(options.bundleDir);
	const tag = normalizeTag(options.tag);
	const version = versionFromTag(tag);
	if (options.version !== undefined && options.version !== version) {
		throw new Error(`version ${JSON.stringify(options.version)} does not match tag ${tag}`);
	}
	const sourceSha = String(options.sourceSha ?? "").trim().toLowerCase();
	if (!SOURCE_SHA_PATTERN.test(sourceSha)) {
		throw new Error("sourceSha must be a 40-character lowercase hexadecimal commit SHA");
	}
	const channel = options.channel ?? deriveChannel(version);
	if (channel !== "stable" && channel !== "next") {
		throw new Error(`channel must be stable or next, got ${JSON.stringify(channel)}`);
	}
	const builtAt = options.builtAt ?? new Date().toISOString();
	if (Number.isNaN(Date.parse(builtAt))) throw new Error(`invalid builtAt: ${JSON.stringify(builtAt)}`);
	return {
		schemaVersion: RELEASE_MANIFEST_SCHEMA_VERSION,
		tag,
		version,
		channel,
		sourceSha,
		builtAt,
		toolchain: options.toolchain ?? defaultToolchain(),
		checksumFile: CHECKSUM_FILE,
		files: listPayloadFiles(bundleDir),
	};
}

export function formatChecksums(files) {
	return `${files
		.slice()
		.sort((left, right) => left.name.localeCompare(right.name))
		.map((file) => `${file.sha256}  ${file.name}`)
		.join("\n")}\n`;
}

export function writeReleaseManifest(bundleDir, manifest) {
	const errors = validateManifestShape(manifest);
	if (errors.length > 0) throw new Error(`invalid manifest: ${errors.join("; ")}`);
	const root = resolve(bundleDir);
	const manifestPath = join(root, RELEASE_MANIFEST_FILE);
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
	const checksumPath = join(root, CHECKSUM_FILE);
	const checksumEntries = [...manifest.files, { name: RELEASE_MANIFEST_FILE, sha256: sha256File(manifestPath) }];
	writeFileSync(checksumPath, formatChecksums(checksumEntries), { mode: 0o644 });
	return { manifestPath, checksumPath };
}

export function validateManifestShape(manifest) {
	const errors = [];
	if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
		return ["manifest must be an object"];
	}
	if (manifest.schemaVersion !== RELEASE_MANIFEST_SCHEMA_VERSION) {
		errors.push(`schemaVersion must be ${RELEASE_MANIFEST_SCHEMA_VERSION}`);
	}
	let tag = "";
	try {
		tag = normalizeTag(manifest.tag);
	} catch {
		errors.push("tag is invalid");
	}
	if (tag !== "" && manifest.version !== versionFromTag(tag)) errors.push("version must match tag");
	if (manifest.channel !== "stable" && manifest.channel !== "next") errors.push("channel must be stable or next");
	if (typeof manifest.sourceSha !== "string" || !SOURCE_SHA_PATTERN.test(manifest.sourceSha)) {
		errors.push("sourceSha must be a 40-character lowercase hexadecimal commit SHA");
	}
	if (typeof manifest.builtAt !== "string" || Number.isNaN(Date.parse(manifest.builtAt))) {
		errors.push("builtAt must be an ISO timestamp");
	}
	if (manifest.toolchain === null || typeof manifest.toolchain !== "object" || Array.isArray(manifest.toolchain)) {
		errors.push("toolchain must be an object");
	}
	if (manifest.checksumFile !== CHECKSUM_FILE) errors.push(`checksumFile must be ${CHECKSUM_FILE}`);
	if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
		errors.push("files must be a non-empty array");
		return errors;
	}
	const seen = new Set();
	for (const [index, file] of manifest.files.entries()) {
		if (file === null || typeof file !== "object" || Array.isArray(file)) {
			errors.push(`files[${index}] must be an object`);
			continue;
		}
		if (typeof file.name !== "string" || file.name.length === 0) {
			errors.push(`files[${index}].name is invalid`);
		} else if (RESERVED_NAMES.has(file.name)) {
			errors.push(`files[${index}].name is reserved: ${file.name}`);
		} else if (file.name !== "install.sh" && !PAYLOAD_PATTERN.test(file.name)) {
			errors.push(`files[${index}].name is not a release payload: ${file.name}`);
		}
		if (seen.has(file.name)) errors.push(`duplicate file name: ${file.name}`);
		seen.add(file.name);
		if (typeof file.sha256 !== "string" || !DIGEST_PATTERN.test(file.sha256)) {
			errors.push(`files[${index}].sha256 is invalid`);
		}
		if (!Number.isSafeInteger(file.bytes) || file.bytes < 0) {
			errors.push(`files[${index}].bytes is invalid`);
		}
	}
	if (!seen.has("install.sh")) errors.push("files must include install.sh");
	if (!manifest.files.some((file) => file.name !== "install.sh")) {
		errors.push("files must include at least one platform archive");
	}
	return errors;
}

export function parseChecksums(text) {
	const entries = [];
	const errors = [];
	for (const [index, line] of text.split("\n").entries()) {
		if (line.trim() === "") continue;
		const match = /^([0-9a-f]{64})  (.+)$/.exec(line);
		if (!match) {
			errors.push(`checksum line ${index + 1} is malformed`);
			continue;
		}
		entries.push({ sha256: match[1], name: match[2] });
	}
	return { entries, errors };
}

export function verifyBundle(bundleDir, manifest) {
	const root = resolve(bundleDir);
	const errors = validateManifestShape(manifest);
	const warnings = [];
	if (errors.length > 0) return { ok: false, errors, warnings, manifest };
	const listed = new Set(manifest.files.map((file) => file.name));
	for (const file of manifest.files) {
		const path = join(root, file.name);
		if (!existsSync(path)) {
			errors.push(`missing payload: ${file.name}`);
			continue;
		}
		const stat = statSync(path);
		if (stat.size !== file.bytes) errors.push(`size mismatch: ${file.name}`);
		if (sha256File(path) !== file.sha256) errors.push(`digest mismatch: ${file.name}`);
	}
	for (const name of readdirSync(root)) {
		if (name === "install.sh" || PAYLOAD_PATTERN.test(name)) {
			if (!listed.has(name)) warnings.push(`unlisted payload: ${name}`);
		}
	}
	const manifestPath = join(root, RELEASE_MANIFEST_FILE);
	const checksumPath = join(root, CHECKSUM_FILE);
	if (!existsSync(manifestPath)) {
		errors.push(`missing ${RELEASE_MANIFEST_FILE}`);
	} else if (readFileSync(manifestPath, "utf8") !== `${JSON.stringify(manifest, null, 2)}\n`) {
		errors.push(`${RELEASE_MANIFEST_FILE} does not match the supplied manifest`);
	}
	if (!existsSync(checksumPath)) {
		errors.push(`missing ${CHECKSUM_FILE}`);
	} else {
		const parsed = parseChecksums(readFileSync(checksumPath, "utf8"));
		errors.push(...parsed.errors);
		const expected = new Map(manifest.files.map((file) => [file.name, file.sha256]));
		if (existsSync(manifestPath)) expected.set(RELEASE_MANIFEST_FILE, sha256File(manifestPath));
		for (const [name, digest] of expected) {
			const entry = parsed.entries.find((candidate) => candidate.name === name);
			if (!entry) errors.push(`checksum missing: ${name}`);
			else if (entry.sha256 !== digest) errors.push(`checksum mismatch: ${name}`);
		}
		const extra = parsed.entries.filter((entry) => !expected.has(entry.name));
		if (extra.length > 0) warnings.push(`checksum lists unmanaged files: ${extra.map((entry) => entry.name).join(", ")}`);
	}
	return { ok: errors.length === 0, errors, warnings, manifest };
}

function parseArgs(argv) {
	const options = { write: false, json: false, check: false };
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--write") options.write = true;
		else if (arg === "--json") options.json = true;
		else if (arg === "--check") options.check = true;
		else if (arg === "--bundle") options.bundleDir = argv[++index];
		else if (arg === "--tag") options.tag = argv[++index];
		else if (arg === "--source-sha") options.sourceSha = argv[++index];
		else if (arg === "--version") options.version = argv[++index];
		else if (arg === "--channel") options.channel = argv[++index];
		else if (arg === "--built-at") options.builtAt = argv[++index];
		else if (arg === "--toolchain") {
			try {
				options.toolchain = JSON.parse(argv[++index]);
			} catch {
				throw new Error("--toolchain must be valid JSON");
			}
		}
		else throw new Error(`unknown argument: ${arg}`);
	}
	if (!options.bundleDir) throw new Error("--bundle is required");
	return options;
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
	try {
		const options = parseArgs(process.argv.slice(2));
		if (options.check) {
			const manifest = JSON.parse(readFileSync(join(resolve(options.bundleDir), RELEASE_MANIFEST_FILE), "utf8"));
			const result = verifyBundle(options.bundleDir, manifest);
			process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
			if (!result.ok) process.exit(1);
		} else {
			const manifest = buildReleaseManifest(options);
			if (options.write) writeReleaseManifest(options.bundleDir, manifest);
			process.stdout.write(`${JSON.stringify({ ok: true, manifest }, null, 2)}\n`);
		}
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
