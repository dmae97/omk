import { chmodSync, lstatSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { RunPhaseBudget } from "omk-protocol";
import {
	assertDirectory,
	digestBytes,
	digestObject,
	publishBytes,
	publishObject,
	readJson,
	readRegularFile,
	VerifiedRunError,
} from "./storage.ts";

export interface CandidateFile {
	readonly path: string;
	readonly mode: number;
	readonly digest: string;
	readonly size: number;
}
export interface CandidateManifest {
	readonly version: 1;
	readonly directories: readonly string[];
	readonly files: readonly CandidateFile[];
}
export interface CandidateSnapshot {
	readonly manifest: CandidateManifest;
	readonly digest: string;
	readonly contents: ReadonlyMap<string, Buffer>;
}

function safePath(path: string): void {
	if (
		!path ||
		/[\\\u0000-\u001f\u007f]/.test(path) ||
		path.split("/").some((part) => ["", ".", "..", ".git", ".omk"].includes(part))
	) {
		throw new VerifiedRunError("file_type");
	}
}

/** Names that must not enter a verified candidate. This is a deny list, not a secret scan. */
const SECRET_FILE_NAMES = new Set([
	".env",
	".env.local",
	".env.production",
	".env.development",
	".npmrc",
	".netrc",
	".pypirc",
	"credentials.json",
	"id_rsa",
	"id_ed25519",
]);

function assertPublishablePath(path: string): void {
	const name = path.slice(path.lastIndexOf("/") + 1);
	if (SECRET_FILE_NAMES.has(name) || name.endsWith(".pem") || name.endsWith(".key"))
		throw new VerifiedRunError("secret_path");
}

/** Entire regular-file tree, including dot/untracked files; .git/.omk metadata is excluded by this profile. */
export function captureCandidate(root: string, limits: RunPhaseBudget): CandidateSnapshot {
	assertDirectory(root);
	const files: CandidateFile[] = [];
	const directories: string[] = [];
	const contents = new Map<string, Buffer>();
	let bytesUsed = 0;
	const visit = (prefix: string): void => {
		const names = readdirSync(join(root, prefix), { encoding: "buffer" })
			.map((name) => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(name))
			.sort();
		for (const name of names) {
			if (!prefix && (name === ".git" || name === ".omk")) continue;
			const path = prefix ? `${prefix}/${name}` : name;
			safePath(path);
			assertPublishablePath(path);
			if (files.length + directories.length >= limits.maxFiles) throw new VerifiedRunError("storage_limit");
			const absolute = join(root, path);
			const stat = lstatSync(absolute);
			if (stat.isDirectory()) {
				if ((stat.mode & 0o7777) !== 0o755) throw new VerifiedRunError("file_type");
				directories.push(path);
				visit(path);
				continue;
			}
			if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o7000) !== 0) throw new VerifiedRunError("file_type");
			const bytes = readRegularFile(absolute, limits.maxBytes - bytesUsed);
			bytesUsed += bytes.length;
			const digest = digestBytes(bytes);
			contents.set(digest, bytes);
			files.push(Object.freeze({ path, mode: stat.mode & 0o777, digest, size: bytes.length }));
		}
	};
	visit("");
	const manifest: CandidateManifest = Object.freeze({
		version: 1,
		directories: Object.freeze(directories),
		files: Object.freeze(files),
	});
	return { manifest, digest: digestObject(manifest), contents };
}

export function materializeCandidate(snapshot: CandidateSnapshot, target: string): void {
	mkdirSync(target, { mode: 0o700 });
	for (const directory of snapshot.manifest.directories) mkdirSync(join(target, directory), { mode: 0o755 });
	for (const file of snapshot.manifest.files) {
		const bytes = snapshot.contents.get(file.digest);
		if (!bytes) throw new VerifiedRunError("integrity");
		publishBytes(join(target, file.path), bytes);
		chmodSync(join(target, file.path), file.mode);
	}
}

export function assertCandidateScope(
	base: CandidateManifest,
	candidate: CandidateManifest,
	writable: readonly string[],
): void {
	const before = new Map(base.files.map((file) => [file.path, digestObject(file)]));
	const after = new Map(candidate.files.map((file) => [file.path, digestObject(file)]));
	for (const directory of base.directories) before.set(`${directory}/`, "directory");
	for (const directory of candidate.directories) after.set(`${directory}/`, "directory");
	for (const path of new Set([...before.keys(), ...after.keys()])) {
		if (before.get(path) === after.get(path)) continue;
		const normalized = path.endsWith("/") ? path.slice(0, -1) : path;
		if (!writable.some((scope) => normalized === scope || normalized.startsWith(`${scope}/`)))
			throw new VerifiedRunError("scope_changed");
	}
}

export function storeCandidate(snapshot: CandidateSnapshot, runPath: string): void {
	for (const [digest, bytes] of snapshot.contents) publishBytes(join(runPath, "blobs", digest), bytes);
	publishObject(join(runPath, "candidates", `${snapshot.digest}.json`), snapshot.manifest);
}

export function loadCandidate(runPath: string, digest: string, limits: RunPhaseBudget): CandidateSnapshot {
	if (!/^[a-f0-9]{64}$/.test(digest)) throw new VerifiedRunError("integrity");
	const raw = readJson(join(runPath, "candidates", `${digest}.json`), 4194304);
	if (
		digestObject(raw) !== digest ||
		typeof raw !== "object" ||
		raw === null ||
		!("version" in raw) ||
		raw.version !== 1 ||
		!("files" in raw) ||
		!Array.isArray(raw.files) ||
		!("directories" in raw) ||
		!Array.isArray(raw.directories)
	) {
		throw new VerifiedRunError("integrity");
	}
	if (raw.files.length + raw.directories.length > limits.maxFiles) throw new VerifiedRunError("integrity");
	const files: CandidateFile[] = [];
	const directories: string[] = [];
	const paths = new Set<string>();
	let total = 0;
	for (const directory of raw.directories) {
		if (typeof directory !== "string") throw new VerifiedRunError("integrity");
		safePath(directory);
		if (paths.has(directory)) throw new VerifiedRunError("integrity");
		paths.add(directory);
		directories.push(directory);
	}
	const contents = new Map<string, Buffer>();
	const rawFiles: readonly unknown[] = raw.files;
	for (const file of rawFiles) {
		if (
			typeof file !== "object" ||
			file === null ||
			!("path" in file) ||
			typeof file.path !== "string" ||
			!("digest" in file) ||
			typeof file.digest !== "string" ||
			!/^[a-f0-9]{64}$/.test(file.digest) ||
			!("mode" in file) ||
			typeof file.mode !== "number" ||
			!Number.isSafeInteger(file.mode) ||
			file.mode < 0 ||
			file.mode > 0o777 ||
			!("size" in file) ||
			typeof file.size !== "number" ||
			!Number.isSafeInteger(file.size) ||
			file.size < 0
		)
			throw new VerifiedRunError("integrity");
		safePath(file.path);
		if (paths.has(file.path)) throw new VerifiedRunError("integrity");
		paths.add(file.path);
		total += file.size;
		if (total > limits.maxBytes) throw new VerifiedRunError("integrity");
		let bytes: Buffer;
		try {
			bytes = readRegularFile(join(runPath, "blobs", file.digest), file.size);
		} catch (error) {
			if (error instanceof Error) throw new VerifiedRunError("integrity");
			throw error;
		}
		if (bytes.length !== file.size || digestBytes(bytes) !== file.digest) throw new VerifiedRunError("integrity");
		contents.set(file.digest, bytes);
		files.push(Object.freeze({ path: file.path, mode: file.mode, digest: file.digest, size: file.size }));
	}
	const manifest: CandidateManifest = Object.freeze({
		version: 1,
		directories: Object.freeze(directories),
		files: Object.freeze(files),
	});
	if (digestObject(manifest) !== digest) throw new VerifiedRunError("integrity");
	return { manifest, digest, contents };
}
