import { detectIdenticalLoop, type LoopDetection, type LoopRecord } from "./identical-loop.ts";

/** Calibrated on R7 omk trajectories (B_bal): early steers on regex-chess-r2, low pass FP. */
export const PROGRESS_STALL_WINDOW = 32;
export const PROGRESS_STALL_SIMILARITY = 0.65;
export const PROGRESS_STALL_SIMILAR_NEED = 6;
export const PROGRESS_STALL_NO_PROGRESS_AFTER = 12;
export const PROGRESS_STALL_STEER_EVERY = 12;
/** Steer message switches to save/verify when remaining budget fraction is below this. */
export const PROGRESS_STALL_LOW_BUDGET_FRACTION = 0.2;

const FILE_MUTATING_TOOLS: ReadonlySet<string> = new Set(["edit", "write"]);
const BASH_LIKE_TOOLS: ReadonlySet<string> = new Set(["bash", "shell"]);
const TOKEN_RE = /[A-Za-z_]{2,}|\d+/g;

export interface StallRecord extends LoopRecord {
	/** Set after a successful edit/write tool_result. */
	readonly fileMutated?: boolean;
	/** Truncated error text from a failing tool_result, when present. */
	readonly errorSummary?: string;
}

export interface ProgressStallPolicy {
	readonly windowSize?: number;
	readonly similarityThreshold?: number;
	readonly similarNeed?: number;
	readonly noProgressAfter?: number;
	readonly warnAfter?: number;
	readonly stopAfter?: number;
}

export type ProgressStallDetection =
	| LoopDetection
	| {
			readonly kind: "steer";
			readonly toolName: string;
			readonly similarCount: number;
			readonly noProgressCalls: number;
	  };

export function isFileMutatingTool(toolName: string): boolean {
	return FILE_MUTATING_TOOLS.has(toolName);
}

export function isBashLikeTool(toolName: string): boolean {
	return BASH_LIKE_TOOLS.has(toolName);
}

/** Collapse whitespace, mask numbers / quoted strings / deep path tails for near-dup compare. */
export function normalizeBashCommand(command: string): string {
	let text = command.trim().replace(/\s+/g, " ");
	text = text.replace(/'([^'\\]|\\.)*'|"([^"\\]|\\.)*"/g, "STR");
	text = text.replace(/\b\d+\b/g, "N");
	text = text.replace(/(\/[\w.-]+){3,}/g, "/PATH");
	return text.slice(0, 400);
}

export function nearDuplicateSignature(record: LoopRecord): string {
	if (isBashLikeTool(record.toolName) && record.args && typeof record.args === "object") {
		const command = (record.args as { command?: unknown }).command;
		if (typeof command === "string") return `${record.toolName}:${normalizeBashCommand(command)}`;
	}
	if (isFileMutatingTool(record.toolName) && record.args && typeof record.args === "object") {
		const path = String((record.args as { path?: unknown }).path ?? "");
		return `${record.toolName}:${path.replace(/(\/[\w.-]+){2,}/g, "/PATH")}`;
	}
	return `${record.toolName}:${stableJson(record.args)}`.slice(0, 220);
}

export function tokenSet(text: string): ReadonlySet<string> {
	const out = new Set<string>();
	TOKEN_RE.lastIndex = 0;
	for (const match of text.toLowerCase().matchAll(TOKEN_RE)) {
		if (match[0]) out.add(match[0]);
	}
	return out;
}

export function jaccardSimilarity(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
	if (left === right || (left.size === 0 && right.size === 0)) return 1;
	if (left.size === 0 || right.size === 0) return 0;
	let intersection = 0;
	for (const token of left) {
		if (right.has(token)) intersection += 1;
	}
	return intersection / (left.size + right.size - intersection);
}

export function signatureSimilarity(left: string, right: string): number {
	if (left === right) return 1;
	return jaccardSimilarity(tokenSet(left), tokenSet(right));
}

function stableJson(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
	const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
	return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`).join(",")}}`;
}

/** Prior `noProgressAfter` calls before `latestIndex` show no successful edit/write. */
function hasNoProgress(records: readonly StallRecord[], latestIndex: number, noProgressAfter: number): boolean {
	if (latestIndex < noProgressAfter) return false;
	const start = latestIndex - noProgressAfter;
	let fileMutations = 0;
	const errorSummaries: string[] = [];
	for (let index = start; index < latestIndex; index += 1) {
		const record = records[index];
		if (!record) continue;
		if (record.fileMutated) fileMutations += 1;
		if (record.errorSummary) errorSummaries.push(record.errorSummary);
	}
	if (fileMutations === 0) return true;
	if (errorSummaries.length >= 3 && new Set(errorSummaries).size === 1) return true;
	return false;
}

function countSimilarBash(
	records: readonly StallRecord[],
	latestIndex: number,
	windowSize: number,
	similarityThreshold: number,
): number {
	const latest = records[latestIndex];
	if (!latest || !isBashLikeTool(latest.toolName)) return 0;
	const latestSig = nearDuplicateSignature(latest);
	const start = Math.max(0, latestIndex - windowSize + 1);
	let count = 0;
	for (let index = start; index <= latestIndex; index += 1) {
		const record = records[index];
		if (!record || !isBashLikeTool(record.toolName)) continue;
		if (signatureSimilarity(nearDuplicateSignature(record), latestSig) >= similarityThreshold) count += 1;
	}
	return count;
}

/**
 * Exact consecutive identical calls still warn/stop. Near-duplicate bash calls
 * without recent successful edit/write progress yield a steer (never a block).
 */
export function detectProgressStall(
	records: readonly StallRecord[],
	policy: ProgressStallPolicy = {},
): ProgressStallDetection | undefined {
	const warnAfter = policy.warnAfter ?? 3;
	const stopAfter = policy.stopAfter ?? 6;
	const exact = detectIdenticalLoop(records, { warnAfter, stopAfter });
	if (exact) return exact;

	const windowSize = policy.windowSize ?? PROGRESS_STALL_WINDOW;
	const similarityThreshold = policy.similarityThreshold ?? PROGRESS_STALL_SIMILARITY;
	const similarNeed = policy.similarNeed ?? PROGRESS_STALL_SIMILAR_NEED;
	const noProgressAfter = policy.noProgressAfter ?? PROGRESS_STALL_NO_PROGRESS_AFTER;
	if (records.length === 0) return undefined;
	const latestIndex = records.length - 1;
	const latest = records[latestIndex];
	if (!latest || !isBashLikeTool(latest.toolName)) return undefined;
	const similarCount = countSimilarBash(records, latestIndex, windowSize, similarityThreshold);
	if (similarCount < similarNeed) return undefined;
	if (!hasNoProgress(records, latestIndex, noProgressAfter)) return undefined;
	return {
		kind: "steer",
		toolName: latest.toolName,
		similarCount,
		noProgressCalls: noProgressAfter,
	};
}

/** Keep only the last `windowSize` records (ring buffer). Mutates `records`. */
export function trimStallRecords(records: StallRecord[], windowSize: number = PROGRESS_STALL_WINDOW): void {
	if (records.length > windowSize) records.splice(0, records.length - windowSize);
}
