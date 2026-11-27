import fs from "node:fs";
import path from "node:path";
import { summarizeTurnMetrics, type TurnMetricsSummary } from "./turn-metrics.ts";
import { parseTurnMetricRecord } from "./turn-metrics-record.ts";

export type TurnMetricsScopeStatus = "empty" | "complete" | "partial" | "error";

export interface TurnMetricsFileError {
	readonly path: string;
	readonly code: string;
	readonly message: string;
}

export interface TurnMetricsScope {
	readonly status: TurnMetricsScopeStatus;
	readonly includedFiles: readonly string[];
	readonly failedFiles: readonly TurnMetricsFileError[];
	readonly periodStart?: string;
	readonly periodEnd?: string;
}

export interface TurnMetricsDirectoryResult {
	readonly summary: TurnMetricsSummary;
	readonly scope: TurnMetricsScope;
}

function errorCode(error: unknown): string {
	if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
		return error.code;
	}
	return "UNKNOWN";
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Read active and rotated turn-metrics JSONL files (`turns.jsonl.1`, `turns.jsonl`),
 * distinguishing empty state, file read errors, partial aggregation, included files,
 * and the observed timestamp period.
 */
export function summarizeTurnMetricsDirectory(dirPath: string, fileName = "turns.jsonl"): TurnMetricsDirectoryResult {
	const resolvedDir = path.resolve(dirPath);
	const candidates = [path.join(resolvedDir, `${fileName}.1`), path.join(resolvedDir, fileName)];
	const includedFiles: string[] = [];
	const failedFiles: TurnMetricsFileError[] = [];
	const lines: string[] = [];

	for (const candidate of candidates) {
		try {
			const raw = fs.readFileSync(candidate, "utf8");
			includedFiles.push(candidate);
			for (const line of raw.split("\n")) lines.push(line);
		} catch (error) {
			const code = errorCode(error);
			if (code === "ENOENT") continue;
			failedFiles.push({ path: candidate, code, message: errorMessage(error) });
		}
	}

	const summary = summarizeTurnMetrics(lines);

	let minStartMs: number | undefined;
	let maxEndMs: number | undefined;
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		const record = parseTurnMetricRecord(trimmed);
		if (!record) continue;
		if (minStartMs === undefined || record.startedAtEpochMs < minStartMs) minStartMs = record.startedAtEpochMs;
		if (maxEndMs === undefined || record.endedAtEpochMs > maxEndMs) maxEndMs = record.endedAtEpochMs;
	}

	let status: TurnMetricsScopeStatus;
	if (failedFiles.length > 0 && includedFiles.length === 0) {
		status = "error";
	} else if (failedFiles.length === 0 && summary.turns === 0 && summary.malformedLines === 0) {
		status = "empty";
	} else if (failedFiles.length > 0 || summary.malformedLines > 0) {
		status = "partial";
	} else {
		status = "complete";
	}

	return {
		summary,
		scope: {
			status,
			includedFiles,
			failedFiles,
			...(minStartMs !== undefined ? { periodStart: new Date(minStartMs).toISOString() } : {}),
			...(maxEndMs !== undefined ? { periodEnd: new Date(maxEndMs).toISOString() } : {}),
		},
	};
}
