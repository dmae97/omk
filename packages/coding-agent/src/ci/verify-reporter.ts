import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface OmkVerifyResult {
	goalId: string;
	status: "completed" | "failed" | "blocked" | "partial";
	summary: string;
	changedFiles: string[];
	evidence: string[];
	risks: string[];
	nextAction: string;
}

export interface CiReport {
	goalId: string;
	status: string;
	summary: string;
	changedFilesCount: number;
	evidenceCount: number;
	risks: string[];
	markdown: string;
}

export function loadVerifyResult(path: string): OmkVerifyResult {
	const raw = readFileSync(path, "utf-8");
	return JSON.parse(raw) as OmkVerifyResult;
}

export function renderCiReport(result: OmkVerifyResult): CiReport {
	const lines: string[] = [
		`## OMK Verification Report — ${result.goalId}`,
		"",
		`| Field | Value |`,
		`|-------|-------|`,
		`| Status | ${result.status} |`,
		`| Summary | ${result.summary} |`,
		`| Changed Files | ${result.changedFiles.length} |`,
		`| Evidence Artifacts | ${result.evidence.length} |`,
		"",
		"### Changed Files",
		result.changedFiles.length > 0 ? result.changedFiles.map((f) => `- \`${f}\``).join("\n") : "_None_",
		"",
		"### Evidence",
		result.evidence.length > 0 ? result.evidence.map((e) => `- \`${e}\``).join("\n") : "_None_",
		"",
		"### Risks",
		result.risks.length > 0 ? result.risks.map((r) => `- ${r}`).join("\n") : "_None identified_",
		"",
		"### Next Action",
		result.nextAction,
	];

	return {
		goalId: result.goalId,
		status: result.status,
		summary: result.summary,
		changedFilesCount: result.changedFiles.length,
		evidenceCount: result.evidence.length,
		risks: result.risks,
		markdown: lines.join("\n"),
	};
}

export function writeCiReport(inputPath: string, outputPath: string): CiReport {
	const result = loadVerifyResult(inputPath);
	const report = renderCiReport(result);
	const dir = dirname(outputPath);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	writeFileSync(outputPath, report.markdown, "utf-8");
	return report;
}
