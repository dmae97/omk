import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SETTLED_EFFECT_STATES } from "../../coordination/types.ts";
import {
	acquireDurableFileLockSync,
	type DurableFileLock,
	DurableFileLockBusyError,
} from "../durable-file-identity.ts";
import { type AuthorityJournalInspection, AuthorityStore, authorityStorePath } from "./authority-store.ts";
import { type JournalSnapshot, readRunJournal } from "./journal.ts";
import {
	assertNativeFiles,
	nativeRecordInventory,
	removeNativeFiles,
	snapshotNativeFiles,
} from "./native-record-files.ts";
import { collectObsoleteNativeFiles } from "./native-record-obsolete.ts";
import { nativeWitnessDir, probeWithNativeWitness } from "./native-witness.ts";
import { readRunClock } from "./recovery-clock.ts";
import type { NativeRecordGcEntry, RunGcOptions } from "./run-gc-types.ts";
import {
	nativeExecutionDir,
	nativeRequestId,
	type RustExecutionRecord,
	readRustExecutionRecord,
} from "./rust-host-record.ts";
import { digestObject, readRegularFile, VerifiedRunError } from "./storage.ts";

export interface NativeRecordGc {
	readonly entries: NativeRecordGcEntry[];
	visit(runPath: string, snapshot: JournalSnapshot, keepReason: string | null): string | null;
	finish(): void;
}

/** A gone namespace does not prove the native record writer has stopped. Check both. */
function hostGone(record: RustExecutionRecord): boolean {
	if (!record.host.bootId) return false;
	if (readRunClock().bootId !== record.host.bootId) return true;
	try {
		const stat = readFileSync(`/proc/${record.host.pid}/stat`, "utf8");
		const fields = stat
			.slice(stat.lastIndexOf(")") + 2)
			.trim()
			.split(/\s+/);
		return fields.length >= 20 && (fields[19] !== record.host.ticks || fields[0] === "Z" || fields[0] === "X");
	} catch (error) {
		return error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ESRCH");
	}
}

/** GC borrows the authority lease without opening/reconciling the store or advancing its epoch. */
export function withNativeRecordGc<T>(root: string, options: RunGcOptions, work: (gc: NativeRecordGc) => T): T {
	const dir = nativeExecutionDir(root);
	let inventory = new Map<string, readonly string[]>();
	let problem: string | null = null;
	let lease: DurableFileLock | undefined;
	let authority: AuthorityJournalInspection | undefined;
	const entries: NativeRecordGcEntry[] = [];
	try {
		if (existsSync(dir)) {
			inventory = nativeRecordInventory(dir);
			if (inventory.size) {
				lease = acquireDurableFileLockSync(authorityStorePath(root), "authority", { timeoutMs: 0 });
				const owned = [...inventory.keys()].filter((id) => /^(?:[a-f0-9]{32}|\.[a-f0-9]{32}\.head\.tmp)$/.test(id));
				if (owned.length && options.obsolete === true) {
					for (const id of owned) {
						const names = inventory.get(id)!;
						entries.push(collectObsoleteNativeFiles(root, names, { ...options, obsolete: true }));
						inventory.delete(id);
					}
				}
				if (inventory.size) authority = AuthorityStore.inspectJournal(authorityStorePath(root));
			}
		}
	} catch (error) {
		problem = error instanceof DurableFileLockBusyError ? "authority_live" : "native_unknown";
	}
	function entry(
		id: string,
		names: readonly string[],
		runId: string | null,
		executionId: string | null,
		reason: string | null,
		bytes = 0,
	): NativeRecordGcEntry {
		return {
			requestId: id,
			runId,
			executionId,
			reason,
			action: reason ? "kept" : options.execute ? "pruned" : "prunable",
			paths: names.map((name) => `native-exec/${name}`),
			bytes,
		};
	}
	const gc: NativeRecordGc = {
		entries,
		visit(runPath, snapshot, keepReason) {
			if (problem) return problem;
			const first = snapshot.records[0]?.event;
			if (first?.kind !== "created") return "integrity";
			const unsettled =
				authority &&
				[...authority.state.grants.values()].some(
					(grant) =>
						grant.token.sessionId === snapshot.state.runId &&
						(grant.effectLive || !SETTLED_EFFECT_STATES.has(grant.state)),
				);
			const runReason = keepReason ?? (unsettled ? "native_authority" : null);
			let blocker: string | null = unsettled ? "native_authority" : null;
			for (const row of snapshot.records) {
				const dispatch = row.event;
				if (dispatch.kind !== "dispatch") continue;
				const id = nativeRequestId(dispatch.executionId);
				const names = inventory.get(id);
				if (!names) continue;
				inventory.delete(id);
				let reason = runReason;
				let bytes = 0;
				if (!reason)
					try {
						if (
							!authority ||
							names.some(
								(name) => ![`${id}.jsonl`, `${id}.gc.jsonl`, `${id}.head`, `${id}.cancel`].includes(name),
							) ||
							(names.includes(`${id}.jsonl`) && names.includes(`${id}.gc.jsonl`))
						)
							throw new VerifiedRunError("native_integrity");
						const limit = first.contract.budget.maxOutputBytes * 4 + 65_536;
						const files = snapshotNativeFiles(dir, names, limit);
						const retired = names.includes(`${id}.gc.jsonl`);
						const record = readRustExecutionRecord(dir, id, first.contract.budget.maxOutputBytes, retired);
						if (
							!record ||
							(!retired && !record.durable) ||
							!record.terminal ||
							!record.identity ||
							!record.bindingDigest
						)
							throw new VerifiedRunError("native_incomplete");
						const head = files.find((file) => file.name === `${id}.head`);
						const payload = files.find((file) => file.name === `${id}${retired ? ".gc" : ""}.jsonl`);
						if (
							!payload ||
							(!head && readRegularFile(join(dir, payload.name), limit).at(-1) !== 10) ||
							(head && Number(readRegularFile(join(dir, head.name), 32).toString().trim()) !== payload.bytes)
						)
							throw new VerifiedRunError("native_incomplete");
						const matches = [...authority.state.grants.values()].filter(
							(grant) => grant.commandId === dispatch.executionId,
						);
						const grant = matches[0];
						const identity = snapshot.state.processes.find(
							(process) => process.executionId === dispatch.executionId,
						)?.identity;
						if (
							matches.length !== 1 ||
							!grant ||
							grant.state !== "terminated" ||
							grant.effectLive ||
							grant.dispatchId !== dispatch.executionId ||
							grant.token.sessionId !== snapshot.state.runId ||
							digestObject(grant.identity) !== digestObject(identity) ||
							digestObject(record.identity) !== digestObject(identity) ||
							record.bindingDigest !==
								digestObject({
									token: grant.token,
									generation: row.generation,
									executionId: dispatch.executionId,
									intentDigest: grant.intentDigest,
								})
						)
							throw new VerifiedRunError("native_authority");
						if (!hostGone(record) || probeWithNativeWitness(record.identity, nativeWitnessDir(root)) !== "gone")
							throw new VerifiedRunError("native_live");
						// wall-clock: retention compares kernel-stamped file mtimes, never execution deadlines.
						if (files.some((file) => Date.now() - file.mtimeMs < options.olderThanMs)) reason = "recent";
						else {
							assertNativeFiles(dir, files, limit);
							if (
								readRunJournal(runPath)?.bytesDigest !== snapshot.bytesDigest ||
								digestObject(AuthorityStore.inspectJournal(authorityStorePath(root)).head) !==
									digestObject(authority.head)
							)
								throw new VerifiedRunError("native_authority");
							bytes = files.reduce((sum, file) => sum + file.bytes, 0);
							if (options.execute)
								try {
									removeNativeFiles(dir, id, files, limit);
								} catch {
									reason = "remove_failed";
									bytes = 0;
								}
						}
					} catch (error) {
						reason = error instanceof VerifiedRunError ? error.code : "native_unknown";
					}
				if (reason && reason !== "recent" && !keepReason) blocker ??= reason;
				entries.push(entry(id, names, snapshot.state.runId, dispatch.executionId, reason, bytes));
			}
			return blocker;
		},
		finish() {
			for (const [id, names] of inventory) entries.push(entry(id, names, null, null, problem ?? "unreferenced"));
			if (problem && !inventory.size) entries.push(entry("unknown", [], null, null, problem));
		},
	};
	try {
		return work(gc);
	} finally {
		lease?.release();
	}
}
