import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { canonicalJson } from "../canonical-json.ts";
import { writeExclusiveFileDurablySync } from "../durable-file-io.ts";

export class VerifiedRunError extends Error {
	readonly code: string;
	constructor(code: string) {
		super(`verified-run: ${code}`);
		this.name = "VerifiedRunError";
		this.code = code;
	}
}

export const digestBytes = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");
export const digestObject = (value: unknown): string => digestBytes(canonicalJson(value));

export function readRegularFile(path: string, maxBytes: number): Buffer {
	const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	try {
		const before = fstatSync(fd, { bigint: true });
		if (!before.isFile() || before.nlink !== 1n) throw new VerifiedRunError("file_type");
		if (before.size > BigInt(maxBytes)) throw new VerifiedRunError("storage_limit");
		const bytes = readFileSync(fd);
		const after = fstatSync(fd, { bigint: true });
		if (before.size !== after.size || before.ctimeNs !== after.ctimeNs || BigInt(bytes.length) !== before.size) {
			throw new VerifiedRunError("integrity");
		}
		return bytes;
	} finally {
		closeSync(fd);
	}
}

export function readJson(path: string, maxBytes = 1048576): unknown {
	try {
		return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readRegularFile(path, maxBytes)));
	} catch (error) {
		if (error instanceof SyntaxError || error instanceof TypeError) throw new VerifiedRunError("integrity");
		throw error;
	}
}

export function publishBytes(path: string, bytes: Uint8Array): void {
	try {
		writeExclusiveFileDurablySync(path, bytes);
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
		if (!readRegularFile(path, bytes.length).equals(Buffer.from(bytes))) throw new VerifiedRunError("integrity");
	}
}

export function publishObject(path: string, value: unknown): string {
	const bytes = Buffer.from(canonicalJson(value));
	publishBytes(path, bytes);
	return digestBytes(bytes);
}

/** Resolve existing parents without creating state. State must never be part of a mounted workspace. */
export function stateRunPath(root: string, id: string): string {
	if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) throw new VerifiedRunError("run_id");
	return join(resolve(root), id);
}

export function assertStateOutsideWorkspace(stateRoot: string, workspace: string): void {
	let cursor = resolve(stateRoot);
	const tail: string[] = [];
	while (true) {
		try {
			cursor = join(realpathSync(cursor), ...tail);
			break;
		} catch (error) {
			if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
			tail.unshift(basename(cursor));
			cursor = dirname(cursor);
		}
	}
	const base = realpathSync(workspace);
	const under = relative(base, cursor);
	const contains = relative(cursor, base);
	if (
		under === "" ||
		(!under.startsWith("../") && under !== "..") ||
		contains === "" ||
		(!contains.startsWith("../") && contains !== "..")
	) {
		throw new VerifiedRunError("state_scope");
	}
}

export function assertDirectory(path: string): void {
	if (!lstatSync(path).isDirectory() || realpathSync(path) !== resolve(path)) throw new VerifiedRunError("file_type");
}
