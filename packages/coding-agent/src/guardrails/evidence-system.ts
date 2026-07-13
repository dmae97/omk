// allow: SIZE_OK - evidence ledger guardrails: tamper-evident replay chain + fail-closed parsing.
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
	EvidenceItem,
	EvidenceStatus,
	MergeGateResult,
	MergeGateStatus,
	ReplayEvent,
	ReplayLedger,
	TaskContract,
} from "../types/evidence.ts";

function sha256(input: string): string {
	return createHash("sha256").update(input).digest("hex");
}

function ensureDir(path: string): void {
	const dir = dirname(path);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
}

// ============================================================================
// TaskContract
// ============================================================================

export class TaskContractBuilder {
	private goalId: string;
	private completionClaim: string = "";
	private requiredEvidence: EvidenceItem[] = [];
	private finalRisk: string = "";
	private verdict: "pass" | "fail" | "conditional" = "fail";
	private createdAt: string;
	private updatedAt: string;

	constructor(goalId: string) {
		this.goalId = goalId;
		const now = new Date().toISOString();
		this.createdAt = now;
		this.updatedAt = now;
	}

	setClaim(claim: string): this {
		this.completionClaim = claim;
		this.touch();
		return this;
	}

	addRequiredEvidence(evidence: Omit<EvidenceItem, "timestamp" | "status">): this {
		this.requiredEvidence.push({
			...evidence,
			timestamp: new Date().toISOString(),
			status: "pending",
		});
		this.touch();
		return this;
	}

	setFinalRisk(risk: string): this {
		this.finalRisk = risk;
		this.touch();
		return this;
	}

	setVerdict(verdict: "pass" | "fail" | "conditional"): this {
		this.verdict = verdict;
		this.touch();
		return this;
	}

	updateEvidenceStatus(claim: string, status: EvidenceStatus, gapReason?: string): this {
		const item = this.requiredEvidence.find((e) => e.claim === claim);
		if (item) {
			item.status = status;
			item.gapReason = gapReason;
			item.timestamp = new Date().toISOString();
			this.touch();
		}
		return this;
	}

	private touch(): void {
		this.updatedAt = new Date().toISOString();
	}

	build(): TaskContract {
		return structuredClone({
			goalId: this.goalId,
			completionClaim: this.completionClaim,
			requiredEvidence: this.requiredEvidence,
			finalRisk: this.finalRisk,
			verdict: this.verdict,
			createdAt: this.createdAt,
			updatedAt: this.updatedAt,
		});
	}

	/** Parse and validate a serialized TaskContract. Fails closed on any shape violation. */
	static fromJSON(json: string): TaskContract {
		const raw: unknown = JSON.parse(json);
		if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
			throw new Error("TaskContract JSON must be an object");
		}
		const { goalId, completionClaim, finalRisk, verdict, createdAt, updatedAt, requiredEvidence } = raw as Record<
			string,
			unknown
		>;
		if (
			typeof goalId !== "string" ||
			typeof completionClaim !== "string" ||
			typeof finalRisk !== "string" ||
			typeof createdAt !== "string" ||
			typeof updatedAt !== "string"
		) {
			throw new Error("TaskContract JSON has missing or mistyped string fields");
		}
		if (verdict !== "pass" && verdict !== "fail" && verdict !== "conditional") {
			throw new Error(`TaskContract verdict must be pass|fail|conditional, got ${String(verdict)}`);
		}
		if (!Array.isArray(requiredEvidence)) {
			throw new Error("TaskContract requiredEvidence must be an array");
		}
		return {
			goalId,
			completionClaim,
			finalRisk,
			verdict,
			createdAt,
			updatedAt,
			requiredEvidence: requiredEvidence.map((item, index) => parseEvidenceItem(item, index)),
		};
	}

	static toJSON(contract: TaskContract): string {
		return JSON.stringify(contract, null, 2);
	}
}

const EVIDENCE_STATUSES: ReadonlySet<string> = new Set(["pending", "gathering", "satisfied", "failed", "waived"]);

function optionalStringField(value: unknown, field: string, index: number): string | undefined {
	if (value !== undefined && typeof value !== "string") {
		throw new Error(`TaskContract evidence[${index}].${field} must be a string when present`);
	}
	return value;
}

function parseEvidenceItem(raw: unknown, index: number): EvidenceItem {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
		throw new Error(`TaskContract evidence[${index}] must be an object`);
	}
	const item = raw as Record<string, unknown>;
	const { claim, category, timestamp, status } = item;
	if (typeof claim !== "string" || typeof category !== "string" || typeof timestamp !== "string") {
		throw new Error(`TaskContract evidence[${index}] has missing or mistyped fields`);
	}
	if (typeof status !== "string" || !EVIDENCE_STATUSES.has(status)) {
		throw new Error(`TaskContract evidence[${index}] has invalid status ${String(status)}`);
	}
	return {
		claim,
		category: category as EvidenceItem["category"],
		timestamp,
		status: status as EvidenceStatus,
		artifactPath: optionalStringField(item.artifactPath, "artifactPath", index),
		verificationCommand: optionalStringField(item.verificationCommand, "verificationCommand", index),
		hash: optionalStringField(item.hash, "hash", index),
		gapReason: optionalStringField(item.gapReason, "gapReason", index),
	};
}

// ============================================================================
// ReplayLedger
// ============================================================================

/** prevHash sentinel for the first event in a replay chain. */
const GENESIS_HASH = "genesis";

function computeEventHash(event: Omit<ReplayEvent, "eventHash">): string {
	return sha256(
		JSON.stringify([
			event.seq,
			event.type,
			event.timestamp,
			event.goalId,
			event.laneId ?? null,
			event.payloadHash,
			event.prevHash,
		]),
	);
}

function parseReplayEventLine(line: string, lineNumber: number): ReplayEvent {
	let raw: unknown;
	try {
		raw = JSON.parse(line);
	} catch {
		throw new Error(`Replay ledger corrupted at line ${lineNumber}: invalid JSON`);
	}
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
		throw new Error(`Replay ledger corrupted at line ${lineNumber}: event must be an object`);
	}
	const event = raw as Record<string, unknown>;
	const { seq, type, timestamp, goalId, laneId, payloadHash, prevHash, eventHash } = event;
	if (
		typeof seq !== "number" ||
		typeof type !== "string" ||
		typeof timestamp !== "string" ||
		typeof goalId !== "string" ||
		typeof payloadHash !== "string" ||
		typeof prevHash !== "string" ||
		typeof eventHash !== "string" ||
		(laneId !== undefined && typeof laneId !== "string") ||
		!("payload" in event)
	) {
		throw new Error(`Replay ledger corrupted at line ${lineNumber}: event fields are missing or mistyped`);
	}
	return {
		seq,
		type: type as ReplayEvent["type"],
		timestamp,
		goalId,
		laneId,
		payload: event.payload,
		payloadHash,
		prevHash,
		eventHash,
	};
}

export class ReplayLedgerManager {
	private ledger: ReplayLedger;
	private nextSeq: number;

	constructor(goalId: string, ledgerPath: string) {
		ensureDir(ledgerPath);
		this.ledger = {
			goalId,
			events: [],
			ledgerPath,
			lastPersistedSeq: 0,
		};
		this.nextSeq = 1;
		if (existsSync(ledgerPath)) {
			this.load();
		}
	}

	append(event: Omit<ReplayEvent, "seq" | "timestamp" | "payloadHash" | "prevHash" | "eventHash">): ReplayEvent {
		const payloadStr = JSON.stringify(event.payload);
		const previous = this.ledger.events[this.ledger.events.length - 1];
		const chained: Omit<ReplayEvent, "eventHash"> = {
			...event,
			seq: this.nextSeq++,
			timestamp: new Date().toISOString(),
			payloadHash: sha256(payloadStr),
			prevHash: previous ? previous.eventHash : GENESIS_HASH,
		};
		const fullEvent: ReplayEvent = { ...chained, eventHash: computeEventHash(chained) };
		this.ledger.events.push(fullEvent);
		return fullEvent;
	}

	persist(): void {
		if (this.ledger.events.length === 0) return;
		const last = this.ledger.events[this.ledger.events.length - 1];
		if (last.seq <= this.ledger.lastPersistedSeq) return;

		const newEvents = this.ledger.events.filter((e) => e.seq > this.ledger.lastPersistedSeq);
		const lines = `${newEvents.map((e) => JSON.stringify(e)).join("\n")}\n`;
		appendFileSync(this.ledger.ledgerPath, lines, "utf-8");
		this.ledger.lastPersistedSeq = last.seq;
	}

	/**
	 * Load and verify the persisted ledger. Fails closed: any schema violation,
	 * sequence gap, payload-hash mismatch, or broken event-hash chain throws, so
	 * a tampered ledger (edited, deleted, inserted, or reordered lines) is never
	 * loaded silently.
	 */
	load(): void {
		if (!existsSync(this.ledger.ledgerPath)) return;
		const content = readFileSync(this.ledger.ledgerPath, "utf-8");
		const lines = content.split("\n").filter((line) => line.trim().length > 0);
		const events: ReplayEvent[] = [];
		let prevHash = GENESIS_HASH;
		for (let index = 0; index < lines.length; index++) {
			const event = parseReplayEventLine(lines[index], index + 1);
			if (event.seq !== index + 1) {
				throw new Error(
					`Replay ledger corrupted at line ${index + 1}: expected seq ${index + 1}, got ${event.seq}`,
				);
			}
			if (event.prevHash !== prevHash) {
				throw new Error(
					`Replay ledger chain broken at line ${index + 1}: an event was inserted, deleted, or reordered`,
				);
			}
			if (sha256(JSON.stringify(event.payload)) !== event.payloadHash) {
				throw new Error(`Replay ledger payload tampered at line ${index + 1} (seq ${event.seq})`);
			}
			if (computeEventHash(event) !== event.eventHash) {
				throw new Error(`Replay ledger event hash mismatch at line ${index + 1} (seq ${event.seq})`);
			}
			prevHash = event.eventHash;
			events.push(event);
		}
		this.ledger.events = events;
		this.ledger.lastPersistedSeq = events.length > 0 ? events[events.length - 1].seq : 0;
		this.nextSeq = this.ledger.lastPersistedSeq + 1;
	}

	getEvents(): ReadonlyArray<ReplayEvent> {
		return structuredClone(this.ledger.events);
	}

	getLedger(): Readonly<ReplayLedger> {
		return structuredClone(this.ledger);
	}

	replay<T>(handler: (event: ReplayEvent) => T | undefined): T[] {
		const results: T[] = [];
		for (const event of this.ledger.events) {
			const result = handler(event);
			if (result !== undefined) {
				results.push(result);
			}
		}
		return results;
	}

	exportToFile(path: string): void {
		ensureDir(path);
		writeFileSync(path, JSON.stringify(this.ledger.events, null, 2), "utf-8");
	}
}

// ============================================================================
// EvidenceGate
// ============================================================================

export interface EvidenceGateOptions {
	/** Minimum number of satisfied evidence items required. */
	minEvidenceCount?: number;
	/** Require at least one artifact with a SHA-256 hash. */
	requireHash?: boolean;
	/** Require at least one verification command. */
	requireVerificationCommand?: boolean;
}

export class EvidenceGate {
	private options: EvidenceGateOptions;

	constructor(options: EvidenceGateOptions = {}) {
		this.options = {
			minEvidenceCount: 1,
			requireHash: true,
			requireVerificationCommand: true,
			...options,
		};
	}

	check(contract: TaskContract): MergeGateResult {
		const evidence = contract.requiredEvidence;
		const satisfied = evidence.filter((e) => e.status === "satisfied");
		const failed = evidence.filter((e) => e.status === "failed");
		const pending = evidence.filter((e) => e.status === "pending" || e.status === "gathering");

		const checks: string[] = [];

		// Check 1: minimum evidence count
		if (satisfied.length < (this.options.minEvidenceCount ?? 1)) {
			checks.push(`Only ${satisfied.length}/${this.options.minEvidenceCount} required evidence items satisfied.`);
		}

		// Check 2: no failed evidence
		if (failed.length > 0) {
			checks.push(`${failed.length} evidence item(s) failed.`);
		}

		// Check 3: require hash
		if (this.options.requireHash) {
			const hashed = satisfied.filter((e) => e.hash && e.hash.length > 0);
			if (hashed.length === 0) {
				checks.push("No satisfied evidence has a SHA-256 hash.");
			}
		}

		// Check 4: require verification command
		if (this.options.requireVerificationCommand) {
			const withCommand = satisfied.filter((e) => e.verificationCommand && e.verificationCommand.length > 0);
			if (withCommand.length === 0) {
				checks.push("No satisfied evidence has a verification command.");
			}
		}

		// Check 5: contract verdict
		if (contract.verdict === "fail") {
			checks.push("Task contract verdict is 'fail'.");
		}

		let status: MergeGateStatus;
		let reason: string;
		let suggestion: string | undefined;

		if (checks.length === 0) {
			status = "open";
			reason = `Evidence gate passed: ${satisfied.length}/${evidence.length} evidence items satisfied.`;
		} else {
			// If there are pending items and no hard failures, it's conditional; otherwise blocked
			const hasHardFailure = failed.length > 0 || contract.verdict === "fail";
			status = pending.length > 0 && !hasHardFailure ? "conditional" : "blocked";
			reason = checks.join("; ");
			suggestion = `Gather remaining evidence (${pending.length} pending) and re-run verification.`;
		}

		return {
			gateId: "evidence-gate",
			status,
			reason,
			suggestion,
			evidenceChecked: evidence,
		};
	}
}

// ============================================================================
// FailClosedMergeGate
// ============================================================================

export class FailClosedMergeGate {
	private gates: EvidenceGate[];

	constructor(gates: EvidenceGate[] = [new EvidenceGate()]) {
		this.gates = gates;
	}

	check(contract: TaskContract): MergeGateResult {
		const results = this.gates.map((gate) => gate.check(contract));
		const blocked = results.filter((r) => r.status === "blocked");
		const conditional = results.filter((r) => r.status === "conditional");

		if (blocked.length > 0) {
			return {
				gateId: "fail-closed-merge-gate",
				status: "blocked",
				reason: `Blocked by ${blocked.length} gate(s): ${blocked.map((b) => b.reason).join("; ")}`,
				suggestion: "Resolve all blocking conditions before merge.",
				evidenceChecked: contract.requiredEvidence,
			};
		}

		if (conditional.length > 0) {
			return {
				gateId: "fail-closed-merge-gate",
				status: "conditional",
				reason: `Conditional pass: ${conditional.length} gate(s) have pending conditions.`,
				suggestion: "Complete pending evidence or waive with explicit approval.",
				evidenceChecked: contract.requiredEvidence,
			};
		}

		return {
			gateId: "fail-closed-merge-gate",
			status: "open",
			reason: "All merge gates passed. Evidence verified and contract verdict is acceptable.",
			evidenceChecked: contract.requiredEvidence,
		};
	}
}

// ============================================================================
// Verify Reporter v2
// ============================================================================

/** Escape pipes/newlines so untrusted claim or command text cannot restructure the report table. */
function escapeTableCell(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

export interface VerifyReporterV2Options {
	outputDir: string;
	goalId: string;
}

export class VerifyReporterV2 {
	private options: VerifyReporterV2Options;

	constructor(options: VerifyReporterV2Options) {
		this.options = options;
	}

	render(contract: TaskContract, mergeGate: MergeGateResult): string {
		const lines: string[] = [
			`## OMK Verification Report v2 — ${contract.goalId}`,
			"",
			"### Contract",
			"",
			`| Field | Value |`,
			`|-------|-------|`,
			`| Claim | ${escapeTableCell(contract.completionClaim)} |`,
			`| Verdict | ${contract.verdict} |`,
			`| Final Risk | ${escapeTableCell(contract.finalRisk)} |`,
			"",
			"### Evidence",
			"",
			`| Claim | Status | Artifact | Command |`,
			`|-------|--------|----------|----------|`,
		];

		for (const ev of contract.requiredEvidence) {
			lines.push(
				`| ${escapeTableCell(ev.claim)} | ${ev.status} | ${escapeTableCell(ev.artifactPath ?? "—")} | ${escapeTableCell(ev.verificationCommand ?? "—")} |`,
			);
		}

		lines.push(
			"",
			"### Merge Gate",
			"",
			`| Gate | Status | Reason |`,
			`|------|--------|--------|`,
			`| ${mergeGate.gateId} | ${mergeGate.status} | ${escapeTableCell(mergeGate.reason)} |`,
			"",
		);

		if (mergeGate.suggestion) {
			lines.push(`**Suggestion:** ${mergeGate.suggestion}`, "");
		}

		return lines.join("\n");
	}

	write(contract: TaskContract, mergeGate: MergeGateResult): string {
		const markdown = this.render(contract, mergeGate);
		const path = join(this.options.outputDir, `${this.options.goalId}.verify.md`);
		ensureDir(path);
		writeFileSync(path, markdown, "utf-8");
		return path;
	}
}
