import { randomUUID } from "node:crypto";
import {
	type HarnessControlEventKind,
	type HarnessControlEventOptions,
	type HarnessControlEventWriteResult,
	recordHarnessControlEvent,
} from "./harness-control-events.ts";

export type HarnessControlTransactionStatus = "completed" | "rolled_back" | "failed" | "in_doubt";

export interface HarnessControlTransactionOptions<T> {
	kind: HarnessControlEventKind;
	data?: Record<string, unknown>;
	beforeState?: unknown;
	afterState?: (value: T) => unknown;
	commit: () => T | Promise<T>;
	rollback?: (error: unknown) => void | Promise<void>;
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

export async function runHarnessControlTransaction<T>(
	options: HarnessControlTransactionOptions<T>,
): Promise<HarnessControlTransactionResult<T>> {
	const operationId = options.eventOptions?.operationId ?? randomUUID();
	const data = options.data ?? {};
	const events: HarnessControlEventWriteResult[] = [];
	const started = recordHarnessControlEvent(options.kind, "started", data, {
		...createEventOptions(options.eventOptions, operationId),
		beforeState: options.beforeState,
	});
	events.push(started);
	const causationId = started.event?.eventId ?? null;

	try {
		const value = await options.commit();
		events.push(
			recordHarnessControlEvent(options.kind, "completed", data, {
				...createEventOptions(options.eventOptions, operationId, causationId),
				beforeState: options.beforeState,
				afterState: options.afterState ? options.afterState(value) : value,
			}),
		);
		return { status: "completed", operationId, value, events };
	} catch (error) {
		if (!options.rollback) {
			events.push(
				recordHarnessControlEvent(
					options.kind,
					"failed",
					{ ...data, error: errorSummary(error) },
					{
						...createEventOptions(options.eventOptions, operationId, causationId),
						beforeState: options.beforeState,
					},
				),
			);
			return { status: "failed", operationId, error, events };
		}

		try {
			await options.rollback(error);
			events.push(
				recordHarnessControlEvent(
					options.kind,
					"rolled_back",
					{ ...data, error: errorSummary(error) },
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
					{ ...data, error: errorSummary(error), rollbackError: errorSummary(rollbackError) },
					{
						...createEventOptions(options.eventOptions, operationId, causationId),
						beforeState: options.beforeState,
					},
				),
			);
			return { status: "in_doubt", operationId, error, rollbackError, events };
		}
	}
}
