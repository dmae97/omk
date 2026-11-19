import { readFileSync } from "node:fs";
import { join } from "node:path";
import { removeNativeFiles, snapshotNativeFiles } from "./native-record-files.ts";
import { nativeWitnessDir, probeWithNativeWitness } from "./native-witness.ts";
import type { NativeRecordGcEntry } from "./run-gc-types.ts";
import { readRustExecutionRecord } from "./rust-host-record.ts";
import { readRegularFile, VerifiedRunError } from "./storage.ts";

const RECORD = /^[a-f0-9]{32}$/;
const MAX_BYTES = 1024;

/** The exact legacy shapes that cannot express a production reconnection authority. */
export function obsoleteNativeRecord(names: readonly string[]): boolean {
	if (names.length === 0 || names.length > 3) return false;
	if (names.some((name) => name.endsWith(".head.tmp"))) return true;
	if (!RECORD.test(names[0]!.slice(0, 32))) return false;
	if (
		names.some(
			(name) => !RECORD.test(name.slice(0, 32)) || !/^[a-f0-9]{32}\.(?:jsonl|gc\.jsonl|head|cancel)$/.test(name),
		)
	)
		return false;
	return (
		names.length === 1 ||
		(names.length === 2 && names.every((name) => name.endsWith(".jsonl") || name.endsWith(".head")))
	);
}

export function collectObsoleteNativeFiles(
	root: string,
	names: readonly string[],
	options: { readonly execute: boolean; readonly olderThanMs: number; readonly obsolete: boolean },
): NativeRecordGcEntry {
	const id = /^\.?([a-f0-9]{32})/.exec(names[0] ?? "")?.[1] ?? names[0] ?? "unknown";
	const base = { requestId: id, runId: null, executionId: null, paths: names.map((name) => `native-exec/${name}`) };
	const keep = (reason: string): NativeRecordGcEntry => ({ ...base, action: "kept", reason, bytes: 0 });
	if (!options.obsolete) return keep("unreferenced");
	const dir = join(root, "native-exec");
	try {
		if (!obsoleteNativeRecord(names)) throw new VerifiedRunError("native_integrity");
		const files = snapshotNativeFiles(dir, names, MAX_BYTES);
		const payload = files.find((file) => file.name.endsWith(".jsonl"));
		if (payload) {
			const text = readRegularFile(join(dir, payload.name), MAX_BYTES).toString("utf8");
			if (text.length !== payload.bytes || text.at(-1) !== "\n") throw new VerifiedRunError("native_incomplete");
			const record = readRustExecutionRecord(
				dir,
				payload.name.slice(0, -6),
				MAX_BYTES,
				payload.name.endsWith(".gc.jsonl"),
			);
			if (!record) throw new VerifiedRunError("missing_record");
			if (record.host.pid === process.pid) throw new VerifiedRunError("native_live");
			try {
				const stat = readFileSync(`/proc/${record.host.pid}/stat`, "utf8");
				const fields = stat
					.slice(stat.lastIndexOf(")") + 2)
					.trim()
					.split(/\s+/);
				if (fields[19] === record.host.ticks && fields[0] !== "Z" && fields[0] !== "X")
					throw new VerifiedRunError("native_live");
			} catch (error) {
				if (error instanceof VerifiedRunError) throw error;
			}
			if (!record.terminal || record.bindingDigest !== null) throw new VerifiedRunError("native_live");
			if (record.identity && probeWithNativeWitness(record.identity, nativeWitnessDir(root)) !== "gone")
				throw new VerifiedRunError("native_live");
		} else if (
			!names.every((name) => name.endsWith(".head") || name.endsWith(".cancel") || name.endsWith(".head.tmp"))
		)
			throw new VerifiedRunError("missing_record");
		// wall-clock: kernel-stamped mtime is the only age signal; negative differences stay recent.
		if (files.some((file) => Date.now() - file.mtimeMs < options.olderThanMs)) return keep("recent");
		if (options.execute) removeNativeFiles(dir, id, files, MAX_BYTES);
		return {
			...base,
			action: options.execute ? "pruned" : "prunable",
			reason: null,
			bytes: files.reduce((sum, file) => sum + file.bytes, 0),
		};
	} catch (error) {
		return keep(error instanceof VerifiedRunError ? error.code : "native_storage");
	}
}
