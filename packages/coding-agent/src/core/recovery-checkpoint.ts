/**
 * `omk.recovery.checkpoint` — pure decision algorithms for native worktree/
 * conversation recovery checkpoints.
 *
 * This module is intentionally side-effect free: it never reads the filesystem,
 * never shells out to git, and never mutates a worktree. It validates a
 * file-backed {@link RecoveryCheckpoint}, classifies a restore preflight against
 * an externally-observed worktree snapshot, decides how OMK-created untracked
 * files should be disposed (delete vs quarantine), and produces a
 * conversation/code/both restore plan. The caller is responsible for gathering
 * the observed state (git status, per-file hashes) and for executing the plan.
 *
 * Derived clean-room from the lane C plan
 * (`.omk/runs/omk-pi-package-hardening-plan/recovery-readseek.md`) and the
 * adoption algorithm plan; no legacy package source is imported or copied.
 *
 * Dependency-free apart from `node:path` (pure path math, no I/O).
 */

import { isAbsolute } from "node:path";

export const RECOVERY_CHECKPOINT_SCHEMA_VERSION = "omk.recovery.checkpoint.v1";

export type RecoveryVcs = "git" | "none";
export type TouchedFileMode = "tracked" | "untracked" | "deleted";

export interface RecoveryCheckpointSession {
	readonly sessionFile?: string;
	readonly leafId: string | null;
	readonly branchPathIds: readonly string[];
	readonly contextHash: string;
}

export interface RecoveryTouchedFile {
	readonly path: string;
	readonly beforeSha256?: string;
	readonly afterSha256?: string;
	readonly mode: TouchedFileMode;
}

export interface RecoveryCheckpointWorkspace {
	readonly repoRoot: string;
	readonly vcs: RecoveryVcs;
	readonly head?: string;
	readonly statusPorcelainSha256: string;
	readonly touchedFiles: readonly RecoveryTouchedFile[];
	readonly reversePatchArtifact?: string;
}

export interface RecoveryCheckpointTool {
	readonly turnIndex: number;
	readonly beforeToolCallId?: string;
	readonly afterToolCallId?: string;
	readonly mutatingTools: readonly string[];
}

export interface RecoveryCheckpointLedger {
	readonly eventId: string;
	readonly previousEventHash: string;
	readonly eventHash: string;
}

export interface RecoveryCheckpoint {
	readonly schemaVersion: typeof RECOVERY_CHECKPOINT_SCHEMA_VERSION;
	readonly checkpointId: string;
	readonly createdAt: string;
	readonly session: RecoveryCheckpointSession;
	readonly workspace: RecoveryCheckpointWorkspace;
	readonly tool?: RecoveryCheckpointTool;
	readonly ledger: RecoveryCheckpointLedger;
}

export interface RecoveryCheckpointValidation {
	readonly ok: boolean;
	readonly errors: readonly string[];
	readonly checkpoint?: RecoveryCheckpoint;
}

const HEX64 = /^[0-9a-f]{64}$/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function isHex64(value: unknown): value is string {
	return typeof value === "string" && HEX64.test(value);
}

function isIsoTimestamp(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

/** A touched-file path must be repo-relative and must not escape the repo root. */
export function isUnsafeTouchedPath(path: unknown): boolean {
	if (typeof path !== "string" || path.length === 0) return true;
	if (isAbsolute(path)) return true;
	const normalized = path.replace(/\\/g, "/");
	return normalized.split("/").some((segment) => segment === "..");
}

function normalizeRelPath(path: string): string {
	return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function validateTouchedFile(value: unknown, index: number, errors: string[]): void {
	const label = `workspace.touchedFiles[${index}]`;
	if (!isPlainObject(value)) {
		errors.push(`${label} must be an object`);
		return;
	}
	if (isUnsafeTouchedPath(value.path)) {
		errors.push(`${label}.path must be a repo-relative path without '..' segments`);
	}
	const mode = value.mode;
	if (mode !== "tracked" && mode !== "untracked" && mode !== "deleted") {
		errors.push(`${label}.mode must be one of tracked|untracked|deleted`);
		return;
	}
	if (value.beforeSha256 !== undefined && !isHex64(value.beforeSha256)) {
		errors.push(`${label}.beforeSha256 must be a 64-char hex digest when present`);
	}
	if (value.afterSha256 !== undefined && !isHex64(value.afterSha256)) {
		errors.push(`${label}.afterSha256 must be a 64-char hex digest when present`);
	}
	if (mode === "untracked") {
		if (!isHex64(value.afterSha256)) errors.push(`${label}.afterSha256 is required for untracked files`);
		if (value.beforeSha256 !== undefined) errors.push(`${label}.beforeSha256 must be absent for untracked files`);
	}
	if (mode === "deleted") {
		if (!isHex64(value.beforeSha256)) errors.push(`${label}.beforeSha256 is required for deleted files`);
		if (value.afterSha256 !== undefined) errors.push(`${label}.afterSha256 must be absent for deleted files`);
	}
	if (mode === "tracked" && !isHex64(value.afterSha256)) {
		errors.push(`${label}.afterSha256 is required for tracked files`);
	}
}

function validateSession(value: unknown, errors: string[]): void {
	if (!isPlainObject(value)) {
		errors.push("session must be an object");
		return;
	}
	if (value.leafId !== null && typeof value.leafId !== "string") {
		errors.push("session.leafId must be a string or null");
	}
	if (!Array.isArray(value.branchPathIds) || value.branchPathIds.some((id) => typeof id !== "string")) {
		errors.push("session.branchPathIds must be an array of strings");
	}
	if (!isHex64(value.contextHash)) {
		errors.push("session.contextHash must be a 64-char hex digest");
	}
	if (value.sessionFile !== undefined && typeof value.sessionFile !== "string") {
		errors.push("session.sessionFile must be a string when present");
	}
}

function validateWorkspace(value: unknown, errors: string[]): void {
	if (!isPlainObject(value)) {
		errors.push("workspace must be an object");
		return;
	}
	if (!isNonEmptyString(value.repoRoot)) errors.push("workspace.repoRoot must be a non-empty string");
	if (value.vcs !== "git" && value.vcs !== "none") errors.push("workspace.vcs must be one of git|none");
	if (value.head !== undefined && typeof value.head !== "string") {
		errors.push("workspace.head must be a string when present");
	}
	if (!isHex64(value.statusPorcelainSha256)) {
		errors.push("workspace.statusPorcelainSha256 must be a 64-char hex digest");
	}
	if (value.reversePatchArtifact !== undefined && typeof value.reversePatchArtifact !== "string") {
		errors.push("workspace.reversePatchArtifact must be a string when present");
	}
	if (!Array.isArray(value.touchedFiles)) {
		errors.push("workspace.touchedFiles must be an array");
		return;
	}
	value.touchedFiles.forEach((entry, index) => {
		validateTouchedFile(entry, index, errors);
	});
}

function validateTool(value: unknown, errors: string[]): void {
	if (value === undefined) return;
	if (!isPlainObject(value)) {
		errors.push("tool must be an object when present");
		return;
	}
	if (typeof value.turnIndex !== "number" || !Number.isInteger(value.turnIndex) || value.turnIndex < 0) {
		errors.push("tool.turnIndex must be a non-negative integer");
	}
	if (!Array.isArray(value.mutatingTools) || value.mutatingTools.some((t) => typeof t !== "string")) {
		errors.push("tool.mutatingTools must be an array of strings");
	}
	if (value.beforeToolCallId !== undefined && typeof value.beforeToolCallId !== "string") {
		errors.push("tool.beforeToolCallId must be a string when present");
	}
	if (value.afterToolCallId !== undefined && typeof value.afterToolCallId !== "string") {
		errors.push("tool.afterToolCallId must be a string when present");
	}
}

function validateLedger(value: unknown, errors: string[]): void {
	if (!isPlainObject(value)) {
		errors.push("ledger must be an object");
		return;
	}
	if (!isNonEmptyString(value.eventId)) errors.push("ledger.eventId must be a non-empty string");
	if (!isHex64(value.previousEventHash)) errors.push("ledger.previousEventHash must be a 64-char hex digest");
	if (!isHex64(value.eventHash)) errors.push("ledger.eventHash must be a 64-char hex digest");
}

/**
 * Validate an untrusted value as a {@link RecoveryCheckpoint}. Pure and
 * fail-closed: any structural problem yields `ok: false` with explicit errors
 * and no `checkpoint` payload.
 */
export function validateRecoveryCheckpoint(value: unknown): RecoveryCheckpointValidation {
	const errors: string[] = [];
	if (!isPlainObject(value)) {
		return { ok: false, errors: ["checkpoint must be an object"] };
	}
	if (value.schemaVersion !== RECOVERY_CHECKPOINT_SCHEMA_VERSION) {
		errors.push(`schemaVersion must be ${RECOVERY_CHECKPOINT_SCHEMA_VERSION}`);
	}
	if (!isNonEmptyString(value.checkpointId)) errors.push("checkpointId must be a non-empty string");
	if (!isIsoTimestamp(value.createdAt)) errors.push("createdAt must be an ISO-8601 timestamp");
	validateSession(value.session, errors);
	validateWorkspace(value.workspace, errors);
	validateTool(value.tool, errors);
	validateLedger(value.ledger, errors);

	if (errors.length > 0) return { ok: false, errors };
	return { ok: true, errors: [], checkpoint: value as unknown as RecoveryCheckpoint };
}

/**
 * The ledger anchor as independently re-read from the hash-chained ledger.
 * Compared against the checkpoint's embedded anchor before any mutation.
 */
export interface ObservedLedgerAnchor {
	readonly eventId: string;
	readonly previousEventHash: string;
	readonly eventHash: string;
}

export interface LedgerAnchorVerification {
	readonly ok: boolean;
	readonly mismatches: readonly string[];
}

/**
 * Compare a checkpoint's embedded ledger anchor with the anchor observed in the
 * live ledger. A mismatch means the checkpoint references an event that no
 * longer matches the durable audit trail (tamper or divergence) and the restore
 * must fail closed.
 */
export function verifyCheckpointLedgerAnchor(
	checkpoint: RecoveryCheckpoint,
	observed: ObservedLedgerAnchor,
): LedgerAnchorVerification {
	const mismatches: string[] = [];
	if (checkpoint.ledger.eventId !== observed.eventId) {
		mismatches.push(`eventId mismatch: checkpoint=${checkpoint.ledger.eventId} ledger=${observed.eventId}`);
	}
	if (checkpoint.ledger.previousEventHash !== observed.previousEventHash) {
		mismatches.push("previousEventHash mismatch between checkpoint and ledger");
	}
	if (checkpoint.ledger.eventHash !== observed.eventHash) {
		mismatches.push("eventHash mismatch between checkpoint and ledger");
	}
	return { ok: mismatches.length === 0, mismatches };
}

export interface ObservedTouchedFile {
	readonly path: string;
	readonly exists: boolean;
	readonly sha256?: string;
	readonly isSymlink?: boolean;
	/** True when the path (or its symlink target) resolves outside the repo root. */
	readonly escapesRepo?: boolean;
}

export interface ObservedWorktree {
	readonly head?: string;
	readonly statusPorcelainSha256?: string;
	/** Current dirty paths (repo-relative) from `git status --porcelain`. */
	readonly dirtyPaths: readonly string[];
	readonly touchedFiles: readonly ObservedTouchedFile[];
}

export interface RestorePreflightOptions {
	/** Allow restoring even though HEAD moved since the checkpoint. */
	readonly allowNonHeadRestore?: boolean;
}

export type RestorePreflightVerdict = "clean" | "blocked";

export type RestorePreflightIssueCode =
	| "unrelated-dirty-path"
	| "touched-hash-mismatch"
	| "missing-touched-file"
	| "symlink-escape"
	| "head-mismatch";

export interface RestorePreflightIssue {
	readonly code: RestorePreflightIssueCode;
	readonly path?: string;
	readonly detail: string;
}

export interface RestorePreflightResult {
	readonly verdict: RestorePreflightVerdict;
	readonly issues: readonly RestorePreflightIssue[];
	readonly unrelatedDirtyPaths: readonly string[];
	readonly hashMismatches: readonly string[];
	readonly symlinkEscapes: readonly string[];
	readonly headChanged: boolean;
}

/**
 * Classify whether a code restore can proceed against the live worktree.
 *
 * Fail-closed rules (from the lane C restore algorithm):
 *  - any dirty path outside the recorded touched set blocks the restore;
 *  - any touched file whose current hash differs from the recorded `afterSha256`
 *    blocks the restore;
 *  - any symlink escaping the repo root blocks the restore;
 *  - a moved HEAD blocks the restore unless `allowNonHeadRestore` is set.
 */
export function classifyRestorePreflight(
	checkpoint: RecoveryCheckpoint,
	observed: ObservedWorktree,
	options: RestorePreflightOptions = {},
): RestorePreflightResult {
	const issues: RestorePreflightIssue[] = [];
	const touchedByPath = new Map<string, RecoveryTouchedFile>();
	for (const file of checkpoint.workspace.touchedFiles) {
		touchedByPath.set(normalizeRelPath(file.path), file);
	}

	const unrelatedDirtyPaths: string[] = [];
	for (const dirty of observed.dirtyPaths) {
		if (!touchedByPath.has(normalizeRelPath(dirty))) {
			unrelatedDirtyPaths.push(dirty);
			issues.push({
				code: "unrelated-dirty-path",
				path: dirty,
				detail: "dirty path is outside the checkpoint's recorded touched files",
			});
		}
	}

	const observedByPath = new Map<string, ObservedTouchedFile>();
	for (const file of observed.touchedFiles) {
		observedByPath.set(normalizeRelPath(file.path), file);
	}

	const hashMismatches: string[] = [];
	const symlinkEscapes: string[] = [];
	for (const expected of checkpoint.workspace.touchedFiles) {
		const key = normalizeRelPath(expected.path);
		const current = observedByPath.get(key);
		if (!current) {
			issues.push({
				code: "missing-touched-file",
				path: expected.path,
				detail: "no observed state was provided for a recorded touched file",
			});
			continue;
		}
		if (current.escapesRepo === true || (current.isSymlink === true && current.escapesRepo !== false)) {
			symlinkEscapes.push(expected.path);
			issues.push({
				code: "symlink-escape",
				path: expected.path,
				detail: "touched path is a symlink resolving outside the repo root",
			});
			continue;
		}
		if (expected.mode === "deleted") {
			if (current.exists) {
				hashMismatches.push(expected.path);
				issues.push({
					code: "touched-hash-mismatch",
					path: expected.path,
					detail: "expected a deleted file to be absent but it is present",
				});
			}
			continue;
		}
		if (!current.exists) {
			issues.push({
				code: "missing-touched-file",
				path: expected.path,
				detail: "recorded touched file is missing from the worktree",
			});
			continue;
		}
		if (current.sha256 !== expected.afterSha256) {
			hashMismatches.push(expected.path);
			issues.push({
				code: "touched-hash-mismatch",
				path: expected.path,
				detail: "current file hash differs from the recorded post-edit hash",
			});
		}
	}

	const headChanged =
		checkpoint.workspace.vcs === "git" &&
		checkpoint.workspace.head !== undefined &&
		observed.head !== undefined &&
		checkpoint.workspace.head !== observed.head;
	if (headChanged && options.allowNonHeadRestore !== true) {
		issues.push({
			code: "head-mismatch",
			detail: "HEAD moved since the checkpoint; pass allowNonHeadRestore to override",
		});
	}

	return {
		verdict: issues.length === 0 ? "clean" : "blocked",
		issues,
		unrelatedDirtyPaths,
		hashMismatches,
		symlinkEscapes,
		headChanged,
	};
}

export type UntrackedDisposition = "delete" | "quarantine" | "skip";

export interface UntrackedDispositionDecision {
	readonly disposition: UntrackedDisposition;
	readonly reason: string;
}

export interface ObservedUntrackedFile {
	readonly exists: boolean;
	readonly sha256?: string;
}

/**
 * Decide how an OMK-created untracked file should be handled on restore.
 *
 *  - `skip`: the file is already gone, nothing to undo.
 *  - `delete`: the file still exactly matches what OMK created, safe to remove.
 *  - `quarantine`: the file changed since OMK created it; move it under the
 *    recovery quarantine directory rather than destroying user edits.
 */
export function decideUntrackedDisposition(
	touched: RecoveryTouchedFile,
	observed: ObservedUntrackedFile,
): UntrackedDispositionDecision {
	if (touched.mode !== "untracked") {
		return { disposition: "skip", reason: "disposition only applies to untracked files" };
	}
	if (!observed.exists) {
		return { disposition: "skip", reason: "untracked file is already absent" };
	}
	if (isHex64(touched.afterSha256) && observed.sha256 === touched.afterSha256) {
		return { disposition: "delete", reason: "current hash matches the OMK-created hash" };
	}
	return { disposition: "quarantine", reason: "current hash differs from the OMK-created hash" };
}

export type RestoreMode = "conversation" | "code" | "both";

export type RestorePhaseKind = "conversation" | "code";
export type RestorePhaseAction = "navigate-tree" | "apply-reverse-patch";

export interface RestorePlanPhase {
	readonly phase: RestorePhaseKind;
	readonly action: RestorePhaseAction;
	readonly targetLeafId?: string | null;
	readonly recordedPaths?: readonly string[];
}

export interface RestorePlan {
	readonly mode: RestoreMode;
	readonly status: "ready" | "blocked";
	readonly phases: readonly RestorePlanPhase[];
	readonly blockers: readonly string[];
	/** For `both`: the leaf to keep if the conversation phase fails after code restore. */
	readonly preservePreviousLeafId?: string | null;
	readonly inDoubtPolicy?: "preserve-previous-leaf";
}

export interface PlanRestoreInput {
	readonly mode: RestoreMode;
	readonly checkpoint: RecoveryCheckpoint;
	/** Required for `code` and `both` modes. */
	readonly preflight?: RestorePreflightResult;
	/** The current session leaf, preserved for manual recovery in `both` mode. */
	readonly currentLeafId?: string | null;
}

function codePhase(checkpoint: RecoveryCheckpoint): RestorePlanPhase {
	return {
		phase: "code",
		action: "apply-reverse-patch",
		recordedPaths: checkpoint.workspace.touchedFiles.map((file) => file.path),
	};
}

function conversationPhase(checkpoint: RecoveryCheckpoint): RestorePlanPhase {
	return { phase: "conversation", action: "navigate-tree", targetLeafId: checkpoint.session.leafId };
}

function collectPreflightBlockers(preflight: RestorePreflightResult | undefined): string[] {
	if (!preflight) return ["code restore requires a preflight classification"];
	if (preflight.verdict === "clean") return [];
	return preflight.issues.map((issue) => (issue.path ? `${issue.code}: ${issue.path}` : issue.code));
}

/**
 * Build a restore plan for the requested mode.
 *
 *  - `conversation`: navigate the session tree to the checkpoint leaf; no file
 *    writes, so no worktree preflight is required.
 *  - `code`: apply the recorded reverse patch path-by-path; requires a clean
 *    preflight.
 *  - `both`: restore code first, then navigate the tree; requires a clean
 *    preflight. If the second (conversation) phase fails at execution time the
 *    caller marks the operation `in_doubt` and keeps `preservePreviousLeafId`.
 */
export function planRestore(input: PlanRestoreInput): RestorePlan {
	const { mode, checkpoint, preflight } = input;
	if (mode === "conversation") {
		return { mode, status: "ready", phases: [conversationPhase(checkpoint)], blockers: [] };
	}

	const blockers = collectPreflightBlockers(preflight);
	if (mode === "code") {
		if (blockers.length > 0) return { mode, status: "blocked", phases: [], blockers };
		return { mode, status: "ready", phases: [codePhase(checkpoint)], blockers: [] };
	}

	// mode === "both"
	const preservePreviousLeafId = input.currentLeafId ?? null;
	if (blockers.length > 0) {
		return {
			mode,
			status: "blocked",
			phases: [],
			blockers,
			preservePreviousLeafId,
			inDoubtPolicy: "preserve-previous-leaf",
		};
	}
	return {
		mode,
		status: "ready",
		phases: [codePhase(checkpoint), conversationPhase(checkpoint)],
		blockers: [],
		preservePreviousLeafId,
		inDoubtPolicy: "preserve-previous-leaf",
	};
}
