import { randomUUID } from "node:crypto";
import {
	type HarnessControlEventKind,
	type HarnessControlEventOptions,
	type HarnessControlEventStatus,
	type HarnessControlEventWriteResult,
	recordHarnessControlEvent,
} from "./harness-control-events.ts";

export type HarnessControlTransactionStatus = "completed" | "rolled_back" | "failed" | "in_doubt";
export type HarnessControlTransactionPhase = "prepare" | "apply" | "verify";

export interface HarnessControlRollbackContext<T, Prepared = unknown> {
	phase: HarnessControlTransactionPhase;
	prepared?: Prepared;
	value?: T;
}

export interface HarnessControlTransactionOptions<T, Prepared = unknown> {
	kind: HarnessControlEventKind;
	data?: Record<string, unknown>;
	beforeState?: unknown;
	afterState?: (value: T) => unknown;
	prepare?: () => Prepared | Promise<Prepared>;
	commit: (prepared?: Prepared) => T | Promise<T>;
	verify?: (value: T, prepared?: Prepared) => void | Promise<void>;
	rollback?: (error: unknown, context?: HarnessControlRollbackContext<T, Prepared>) => void | Promise<void>;
	eventOptions?: HarnessControlEventOptions;
}

export interface HarnessControlTransactionResult<T> {
	status: HarnessControlTransactionStatus;
	operationId: string;
	value?: T;
	error?: unknown;
	rollbackError?: unknown;
	events: HarnessControlEventWriteResult[];
}

function errorSummary(error: unknown): Record<string, string> {
	if (error instanceof Error) return { name: error.name, message: error.message };
	return { name: "Error", message: String(error) };
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
	return (
		(typeof value === "object" || typeof value === "function") &&
		value !== null &&
		typeof (value as { then?: unknown }).then === "function"
	);
}

function createEventOptions(
	base: HarnessControlEventOptions | undefined,
	operationId: string,
	causationId?: string | null,
): HarnessControlEventOptions {
	return {
		...base,
		operationId,
		correlationId: base?.correlationId ?? operationId,
		causationId: causationId ?? base?.causationId ?? null,
	};
}

function pushTransactionEvent(
	events: HarnessControlEventWriteResult[],
	kind: HarnessControlEventKind,
	status: HarnessControlEventStatus,
	data: Record<string, unknown>,
	eventOptions: HarnessControlEventOptions | undefined,
	operationId: string,
	causationId: string | null,
	beforeState: unknown,
	afterState?: unknown,
): string | null {
	const written = recordHarnessControlEvent(kind, status, data, {
		...createEventOptions(eventOptions, operationId, causationId),
		beforeState,
		afterState,
	});
	events.push(written);
	return written.event?.eventId ?? causationId;
}

function createRollbackContext<T, Prepared>(
	phase: HarnessControlTransactionPhase,
	prepared: Prepared | undefined,
	value: T | undefined,
): HarnessControlRollbackContext<T, Prepared> {
	return { phase, prepared, value };
}

export function runHarnessControlTransactionSync<T, Prepared = unknown>(
	options: HarnessControlTransactionOptions<T, Prepared>,
): HarnessControlTransactionResult<T> {
	const operationId = options.eventOptions?.operationId ?? randomUUID();
	const data = options.data ?? {};
	const events: HarnessControlEventWriteResult[] = [];
	let causationId: string | null = null;
	let phase: HarnessControlTransactionPhase = "prepare";
	let prepared: Prepared | undefined;
	let value: T | undefined;

	try {
		const preparedValue = options.prepare ? options.prepare() : undefined;
		if (isThenable(preparedValue)) {
			throw new Error("Synchronous harness transaction prepare returned a Promise");
		}
		prepared = preparedValue as Prepared | undefined;
		causationId = pushTransactionEvent(
			events,
			options.kind,
			"prepared",
			{ ...data, phase: "prepare" },
			options.eventOptions,
			operationId,
			causationId,
			options.beforeState,
			prepared ?? options.beforeState,
		);
		causationId = pushTransactionEvent(
			events,
			options.kind,
			"started",
			data,
			options.eventOptions,
			operationId,
			causationId,
			options.beforeState,
			prepared ?? options.beforeState,
		);

		phase = "apply";
		causationId = pushTransactionEvent(
			events,
			options.kind,
			"applying",
			{ ...data, phase: "apply" },
			options.eventOptions,
			operationId,
			causationId,
			options.beforeState,
			prepared ?? options.beforeState,
		);
		const committed = options.commit(prepared);
		if (isThenable(committed)) {
			throw new Error("Synchronous harness transaction commit returned a Promise");
		}
		value = committed;

		phase = "verify";
		causationId = pushTransactionEvent(
			events,
			options.kind,
			"verifying",
			{ ...data, phase: "verify" },
			options.eventOptions,
			operationId,
			causationId,
			options.beforeState,
			options.afterState ? options.afterState(value) : value,
		);
		const verified = options.verify ? options.verify(value, prepared) : undefined;
		if (isThenable(verified)) {
			throw new Error("Synchronous harness transaction verify returned a Promise");
		}

		events.push(
			recordHarnessControlEvent(options.kind, "completed", data, {
				...createEventOptions(options.eventOptions, operationId, causationId),
				beforeState: options.beforeState,
				afterState: options.afterState ? options.afterState(value) : value,
			}),
		);
		return { status: "completed", operationId, value, events };
	} catch (error) {
		return handleSyncTransactionFailure(options, {
			error,
			events,
			operationId,
			causationId,
			phase,
			prepared,
			value,
			data,
		});
	}
}

function handleSyncTransactionFailure<T, Prepared>(
	options: HarnessControlTransactionOptions<T, Prepared>,
	context: {
		error: unknown;
		events: HarnessControlEventWriteResult[];
		operationId: string;
		causationId: string | null;
		phase: HarnessControlTransactionPhase;
		prepared: Prepared | undefined;
		value: T | undefined;
		data: Record<string, unknown>;
	},
): HarnessControlTransactionResult<T> {
	const { error, events, operationId, causationId, phase, prepared, value, data } = context;
	if (!options.rollback) {
		events.push(
			recordHarnessControlEvent(
				options.kind,
				"failed",
				{ ...data, phase, error: errorSummary(error) },
				{
					...createEventOptions(options.eventOptions, operationId, causationId),
					beforeState: options.beforeState,
				},
			),
		);
		return { status: "failed", operationId, error, events };
	}

	try {
		options.rollback(error, createRollbackContext(phase, prepared, value));
		events.push(
			recordHarnessControlEvent(
				options.kind,
				"rolled_back",
				{ ...data, phase, error: errorSummary(error) },
				{
					...createEventOptions(options.eventOptions, operationId, causationId),
					beforeState: options.beforeState,
					afterState: options.beforeState,
				},
			),
		);
		return { status: "rolled_back", operationId, error, events };
	} catch (rollbackError) {
		events.push(
			recordHarnessControlEvent(
				options.kind,
				"in_doubt",
				{ ...data, phase, error: errorSummary(error), rollbackError: errorSummary(rollbackError) },
				{
					...createEventOptions(options.eventOptions, operationId, causationId),
					beforeState: options.beforeState,
				},
			),
		);
		return { status: "in_doubt", operationId, error, rollbackError, events };
	}
}

export async function runHarnessControlTransaction<T, Prepared = unknown>(
	options: HarnessControlTransactionOptions<T, Prepared>,
): Promise<HarnessControlTransactionResult<T>> {
	const operationId = options.eventOptions?.operationId ?? randomUUID();
	const data = options.data ?? {};
	const events: HarnessControlEventWriteResult[] = [];
	let causationId: string | null = null;
	let phase: HarnessControlTransactionPhase = "prepare";
	let prepared: Prepared | undefined;
	let value: T | undefined;

	try {
		prepared = options.prepare ? await options.prepare() : undefined;
		causationId = pushTransactionEvent(
			events,
			options.kind,
			"prepared",
			{ ...data, phase: "prepare" },
			options.eventOptions,
			operationId,
			causationId,
			options.beforeState,
			prepared ?? options.beforeState,
		);
		causationId = pushTransactionEvent(
			events,
			options.kind,
			"started",
			data,
			options.eventOptions,
			operationId,
			causationId,
			options.beforeState,
			prepared ?? options.beforeState,
		);

		phase = "apply";
		causationId = pushTransactionEvent(
			events,
			options.kind,
			"applying",
			{ ...data, phase: "apply" },
			options.eventOptions,
			operationId,
			causationId,
			options.beforeState,
			prepared ?? options.beforeState,
		);
		value = await options.commit(prepared);

		phase = "verify";
		causationId = pushTransactionEvent(
			events,
			options.kind,
			"verifying",
			{ ...data, phase: "verify" },
			options.eventOptions,
			operationId,
			causationId,
			options.beforeState,
			options.afterState ? options.afterState(value) : value,
		);
		if (options.verify) await options.verify(value, prepared);

		events.push(
			recordHarnessControlEvent(options.kind, "completed", data, {
				...createEventOptions(options.eventOptions, operationId, causationId),
				beforeState: options.beforeState,
				afterState: options.afterState ? options.afterState(value) : value,
			}),
		);
		return { status: "completed", operationId, value, events };
	} catch (error) {
		return handleAsyncTransactionFailure(options, {
			error,
			events,
			operationId,
			causationId,
			phase,
			prepared,
			value,
			data,
		});
	}
}

async function handleAsyncTransactionFailure<T, Prepared>(
	options: HarnessControlTransactionOptions<T, Prepared>,
	context: {
		error: unknown;
		events: HarnessControlEventWriteResult[];
		operationId: string;
		causationId: string | null;
		phase: HarnessControlTransactionPhase;
		prepared: Prepared | undefined;
		value: T | undefined;
		data: Record<string, unknown>;
	},
): Promise<HarnessControlTransactionResult<T>> {
	const { error, events, operationId, causationId, phase, prepared, value, data } = context;
	if (!options.rollback) {
		events.push(
			recordHarnessControlEvent(
				options.kind,
				"failed",
				{ ...data, phase, error: errorSummary(error) },
				{
					...createEventOptions(options.eventOptions, operationId, causationId),
					beforeState: options.beforeState,
				},
			),
		);
		return { status: "failed", operationId, error, events };
	}

	try {
		await options.rollback(error, createRollbackContext(phase, prepared, value));
		events.push(
			recordHarnessControlEvent(
				options.kind,
				"rolled_back",
				{ ...data, phase, error: errorSummary(error) },
				{
					...createEventOptions(options.eventOptions, operationId, causationId),
					beforeState: options.beforeState,
					afterState: options.beforeState,
				},
			),
		);
		return { status: "rolled_back", operationId, error, events };
	} catch (rollbackError) {
		events.push(
			recordHarnessControlEvent(
				options.kind,
				"in_doubt",
				{ ...data, phase, error: errorSummary(error), rollbackError: errorSummary(rollbackError) },
				{
					...createEventOptions(options.eventOptions, operationId, causationId),
					beforeState: options.beforeState,
				},
			),
		);
		return { status: "in_doubt", operationId, error, rollbackError, events };
	}
}
