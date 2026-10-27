/**
 * Spec 098: keep the raw output of a failing acceptance check on disk and point the model at it,
 * so it reads ranges with `read` instead of re-running the check to see output.
 *
 * Behind `OMK_GOAL_OUTPUT_RECALL=1` (default off). The artifact is diagnostic only: completion and
 * evidence still come from the receipt. The trace keeps only a digest and counts.
 *
 * SECURITY: nothing is redacted (since 1.5.5 no redaction runs on bash/log output), so a recall file can
 * hold secrets the check printed, verbatim. Files live under `<cwd>/.omk/goals/recall/` (0700 dir, 0600
 * files, a `*` .gitignore) so the `read` tool's workspace/loadout policy can open them.
 */

import { createHash, randomBytes } from "node:crypto";
import {
	chmodSync,
	closeSync,
	existsSync,
	ftruncateSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
	writeSync,
} from "node:fs";
import { basename, join, relative } from "node:path";
import { isDefaultOnEnvFlag } from "./env-flag.ts";
import {
	evidenceLifecycleDeleteEnabled,
	evidenceLifecycleObserveEnabled,
	noteEvidenceRemovedByExistingPolicy,
} from "./evidence-lifecycle.ts";
import { evidencePruneHold } from "./evidence-lifecycle-delete.ts";
import { reserveRecallAttempt } from "./evidence-recall-counter.ts";
import { registerRecallEvidence } from "./goal-output-recall-evidence.ts";
import { formatSize } from "./tools/truncate.ts";

export const OUTPUT_RECALL_MAX_BYTES = 4 * 1024 * 1024;
export const OUTPUT_RECALL_HEAD_BYTES = 1024 * 1024;
export const OUTPUT_RECALL_TAIL_BYTES = OUTPUT_RECALL_MAX_BYTES - OUTPUT_RECALL_HEAD_BYTES;
export const OUTPUT_RECALL_PER_GOAL = 3;
export const OUTPUT_RECALL_PER_DIR = 20;
const HINT_CHARS = 1_500;
const MAX_ATTEMPTS = 100;

/**
 * `OMK_GOAL_OUTPUT_RECALL=1` (default off). Warning: recall files are unredacted check output and can hold
 * secrets verbatim; see the module header and spec 098 §2a.
 */
export function goalOutputRecallEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	return isDefaultOnEnvFlag(env.OMK_GOAL_OUTPUT_RECALL);
}

/** What a session entry may record about an artifact: a digest and counts, never output text. */
export interface OutputArtifactSummary {
	readonly sha256: string;
	readonly bytes: number;
	readonly lines: number;
	readonly complete: boolean;
	readonly elidedBytes: number;
	/** Elided bytes over the bytes the check printed; 0 when complete. */
	readonly elidedRatio: number;
}

export interface OutputArtifact extends OutputArtifactSummary {
	/** Relative to cwd, inside the workspace so `read` under a loadout policy can open it. */
	readonly displayPath: string;
	readonly absolutePath: string;
}

export interface OutputArtifactTarget {
	readonly cwd: string;
	readonly goalId: string;
	readonly round: number;
	readonly revision: number;
}

/** Directory of recall files: omk-owned goal state, outside the goal workspace fingerprint. */
export function outputRecallDir(cwd: string): string {
	return join(cwd, ".omk", "goals", "recall");
}

function removeQuietly(path: string): void {
	try {
		rmSync(path, { force: true });
	} catch {
		// Best effort: cleanup must never fail the check.
	}
}

function safeName(text: string): string {
	return text.replace(/[^a-zA-Z0-9_-]/gu, "_");
}

/** Oldest first by mtime; keep the newest `keep`. */
function keepNewest(files: readonly string[], keep: number): void {
	const dated = files.flatMap((file) => {
		try {
			return [{ file, mtime: statSync(file).mtimeMs }];
		} catch {
			return [];
		}
	});
	dated.sort((a, b) => a.mtime - b.mtime || a.file.localeCompare(b.file));
	// Spec 118 D2 (`delete`): a held artifact over the cap survives; `heldBytes` records it.
	for (const { file } of dated.slice(0, Math.max(0, dated.length - keep))) {
		if (evidencePruneHold(file) !== undefined) continue;
		noteEvidenceRemovedByExistingPolicy(file);
		removeQuietly(file);
	}
}

/** Exactly `acceptance-<id>-<round>-<rev>-<attempt>.log` for this goal id; `a` never matches `a-1`'s files. */
function goalFilePattern(goalId: string): RegExp {
	const id = safeName(goalId).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
	return new RegExp(`^acceptance-${id}-\\d+-\\d+-\\d+(?:-[0-9a-f]{8})?\\.log$`, "u");
}

function enforceCaps(dir: string, goalId: string): void {
	const all = readdirSync(dir)
		.filter((name) => name.startsWith("acceptance-") && name.endsWith(".log"))
		.map((name) => join(dir, name));
	keepNewest(
		all.filter((file) => goalFilePattern(goalId).test(basename(file))),
		OUTPUT_RECALL_PER_GOAL,
	);
	// Files the per-goal pass removed are skipped (stat fails).
	keepNewest(all, OUTPUT_RECALL_PER_DIR);
}

function nextAttempt(dir: string, stem: string): number {
	let last = 0;
	for (const name of readdirSync(dir)) {
		const match = name.startsWith(`${stem}-`)
			? /^(\d+)(?:-[0-9a-f]{8})?\.log$/u.exec(name.slice(stem.length + 1))
			: null;
		if (match) last = Math.max(last, Number(match[1]));
	}
	return last + 1;
}

function countLines(bytes: Buffer): number {
	if (bytes.byteLength === 0) return 0;
	let lines = 0;
	for (const byte of bytes) if (byte === 0x0a) lines += 1;
	return bytes[bytes.byteLength - 1] === 0x0a ? lines : lines + 1;
}

/**
 * Streams one check's combined output to a 0600 file. Up to 4 MiB it is the output itself; beyond,
 * the first 1 MiB and the last 3 MiB around one `[omk: N bytes elided]` line.
 */
export class OutputArtifactWriter {
	private readonly file: string;
	private readonly displayPath: string;
	private readonly target: OutputArtifactTarget;
	private readonly dir: string;
	private fd: number | undefined;
	private total = 0;
	private tail: Buffer[] = [];
	private tailBytes = 0;

	private constructor(file: string, fd: number, target: OutputArtifactTarget, dir: string) {
		this.file = file;
		this.displayPath = relative(target.cwd, file);
		this.target = target;
		this.dir = dir;
		this.fd = fd;
		chmodSync(file, 0o600);
	}

	/** Undefined when the file cannot be created; the caller then keeps the `main` follow-up. */
	static open(target: OutputArtifactTarget): OutputArtifactWriter | undefined {
		try {
			const dir = outputRecallDir(target.cwd);
			mkdirSync(dir, { recursive: true, mode: 0o700 });
			chmodSync(dir, 0o700);
			const ignore = join(dir, ".gitignore");
			if (!existsSync(ignore)) writeFileSync(ignore, "*\n", { mode: 0o600 });
			const stem = `acceptance-${safeName(target.goalId)}-${target.round}-${target.revision}`;
			// A re-run in the same round and revision gets the next attempt number; earlier output is kept.
			// Numbers only grow, so a file removed by the count cap is never reused.
			const scanned = nextAttempt(dir, stem);
			// Spec 118 D2 (`delete`): the sidecar counter is reserved atomically before the file is created.
			const first = evidenceLifecycleDeleteEnabled()
				? reserveRecallAttempt(dir, stem, scanned - 1).attempt
				: scanned;
			// Spec 106 EV11 (flag `observe`): a nonce so a path whose files were all pruned is never reused.
			const nonce = evidenceLifecycleObserveEnabled() ? `-${randomBytes(4).toString("hex")}` : "";
			for (let attempt = first; attempt < first + MAX_ATTEMPTS; attempt++) {
				const file = join(dir, `${stem}-${attempt}${nonce}.log`);
				try {
					return new OutputArtifactWriter(file, openSync(file, "wx", 0o600), target, dir);
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
				}
			}
			return undefined;
		} catch {
			return undefined;
		}
	}

	write(data: Buffer): void {
		if (this.fd === undefined) return;
		try {
			if (this.total + data.byteLength <= OUTPUT_RECALL_MAX_BYTES) writeSync(this.fd, data);
			else if (this.total < OUTPUT_RECALL_MAX_BYTES)
				writeSync(this.fd, data.subarray(0, OUTPUT_RECALL_MAX_BYTES - this.total));
			this.total += data.byteLength;
			this.pushTail(data);
		} catch {
			this.discard();
		}
	}

	private pushTail(data: Buffer): void {
		this.tail.push(data);
		this.tailBytes += data.byteLength;
		while (this.tail.length > 1 && this.tailBytes - (this.tail[0]?.byteLength ?? 0) >= OUTPUT_RECALL_TAIL_BYTES) {
			this.tailBytes -= this.tail.shift()?.byteLength ?? 0;
		}
	}

	/** Abort or runner error: delete the partial file and give no reference. */
	discard(): void {
		if (this.fd !== undefined) {
			try {
				closeSync(this.fd);
			} catch {
				// already closed
			}
			this.fd = undefined;
		}
		removeQuietly(this.file);
	}

	finish(): OutputArtifact | undefined {
		const fd = this.fd;
		if (fd === undefined) return undefined;
		try {
			let elidedBytes = 0;
			if (this.total > OUTPUT_RECALL_MAX_BYTES) {
				elidedBytes = this.total - OUTPUT_RECALL_MAX_BYTES;
				ftruncateSync(fd, OUTPUT_RECALL_HEAD_BYTES);
				const tail = Buffer.concat(this.tail).subarray(-OUTPUT_RECALL_TAIL_BYTES);
				const marker = Buffer.from(`\n[omk: ${elidedBytes} bytes elided]\n`);
				// Positional writes: ftruncate does not move the fd offset.
				writeSync(fd, marker, 0, marker.byteLength, OUTPUT_RECALL_HEAD_BYTES);
				writeSync(fd, tail, 0, tail.byteLength, OUTPUT_RECALL_HEAD_BYTES + marker.byteLength);
			}
			closeSync(fd);
			this.fd = undefined;
			this.tail = [];
			const content = readFileSync(this.file);
			const sha256 = createHash("sha256").update(content).digest("hex");
			registerRecallEvidence(this.file, this.target.goalId, content.byteLength, sha256);
			enforceCaps(this.dir, this.target.goalId);
			return {
				displayPath: this.displayPath,
				absolutePath: this.file,
				sha256,
				bytes: content.byteLength,
				lines: countLines(content),
				complete: elidedBytes === 0,
				elidedBytes,
				elidedRatio: this.total === 0 ? 0 : Math.round((elidedBytes / this.total) * 10_000) / 10_000,
			};
		} catch {
			this.discard();
			return undefined;
		}
	}
}

export function summarizeArtifact(artifact: OutputArtifact): OutputArtifactSummary {
	const { sha256, bytes, lines, complete, elidedBytes, elidedRatio } = artifact;
	return { sha256, bytes, lines, complete, elidedBytes, elidedRatio };
}

/** The flag-on follow-up. `head` is the main text up to and including the receipt label. */
export function outputRecallFollowUp(head: string, outputTail: string, artifact: OutputArtifact): string {
	const hint = outputTail.slice(-HINT_CHARS).trim();
	const completeness = artifact.complete ? "complete" : `middle elided ${artifact.elidedBytes} bytes`;
	return [
		`${head}.`,
		...(hint.length > 0 ? ["Diagnostic hint (may be incomplete):", hint] : []),
		`Full output: ${artifact.displayPath} (${artifact.lines} lines, ${formatSize(artifact.bytes)}; ${completeness})`,
		"Read ranges with read(path, offset, limit) instead of re-running the check to see output.",
		"Fix the cause, then end your turn; the check re-runs automatically.",
	].join("\n");
}

/** Spec 098: delete every recall file of `goalId` (goal cleared or replaced). Best effort, any flag state. */
export function deleteGoalRecallFiles(cwd: string, goalId: string): void {
	const dir = outputRecallDir(cwd);
	const pattern = goalFilePattern(goalId);
	try {
		for (const name of readdirSync(dir)) {
			if (!pattern.test(name) || evidencePruneHold(join(dir, name)) !== undefined) continue;
			noteEvidenceRemovedByExistingPolicy(join(dir, name));
			removeQuietly(join(dir, name));
		}
	} catch {
		// No recall dir: nothing to delete.
	}
}
