/**
 * Acceptance checks for durable goals.
 *
 * A goal's acceptance check is one command the user approved. It runs through
 * the receipt-bound local bash path under the session's default sandbox policy,
 * and the strict evidence gate decides whether its receipt passed. The state of
 * the workspace right after the check is recorded so completion can refuse a
 * receipt that no longer describes the files: any tracked edit, new file or HEAD
 * move changes that state. Goal state itself (`.omk/goals`) is excluded.
 */
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { EvidenceReceiptStore } from "../guardrails/evidence-receipt-store.ts";
import { ReplayLedgerManager } from "../guardrails/evidence-system.ts";
import { checkReceiptWithStrictGate } from "../guardrails/receipt-gate.ts";
import { VerifiedEvidenceExecutor } from "../guardrails/verified-executor.ts";
import { captureWorkspaceFingerprint } from "../guardrails/workspace-fingerprint.ts";
import type { EvidenceReceiptStatus, WorkspaceScope } from "../types/evidence.ts";
import { stripAnsi } from "../utils/ansi.ts";
import { sanitizeBinaryOutput } from "../utils/shell.ts";
import { DEFAULT_BUILTIN_TOOL_TIMEOUTS } from "./agent-tool-settings.ts";
import type { DurableGoalSnapshot } from "./durable-goal.ts";
import { redactSensitiveTextForced } from "./redaction.ts";
import { detectSandboxBackend } from "./sandbox/backend.ts";
import { createDefaultBashSandboxPreflight, resolveBashSandboxMode } from "./sandbox/default-policy.ts";
import type { BashSandboxPreflight } from "./tools/bash.ts";
import { executeVerifiedLocalBash } from "./verified-bash-adapter.ts";
import { resolveSessionWorkspaceScopeReport, type SessionScopeCompleteness } from "./verified-bash-runtime.ts";

/** The built-in bash tool's default limit, so a check cannot outlast an ordinary command. */
export const GOAL_ACCEPTANCE_TIMEOUT_MS = DEFAULT_BUILTIN_TOOL_TIMEOUTS.bash ?? 300_000;
/** Dirty paths bound per workspace state; more are reported as `partial_truncated`. */
export const GOAL_SCOPE_MAX_PATHS = 512;

const OUTPUT_TAIL_CHARS = 2_000;
const CLAIM_COMMAND_CHARS = 160;
const LANE_ID = "goal-acceptance";

export interface GoalWorkspaceState {
	/** Manifest SHA-256 of HEAD, the dirty set and its contents, goal state excluded. */
	readonly sha256: string;
	readonly completeness: SessionScopeCompleteness;
}

export interface GoalAcceptanceResult {
	readonly receiptId: string;
	/** The receipt's core SHA-256, the digest a goal records as evidence. */
	readonly digest: string;
	readonly capturedAt: string;
	readonly status: EvidenceReceiptStatus;
	readonly exitCode: number | null;
	/** The command exited 0 and the strict evidence gate is open. */
	readonly passed: boolean;
	readonly gateReason: string;
	/** Workspace state right after the check. */
	readonly workspace: GoalWorkspaceState;
	/** Redacted end of the combined output, for the operator only. */
	readonly outputTail: string;
}

export interface GoalVerifierOptions {
	readonly cwd: string;
	readonly goalKey: string;
	readonly timeoutMs?: number;
	/** Defaults to the preflight every default local shell spawn uses. */
	readonly sandboxPreflight?: () => BashSandboxPreflight | undefined;
}

/** Directory holding the durable goal journal and its acceptance evidence. */
export function goalStateDirectory(cwd: string): string {
	return join(cwd, ".omk", "goals");
}

/** One key per goal instance: a re-created goal with the same id gets a new key. */
export function goalKeyOf(goal: Pick<DurableGoalSnapshot, "ref" | "createdAt">): string {
	return createHash("sha256").update(`${goal.ref.id}\0${goal.createdAt}`).digest("hex").slice(0, 16);
}

/**
 * Directories under `<cwd>/.omk` that omk itself writes while a session runs:
 * goal receipts and ledger, per-turn metrics, and per-run journals. They are
 * not task output, and they can change between a check and its completion.
 */
const OMK_OWNED_STATE_DIRS = ["goals", "metrics", "runs"] as const;

/**
 * The session workspace scope without omk's own state, resolved now. Receipts,
 * the ledger, turn metrics and run journals are written while a check runs or
 * right after a turn, so binding them would make a receipt stale the moment it
 * was stored, or right before the goal completes.
 */
function goalWorkspaceScope(cwd: string): {
	readonly scope: WorkspaceScope;
	readonly completeness: SessionScopeCompleteness;
} {
	const report = resolveSessionWorkspaceScopeReport(cwd, { maxPaths: GOAL_SCOPE_MAX_PATHS, fresh: true });
	const excluded = OMK_OWNED_STATE_DIRS.map((dir) =>
		relative(report.scope.root, canonicalPath(join(cwd, ".omk", dir)))
			.split(sep)
			.join("/"),
	).filter((path) => path.length > 0 && !path.startsWith(".."));
	if (excluded.length === 0) return report;
	return {
		scope: {
			root: report.scope.root,
			artifactPaths: report.scope.artifactPaths.filter(
				(path) => !excluded.some((dir) => path === dir || path.startsWith(`${dir}/`)),
			),
		},
		completeness: report.completeness,
	};
}

/** Capture the goal-relevant workspace state now, bypassing the session scope cache. */
export function captureGoalWorkspace(cwd: string): GoalWorkspaceState {
	const { scope, completeness } = goalWorkspaceScope(cwd);
	return { sha256: captureWorkspaceFingerprint(scope).manifestSha256, completeness };
}

export class GoalVerifier {
	private readonly cwd: string;
	private readonly ledgerGoalId: string;
	private readonly executor: VerifiedEvidenceExecutor;
	private readonly timeoutMs: number;
	private readonly sandboxPreflight: () => BashSandboxPreflight | undefined;

	constructor(options: GoalVerifierOptions) {
		const evidenceDir = join(goalStateDirectory(options.cwd), "evidence", options.goalKey);
		this.cwd = options.cwd;
		this.ledgerGoalId = `goal-${options.goalKey}`;
		this.executor = new VerifiedEvidenceExecutor({
			store: new EvidenceReceiptStore(join(evidenceDir, "receipts")),
			ledger: new ReplayLedgerManager(this.ledgerGoalId, join(evidenceDir, "ledger", "events.jsonl")),
		});
		this.timeoutMs = options.timeoutMs ?? GOAL_ACCEPTANCE_TIMEOUT_MS;
		this.sandboxPreflight = options.sandboxPreflight ?? (() => defaultSandboxPreflight(options.cwd));
	}

	/** Run the check once. Throws when it cannot run at all, for example when the sandbox refuses it. */
	async run(command: string, signal?: AbortSignal): Promise<GoalAcceptanceResult> {
		const claim = `goal acceptance: ${redactSensitiveTextForced(command).slice(0, CLAIM_COMMAND_CHARS)}`;
		const tail = new OutputTail(OUTPUT_TAIL_CHARS);
		const sandboxPolicy = this.sandboxPreflight();
		const execution = await executeVerifiedLocalBash({
			evidenceExecutor: this.executor,
			goalId: this.ledgerGoalId,
			laneId: LANE_ID,
			claim,
			script: command,
			cwd: this.cwd,
			timeoutMs: this.timeoutMs,
			workspaceScope: goalWorkspaceScope(this.cwd).scope,
			executor: "ci-runner",
			...(sandboxPolicy !== undefined ? { sandboxPolicy } : {}),
			...(signal !== undefined ? { signal } : {}),
			onData: (data) => tail.push(data),
		});
		const { gate, passed } = checkReceiptWithStrictGate({
			executor: this.executor,
			goalId: this.ledgerGoalId,
			claim,
			category: "feature",
			finalRisk: "The receipt covers the workspace state captured right after the check; later edits make it stale.",
			execution,
		});
		const { core, envelope } = execution.receipt;
		return {
			receiptId: core.receiptId,
			digest: envelope.coreSha256,
			capturedAt: core.finishedAt,
			status: core.status,
			exitCode: core.exitCode,
			passed,
			gateReason: gate.reason,
			workspace: captureGoalWorkspace(this.cwd),
			outputTail: tail.text(),
		};
	}

	/** The stored receipt still validates, passed, and carries `digest`. */
	receiptMatches(receiptId: string, digest: string): boolean {
		try {
			const receipt = this.executor.resolveReceipt(receiptId);
			return receipt.envelope.coreSha256 === digest && receipt.core.status === "passed";
		} catch {
			return false;
		}
	}
}

function defaultSandboxPreflight(cwd: string): BashSandboxPreflight | undefined {
	const mode = resolveBashSandboxMode();
	return mode === "off" ? undefined : createDefaultBashSandboxPreflight(cwd, mode, detectSandboxBackend());
}

function canonicalPath(path: string): string {
	const absolute = resolve(path);
	try {
		return realpathSync(absolute);
	} catch {
		// The goal directory may not exist yet; canonicalize the nearest existing parent.
		const parent = dirname(absolute);
		return parent === absolute ? absolute : join(canonicalPath(parent), basename(absolute));
	}
}

class OutputTail {
	private readonly decoder = new TextDecoder();
	private readonly limit: number;
	private buffer = "";

	constructor(limit: number) {
		this.limit = limit;
	}

	push(data: Buffer): void {
		const text = sanitizeBinaryOutput(stripAnsi(this.decoder.decode(data, { stream: true }))).replace(/\r/g, "");
		this.buffer = (this.buffer + text).slice(-this.limit * 2);
	}

	text(): string {
		return redactSensitiveTextForced(this.buffer).slice(-this.limit).trim();
	}
}
