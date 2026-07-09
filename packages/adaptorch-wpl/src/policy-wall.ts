/**
 * Local Fast Wall — diff scope and evidence stubs before or alongside OA adjudication.
 */

export const POLICY_FLAG = {
	NON_NEGOTIABLE_BLOCKING: "NON_NEGOTIABLE_BLOCKING",
	/** Diff lines suggest credentials or env secrets (maps to blocking). */
	SECRET_SUSPECT: "SECRET_SUSPECT",
	CANDIDATE_LEAK_SUSPECT: "CANDIDATE_LEAK_SUSPECT",
	EVIDENCE_DAG_INCOMPLETE: "EVIDENCE_DAG_INCOMPLETE",
	REPRO_OVERFIT_SUSPECT: "REPRO_OVERFIT_SUSPECT",
	LOW_DISCRIMINATION: "LOW_DISCRIMINATION",
} as const;

export type PolicyFlag = (typeof POLICY_FLAG)[keyof typeof POLICY_FLAG];

const SECRET_LINE_PATTERNS: RegExp[] = [
	/\.env(?:\.|$|\b)/i,
	/BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/i,
	/api[_-]?key\s*=/i,
	/secret[_-]?key\s*=/i,
	/password\s*=/i,
	// Common provider token shapes (discrimination vs plain identifiers).
	/\bsk-(?:ant|proj|live|test)[-a-z0-9_]{8,}/i,
	/\bsk-[a-z0-9]{20,}/i,
	/\bghp_[A-Za-z0-9]{20,}/,
	/\bxox[baprs]-[A-Za-z0-9-]{10,}/,
];

/** Scan added/changed diff lines for secret-like content. */
export function scanDiffLinesForSecrets(diffText: string | undefined): boolean {
	if (diffText === undefined || diffText.trim() === "") {
		return false;
	}
	for (const line of diffText.split(/\r?\n/)) {
		if (!line.startsWith("+") || line.startsWith("+++")) {
			continue;
		}
		const body = line.slice(1);
		for (const pattern of SECRET_LINE_PATTERNS) {
			if (pattern.test(body)) {
				return true;
			}
		}
	}
	return false;
}

export interface FastWallInput {
	diffText?: string;
	approvedWriteScope?: string[];
	/** Non-empty run ids expected when not in preview-only mode. */
	runIds?: string[];
	previewOnly?: boolean;
}

export interface FastWallResult {
	flags: PolicyFlag[];
	diffPaths: string[];
}

/** Parse changed file paths from a unified diff text. */
export function parseDiffPaths(diffText: string | undefined): string[] {
	if (diffText === undefined || diffText.trim() === "") {
		return [];
	}
	const paths = new Set<string>();
	const lines = diffText.split(/\r?\n/);
	for (const line of lines) {
		if (line.startsWith("+++ ")) {
			const raw = line.slice(4).trim();
			if (raw === "/dev/null") continue;
			const path = raw.startsWith("b/") ? raw.slice(2) : raw;
			if (path.length > 0) paths.add(path);
		}
	}
	return [...paths].sort();
}

function normalizePathForMatch(path: string): string {
	return path.replace(/\\/g, "/");
}

/**
 * Simple glob: double-star suffix patterns and directory prefix rules.
 */
export function pathMatchesApprovedScope(filePath: string, approvedWriteScope: string[]): boolean {
	const normalized = normalizePathForMatch(filePath);
	for (const pattern of approvedWriteScope) {
		const p = normalizePathForMatch(pattern.trim());
		if (p.length === 0) continue;
		if (p.endsWith("/**")) {
			const prefix = p.slice(0, -3);
			if (prefix === "" || normalized === prefix || normalized.startsWith(`${prefix}/`)) {
				return true;
			}
			continue;
		}
		if (p.includes("**")) {
			const [head] = p.split("**");
			const prefix = head.endsWith("/") ? head.slice(0, -1) : head;
			if (prefix === "" || normalized === prefix || normalized.startsWith(`${prefix}/`)) {
				return true;
			}
			continue;
		}
		if (normalized === p || normalized.startsWith(`${p}/`)) {
			return true;
		}
	}
	return false;
}

export function runFastWall(input: FastWallInput): FastWallResult {
	const flags: PolicyFlag[] = [];
	const diffPaths = parseDiffPaths(input.diffText);
	const scope = input.approvedWriteScope ?? [];
	const previewOnly = input.previewOnly === true;
	const runIds = input.runIds ?? [];

	if (diffPaths.length === 0 && input.diffText !== undefined && input.diffText.trim() !== "") {
		// diff present but no paths parsed — treat as inconclusive via caller, not a flag here
	}

	if (scope.length > 0 && diffPaths.length > 0) {
		const outOfScope = diffPaths.filter((p) => !pathMatchesApprovedScope(p, scope));
		if (outOfScope.length > 0) {
			flags.push(POLICY_FLAG.CANDIDATE_LEAK_SUSPECT);
			flags.push(POLICY_FLAG.NON_NEGOTIABLE_BLOCKING);
		}
	}

	const expectsRunEvidence = runIds.length > 0 && !previewOnly;
	if (expectsRunEvidence) {
		flags.push(POLICY_FLAG.EVIDENCE_DAG_INCOMPLETE);
	}

	if (previewOnly) {
		flags.push(POLICY_FLAG.REPRO_OVERFIT_SUSPECT);
		flags.push(POLICY_FLAG.LOW_DISCRIMINATION);
	}

	if (scanDiffLinesForSecrets(input.diffText)) {
		flags.push(POLICY_FLAG.SECRET_SUSPECT);
		flags.push(POLICY_FLAG.NON_NEGOTIABLE_BLOCKING);
	}

	return { flags, diffPaths };
}
