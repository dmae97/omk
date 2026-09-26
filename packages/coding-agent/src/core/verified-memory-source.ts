import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { detectMcpDescriptorPromptInjection } from "./mcp-descriptor-injection.ts";
import { redactSensitiveTextForced } from "./redaction.ts";

export const MAX_MEMORY_SOURCE_BYTES = 256 * 1024;
export const MAX_MEMORY_QUOTE_BYTES = 2048;
export const MAX_MEMORY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MEMORY_POLICY = "source-quote-v1";
export const MEMORY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const sha256Memory = (text: string | Uint8Array): string => createHash("sha256").update(text).digest("hex");

export function memoryWorkspace(cwd: string): { root: string; id: string } {
	const root = realpathSync(cwd);
	const stat = lstatSync(root);
	if (!stat.isDirectory()) throw new Error("memory workspace unavailable");
	return { root, id: sha256Memory(JSON.stringify([root, stat.dev, stat.ino])) };
}

export function validateMemoryPath(path: string): string[] {
	const parts = path.split("/");
	if (
		path.length === 0 ||
		path.length > 512 ||
		/[\\:\u0000-\u001f\u007f]/u.test(path) ||
		parts.some(
			(part) =>
				!part ||
				part === "." ||
				part === ".." ||
				part.startsWith(".") ||
				/^(?:node_modules|auth\.json|credentials(?:\.json)?|id_rsa|id_ed25519)$/i.test(part),
		)
	)
		throw new Error("memory source path refused");
	return parts;
}

/** Bounded read with no symlink traversal. Same-UID concurrent directory mutation is not sandboxed. */
export function readMemorySourceSnapshot(root: string, path: string) {
	const parts = validateMemoryPath(path);
	let target = root;
	for (const [index, part] of parts.entries()) {
		target = join(target, part);
		const stat = lstatSync(target);
		if (stat.isSymbolicLink() || (index < parts.length - 1 && !stat.isDirectory()))
			throw new Error("memory source symlink refused");
	}
	const fd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	try {
		const before = fstatSync(fd, { bigint: true });
		if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(MAX_MEMORY_SOURCE_BYTES))
			throw new Error("memory source size or type refused");
		const bytes = Buffer.alloc(MAX_MEMORY_SOURCE_BYTES + 1);
		let length = 0;
		while (length < bytes.length) {
			const read = readSync(fd, bytes, length, bytes.length - length, null);
			if (read === 0) break;
			length += read;
		}
		const after = fstatSync(fd, { bigint: true });
		const current = lstatSync(target, { bigint: true });
		if (
			length > MAX_MEMORY_SOURCE_BYTES ||
			before.size !== after.size ||
			before.mtimeNs !== after.mtimeNs ||
			before.ctimeNs !== after.ctimeNs ||
			after.ino !== current.ino ||
			after.dev !== current.dev ||
			after.ctimeNs !== current.ctimeNs
		)
			throw new Error("memory source changed during read");
		const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length));
		if (text.includes("\0")) throw new Error("memory source binary refused");
		if (redactSensitiveTextForced(text) !== text || detectMcpDescriptorPromptInjection(text).patternHits > 0)
			throw new Error("memory source requires review");
		const lines = Object.freeze(text.split("\n"));
		const assertCurrent = (): void => {
			const stat = lstatSync(target, { bigint: true });
			if (
				!stat.isFile() ||
				stat.nlink !== 1n ||
				stat.dev !== after.dev ||
				stat.ino !== after.ino ||
				stat.ctimeNs !== after.ctimeNs ||
				stat.mtimeNs !== after.mtimeNs ||
				stat.size !== after.size
			)
				throw new Error("memory source changed during recall");
		};
		return Object.freeze({ lines, contentHash: sha256Memory(bytes.subarray(0, length)), assertCurrent });
	} finally {
		closeSync(fd);
	}
}

function validateMemoryRange(startLine: number, endLine: number): void {
	if (
		!Number.isSafeInteger(startLine) ||
		!Number.isSafeInteger(endLine) ||
		startLine < 1 ||
		endLine < startLine ||
		endLine - startLine >= 16
	)
		throw new Error("memory source range refused");
}

export type MemorySourceSnapshot = ReturnType<typeof readMemorySourceSnapshot>;
function quoteFromSnapshot(source: MemorySourceSnapshot, startLine: number, endLine: number) {
	validateMemoryRange(startLine, endLine);
	source.assertCurrent();
	if (endLine > source.lines.length) throw new Error("memory source range refused");
	const quote = source.lines.slice(startLine - 1, endLine).join("\n");
	if (!quote.trim() || Buffer.byteLength(quote) > MAX_MEMORY_QUOTE_BYTES) throw new Error("memory quote size refused");
	return { quote, contentHash: source.contentHash };
}
export function readMemorySource(root: string, path: string, startLine: number, endLine: number) {
	validateMemoryRange(startLine, endLine);
	return quoteFromSnapshot(readMemorySourceSnapshot(root, path), startLine, endLine);
}

/** At most eight source snapshots; never retain this reader across retrieve() calls. */
export function createMemorySourceBatch(
	root: string,
): (path: string, startLine: number, endLine: number) => ReturnType<typeof readMemorySource> {
	const cache = new Map<string, MemorySourceSnapshot | null>();
	return (path, startLine, endLine) => {
		validateMemoryRange(startLine, endLine);
		let source = cache.get(path);
		if (source === null) throw new Error("memory source unavailable in recall");
		if (source === undefined) {
			try {
				source = readMemorySourceSnapshot(root, path);
			} catch (error) {
				if (cache.size < 8) cache.set(path, null);
				throw error;
			}
			if (cache.size < 8) cache.set(path, source);
		}
		return quoteFromSnapshot(source, startLine, endLine);
	};
}
