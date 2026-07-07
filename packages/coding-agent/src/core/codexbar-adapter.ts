export type CodexBarProvider = string;

export type CodexBarUsageWindowSummary = {
	readonly usedPercent?: number;
	readonly resetsAt?: string;
};

export type CodexBarStatusSummary = {
	readonly indicator?: string;
	readonly description?: string;
	readonly url?: string;
};

export type CodexBarUsageSummary = {
	readonly provider: CodexBarProvider;
	readonly source?: string;
	readonly primary?: CodexBarUsageWindowSummary;
	readonly secondary?: CodexBarUsageWindowSummary;
	readonly creditsRemaining?: number;
	readonly updatedAt?: string;
	readonly status?: CodexBarStatusSummary;
};

export type CodexBarCostSummary = {
	readonly provider: CodexBarProvider;
	readonly source?: string;
	readonly sessionCostUSD?: number;
	readonly last30DaysCostUSD?: number;
	readonly totalCostUSD?: number;
	readonly totalTokens?: number;
	readonly updatedAt?: string;
};

export class CodexBarJsonError extends Error {
	readonly name = "CodexBarJsonError";
	readonly reason: string;
	readonly inputLength: number;

	constructor(reason: string, inputLength: number, options?: ErrorOptions) {
		super(reason, options);
		this.reason = reason;
		this.inputLength = inputLength;
	}
}

export class CodexBarUnsafeOutputError extends Error {
	readonly name = "CodexBarUnsafeOutputError";
	readonly jsonPath: string;

	constructor(jsonPath: string) {
		super(`CodexBar output contains a credential-like value at ${jsonPath}`);
		this.jsonPath = jsonPath;
	}
}

const REDACTED_FIELD_NAMES = [
	"accountEmail",
	"accountOrganization",
	"signedInEmail",
	"creditEvents",
	"dailyBreakdown",
] as const;

const SECRET_LIKE_VALUE_PATTERNS = [
	new RegExp(`${"Bear"}${"er"}\\s+\\S+`, "i"),
	new RegExp(`${"Cook"}${"ie"}:\\s*`, "i"),
	new RegExp(`\\b${"s"}${"k"}-[A-Za-z0-9_-]*`, "i"),
	new RegExp(`\\b${"g"}${"hp"}_[A-Za-z0-9_]+`, "i"),
	new RegExp(`\\b${"e"}${"y"}${"J"}[A-Za-z0-9_-]{8,}(?:\\.[A-Za-z0-9_-]+){0,2}\\b`),
] as const;

export function parseCodexBarUsageJson(stdout: string): CodexBarUsageSummary {
	const parsed = parseJson(stdout);
	if (!isRecord(parsed)) {
		throw new CodexBarJsonError("CodexBar usage JSON must be an object", stdout.length);
	}

	const usage = readRecord(parsed, "usage");
	const credits = readRecord(parsed, "credits");
	const statusRecord = readRecord(parsed, "status");
	const primary = usage ? parseUsageWindow(usage.primary) : undefined;
	const secondary = usage ? parseUsageWindow(usage.secondary) : undefined;
	const status = parseStatus(statusRecord);
	const source = readString(parsed, "source");
	const creditsRemaining = credits ? readNumber(credits, "remaining") : undefined;
	const updatedAt =
		(usage ? readString(usage, "updatedAt") : undefined) ??
		readString(parsed, "updatedAt") ??
		(credits ? readString(credits, "updatedAt") : undefined) ??
		(statusRecord ? readString(statusRecord, "updatedAt") : undefined);

	return {
		provider: readString(parsed, "provider") ?? "unknown",
		...(source === undefined ? {} : { source }),
		...(primary === undefined ? {} : { primary }),
		...(secondary === undefined ? {} : { secondary }),
		...(creditsRemaining === undefined ? {} : { creditsRemaining }),
		...(updatedAt === undefined ? {} : { updatedAt }),
		...(status === undefined ? {} : { status }),
	};
}

export function parseCodexBarCostJson(stdout: string): readonly CodexBarCostSummary[] {
	const parsed = parseJson(stdout);
	if (!isUnknownArray(parsed)) {
		throw new CodexBarJsonError("CodexBar cost JSON must be an array", stdout.length);
	}

	return parsed.map((entry) => {
		if (!isRecord(entry)) {
			throw new CodexBarJsonError("CodexBar cost entries must be objects", stdout.length);
		}
		return parseCostSummary(entry);
	});
}

export function redactCodexBarJson(value: unknown): unknown {
	return redactValue(value, undefined);
}

export function hasSecretLikeValue(value: unknown): boolean {
	return findUnsafeJsonPath(value, "$") !== undefined;
}

function parseJson(stdout: string): unknown {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stdout);
	} catch (error) {
		if (error instanceof SyntaxError) {
			throw new CodexBarJsonError("CodexBar output is not valid JSON", stdout.length, { cause: error });
		}
		throw error;
	}

	const unsafeJsonPath = findUnsafeJsonPath(parsed, "$.");
	if (unsafeJsonPath !== undefined) {
		throw new CodexBarUnsafeOutputError(unsafeJsonPath);
	}
	return parsed;
}

function parseUsageWindow(value: unknown): CodexBarUsageWindowSummary | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	const usedPercent = readNumber(value, "usedPercent");
	const resetsAt = readString(value, "resetsAt");
	if (usedPercent === undefined && resetsAt === undefined) {
		return undefined;
	}

	return {
		...(usedPercent === undefined ? {} : { usedPercent }),
		...(resetsAt === undefined ? {} : { resetsAt }),
	};
}

function parseStatus(value: Record<string, unknown> | undefined): CodexBarStatusSummary | undefined {
	if (value === undefined) {
		return undefined;
	}

	const indicator = readString(value, "indicator");
	const description = readString(value, "description");
	const url = readString(value, "url");
	if (indicator === undefined && description === undefined && url === undefined) {
		return undefined;
	}

	return {
		...(indicator === undefined ? {} : { indicator }),
		...(description === undefined ? {} : { description }),
		...(url === undefined ? {} : { url }),
	};
}

function parseCostSummary(entry: Record<string, unknown>): CodexBarCostSummary {
	const totals = readRecord(entry, "totals");
	const source = readString(entry, "source");
	const sessionCostUSD = readNumber(entry, "sessionCostUSD");
	const last30DaysCostUSD = readNumber(entry, "last30DaysCostUSD");
	const totalCostUSD = readNumber(entry, "totalCostUSD") ?? (totals ? readNumber(totals, "totalCost") : undefined);
	const totalTokens = readNumber(entry, "totalTokens") ?? (totals ? readNumber(totals, "totalTokens") : undefined);
	const updatedAt = readString(entry, "updatedAt");

	return {
		provider: readString(entry, "provider") ?? "unknown",
		...(source === undefined ? {} : { source }),
		...(sessionCostUSD === undefined ? {} : { sessionCostUSD }),
		...(last30DaysCostUSD === undefined ? {} : { last30DaysCostUSD }),
		...(totalCostUSD === undefined ? {} : { totalCostUSD }),
		...(totalTokens === undefined ? {} : { totalTokens }),
		...(updatedAt === undefined ? {} : { updatedAt }),
	};
}

function redactValue(value: unknown, parentKey: string | undefined): unknown {
	if (isUnknownArray(value)) {
		return value.map((item) => redactValue(item, parentKey));
	}
	if (!isRecord(value)) {
		return value;
	}

	const redacted: Record<string, unknown> = {};
	for (const [key, fieldValue] of Object.entries(value)) {
		if (shouldDropField(key, parentKey)) {
			continue;
		}
		redacted[key] = redactValue(fieldValue, key);
	}
	return redacted;
}

function shouldDropField(key: string, parentKey: string | undefined): boolean {
	if (REDACTED_FIELD_NAMES.some((fieldName) => fieldName === key)) {
		return true;
	}
	return parentKey === "projects" && (key === "path" || key === "name");
}

function findUnsafeJsonPath(value: unknown, jsonPath: string): string | undefined {
	if (typeof value === "string") {
		return isSecretLikeString(value) ? jsonPath : undefined;
	}
	if (isUnknownArray(value)) {
		for (const [index, item] of value.entries()) {
			const found = findUnsafeJsonPath(item, `${jsonPath}[${index}]`);
			if (found !== undefined) {
				return found;
			}
		}
		return undefined;
	}
	if (!isRecord(value)) {
		return undefined;
	}

	for (const [key, fieldValue] of Object.entries(value)) {
		const separator = jsonPath.endsWith(".") ? "" : ".";
		const found = findUnsafeJsonPath(fieldValue, `${jsonPath}${separator}${key}`);
		if (found !== undefined) {
			return found;
		}
	}
	return undefined;
}

function isSecretLikeString(value: string): boolean {
	return SECRET_LIKE_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
	return Array.isArray(value);
}

function readRecord(record: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
	const value = record[key];
	return isRecord(value) ? value : undefined;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	return typeof value === "string" ? value : undefined;
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
	const value = record[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
