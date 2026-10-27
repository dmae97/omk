/** Output parsers for the project checkers (split from diagnostics-checkers.ts for module size). */
export interface DiagnosticLine {
	readonly language: string;
	readonly severity: "error" | "warning" | "info";
	readonly path: string;
	readonly line: number;
	readonly column: number;
	readonly message: string;
}

const TS_ERROR = /^(?<path>.+?)\((?<line>\d+),(?<col>\d+)\): error TS\d+: (?<msg>.+)$/;

export function parseTsc(out: string, language: string): DiagnosticLine[] {
	const lines: DiagnosticLine[] = [];
	for (const raw of out.split("\n")) {
		const match = TS_ERROR.exec(raw.trim());
		if (match?.groups) {
			lines.push({
				language,
				severity: "error",
				path: match.groups.path,
				line: Number(match.groups.line),
				column: Number(match.groups.col),
				message: match.groups.msg.trim(),
			});
		}
	}
	return lines;
}

const PYRIGHT_ISSUE = /^(?<path>.+?):(?<line>\d+):(?<col>\d+) - (?<sev>error|warning|information): (?<msg>.+)$/;

export function parsePyright(out: string): DiagnosticLine[] {
	const lines: DiagnosticLine[] = [];
	// pyright --outputjson wraps issues in JSON; fall back to the text form when absent.
	try {
		const parsed = JSON.parse(out) as {
			generalDiagnostics?: {
				file: string;
				severity: string;
				range: { start: { line: number; character: number } };
				message: string;
			}[];
		};
		for (const issue of parsed.generalDiagnostics ?? []) {
			lines.push({
				language: "python",
				severity: issue.severity === "error" ? "error" : issue.severity === "warning" ? "warning" : "info",
				path: issue.file,
				line: issue.range.start.line + 1,
				column: issue.range.start.character + 1,
				message: issue.message,
			});
		}
		return lines;
	} catch {
		for (const raw of out.split("\n")) {
			const match = PYRIGHT_ISSUE.exec(raw.trim());
			if (match?.groups) {
				lines.push({
					language: "python",
					severity: match.groups.sev === "error" ? "error" : match.groups.sev === "warning" ? "warning" : "info",
					path: match.groups.path,
					line: Number(match.groups.line),
					column: Number(match.groups.col),
					message: match.groups.msg.trim(),
				});
			}
		}
		return lines;
	}
}

const RUFF_ISSUE = /^(?<path>.+?):(?<line>\d+):(?<col>\d+): (?<msg>.+)$/;

export function parseRuff(out: string): DiagnosticLine[] {
	const lines: DiagnosticLine[] = [];
	for (const raw of out.split("\n")) {
		const match = RUFF_ISSUE.exec(raw.trim());
		if (match?.groups) {
			lines.push({
				language: "python",
				severity: "warning",
				path: match.groups.path,
				line: Number(match.groups.line),
				column: Number(match.groups.col),
				message: match.groups.msg.trim(),
			});
		}
	}
	return lines;
}

const GO_VET = /^(?:#\s+\S+\s+)?(?<path>.+?\.go):(?<line>\d+):(?<col>\d+): (?<msg>.+)$/;

export function parseGoVet(out: string): DiagnosticLine[] {
	const lines: DiagnosticLine[] = [];
	for (const raw of out.split("\n")) {
		const match = GO_VET.exec(raw.trim());
		if (match?.groups) {
			lines.push({
				language: "go",
				severity: "error",
				path: match.groups.path,
				line: Number(match.groups.line),
				column: Number(match.groups.col),
				message: match.groups.msg.trim(),
			});
		}
	}
	return lines;
}

const CARGO_SHORT = /^(?<path>.+?):(?<line>\d+):(?<col>\d+): (?<msg>.+)$/;

export function parseCargo(out: string): DiagnosticLine[] {
	const lines: DiagnosticLine[] = [];
	for (const raw of out.split("\n")) {
		const match = CARGO_SHORT.exec(raw.trim());
		if (match?.groups) {
			const sev = match.groups.msg.startsWith("warning") ? "warning" : "error";
			lines.push({
				language: "rust",
				severity: sev,
				path: match.groups.path,
				line: Number(match.groups.line),
				column: Number(match.groups.col),
				message: match.groups.msg.trim(),
			});
		}
	}
	return lines;
}
