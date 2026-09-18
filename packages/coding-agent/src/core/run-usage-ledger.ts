/** In-memory accounting, not a billing authority or a process-termination detector. */
export const RUN_USAGE_UNITS = ["inputTokens", "outputTokens", "estimatedUsd"] as const;
export type RunUsageUnit = (typeof RUN_USAGE_UNITS)[number];
export type RunUsageAmounts = Readonly<Partial<Record<RunUsageUnit, number>>>;
type Attempt = {
	requestId: string;
	reservation: RunUsageAmounts;
	usage?: RunUsageAmounts;
	settled: boolean;
};

function amount(value: number): number {
	if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
		throw new Error("budget.invalid_amount");
	}
	return value;
}
function amounts(input: RunUsageAmounts): RunUsageAmounts {
	const result: Partial<Record<RunUsageUnit, number>> = {};
	for (const key of Reflect.ownKeys(input)) {
		if (!RUN_USAGE_UNITS.includes(key as RunUsageUnit)) throw new Error("budget.invalid_unit");
		const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
		if (!("value" in descriptor) || typeof descriptor.value !== "number") throw new Error("budget.invalid_amount");
		result[key as RunUsageUnit] = amount(descriptor.value);
	}
	return Object.freeze(result);
}
function identity(id: string): void {
	if (typeof id !== "string" || !id.trim() || id.length > 256) throw new Error("budget.invalid_identity");
}

/** Validate arithmetic even without a cap; overflow never means unlimited. */
export function planBudgetAdmission(input: {
	settled: number;
	reserved: number;
	requested: number;
	cap?: number;
}): boolean {
	const total = amount(amount(input.settled) + amount(input.reserved) + amount(input.requested));
	return input.cap === undefined || total <= amount(input.cap);
}

export class RunUsageLedger {
	private readonly caps: RunUsageAmounts;
	private readonly attempts = new Map<string, Attempt>();
	private readonly requests = new Set<string>();
	private readonly events = new Map<string, string>();
	private readonly transports = new Map<string, string>();
	private closed = false;
	private readonly maxEntries: number;

	constructor(caps: RunUsageAmounts = {}, maxEntries = 10_000) {
		this.caps = amounts(caps);
		if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 100_000)
			throw new Error("budget.invalid_limit");
		this.maxEntries = maxEntries;
	}

	reserve(attemptId: string, requestId: string, reservation: RunUsageAmounts = {}): void {
		identity(attemptId);
		identity(requestId);
		if (this.closed) throw new Error("budget.closed");
		if (this.attempts.has(attemptId)) throw new Error("budget.duplicate_attempt");
		if (this.attempts.size >= this.maxEntries) throw new Error("budget.entry_limit");
		const copied = amounts(reservation);
		const snapshot = this.snapshot();
		for (const unit of RUN_USAGE_UNITS) {
			const { accounted, reserved } = snapshot.units[unit];
			const unaccounted = [...this.attempts.values()].some(
				(attempt) =>
					attempt.usage?.[unit] === undefined && (attempt.settled || attempt.reservation[unit] === undefined),
			);
			if (this.caps[unit] !== undefined && (copied[unit] === undefined || unaccounted)) {
				throw new Error("budget.unknown_usage");
			}
			if (
				!planBudgetAdmission({ settled: accounted, reserved, requested: copied[unit] ?? 0, cap: this.caps[unit] })
			) {
				throw new Error("budget.exceeded");
			}
		}
		this.attempts.set(attemptId, { requestId, reservation: copied, settled: false });
		this.requests.add(requestId);
	}

	/** The trusted adapter records an actual transport start, not an application dispatch. */
	recordTransport(transportId: string, attemptId: string): void {
		identity(transportId);
		const attempt = this.get(attemptId);
		const prior = this.transports.get(transportId);
		if (prior !== undefined) {
			if (prior !== attemptId) throw new Error("budget.transport_conflict");
			return;
		}
		if (this.closed || attempt.settled) throw new Error("budget.closed");
		if (this.transports.size >= this.maxEntries) throw new Error("budget.entry_limit");
		this.transports.set(transportId, attemptId);
	}

	/** One cumulative usage report per attempt. Identical redelivery is idempotent. */
	recordUsage(eventId: string, attemptId: string, usage: RunUsageAmounts): void {
		identity(eventId);
		const attempt = this.get(attemptId);
		const copied = amounts(usage);
		const canonical = JSON.stringify(RUN_USAGE_UNITS.map((unit) => copied[unit] ?? null));
		const payload = JSON.stringify([attemptId, canonical]);
		const prior = this.events.get(eventId);
		if (prior !== undefined) {
			if (prior !== payload) throw new Error("budget.usage_conflict");
			return;
		}
		if (attempt.usage !== undefined) throw new Error("budget.usage_already_recorded");
		if (this.events.size >= this.maxEntries) throw new Error("budget.entry_limit");
		// Validate prospective aggregate before any mutation, including late reports.
		for (const unit of RUN_USAGE_UNITS) {
			let total = copied[unit] ?? 0;
			for (const other of this.attempts.values()) total = amount(total + (other.usage?.[unit] ?? 0));
		}
		this.events.set(eventId, payload);
		attempt.usage = copied;
	}

	/** Caller must have observed settlement. A cancel request must NOT call this. */
	settle(attemptId: string): void {
		this.get(attemptId).settled = true;
	}
	/** Seal new admission, keeping reservations and accepting late settlement/usage. */
	close(): void {
		this.closed = true;
	}

	snapshot() {
		const units = {} as Record<
			RunUsageUnit,
			{ accounted: number; reserved: number; unknownAttempts: number; total: number | null }
		>;
		for (const unit of RUN_USAGE_UNITS) {
			let accounted = 0;
			let reserved = 0;
			let unknownAttempts = 0;
			for (const attempt of this.attempts.values()) {
				const reported = attempt.usage?.[unit];
				if (reported !== undefined) accounted = amount(accounted + reported);
				else unknownAttempts++;
				const held = attempt.reservation[unit] ?? 0;
				// Unknown usage retains its reservation even after observed termination.
				if (reported === undefined) reserved = amount(reserved + held);
				else if (!attempt.settled) reserved = amount(reserved + Math.max(0, held - reported));
			}
			units[unit] = Object.freeze({
				accounted,
				reserved,
				unknownAttempts,
				total: unknownAttempts ? null : accounted,
			});
		}
		return Object.freeze({
			schemaVersion: "omk.run-usage.v1",
			closed: this.closed,
			logicalRequests: this.requests.size,
			attempts: this.attempts.size,
			transportAttempts: this.transports.size,
			ownedAttempts: [...this.attempts.values()].filter((entry) => !entry.settled).length,
			usageEvents: this.events.size,
			units: Object.freeze(units),
		});
	}

	private get(attemptId: string): Attempt {
		const attempt = this.attempts.get(attemptId);
		if (!attempt) throw new Error("budget.unknown_attempt");
		return attempt;
	}
}
