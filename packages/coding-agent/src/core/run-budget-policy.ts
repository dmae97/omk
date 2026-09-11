/** Logical stream-dispatch limits for one explicit prompt, not provider billing limits. */
export interface RunBudgetLimits {
	readonly timeoutMs?: number;
	readonly maxRequests?: number;
	readonly maxConcurrentRequests?: number;
}

export const RUN_BUDGET_STOP_CODES = ["deadline", "requests", "concurrency", "closed"] as const;
export type RunBudgetStopCode = (typeof RUN_BUDGET_STOP_CODES)[number];

export class RunBudgetExceededError extends Error {
	readonly code: RunBudgetStopCode;
	constructor(code: RunBudgetStopCode) {
		super(`Run budget exhausted: ${code}`);
		this.name = "RunBudgetExceededError";
		this.code = code;
	}
}

export class RunBudgetPolicyError extends Error {
	constructor() {
		super("Invalid run budget: use non-negative integer limits and a timeout no greater than 2147483647ms");
		this.name = "RunBudgetPolicyError";
	}
}

/** Copy the flat policy without executing accessors or accepting inherited limits. */
export function snapshotRunBudgetLimits(input: unknown): RunBudgetLimits {
	if (typeof input !== "object" || input === null || Array.isArray(input)) throw new RunBudgetPolicyError();
	const prototype = Object.getPrototypeOf(input);
	if (prototype !== Object.prototype && prototype !== null) throw new RunBudgetPolicyError();
	const keys = Reflect.ownKeys(input);
	if (
		keys.length === 0 ||
		keys.some(
			(key) =>
				!["timeoutMs", "maxRequests", "maxConcurrentRequests"].includes(String(key)) || typeof key !== "string",
		)
	) {
		throw new RunBudgetPolicyError();
	}
	const descriptors = Object.getOwnPropertyDescriptors(input);
	const readLimit = (key: keyof RunBudgetLimits): number | undefined => {
		const descriptor = descriptors[key];
		if (descriptor === undefined) return undefined;
		const value: unknown = descriptor.value;
		if (
			!("value" in descriptor) ||
			typeof value !== "number" ||
			!Number.isSafeInteger(value) ||
			value < 0 ||
			(key === "timeoutMs" && value > 2147483647)
		) {
			throw new RunBudgetPolicyError();
		}
		return value;
	};
	const timeoutMs = readLimit("timeoutMs");
	const maxRequests = readLimit("maxRequests");
	const maxConcurrentRequests = readLimit("maxConcurrentRequests");
	return Object.freeze({
		...(timeoutMs === undefined ? {} : { timeoutMs }),
		...(maxRequests === undefined ? {} : { maxRequests }),
		...(maxConcurrentRequests === undefined ? {} : { maxConcurrentRequests }),
	});
}
