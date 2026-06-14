import type {
	FailClosedToolCallResult,
	FailClosedToolResult,
	HookFailure,
	HookFailureCode,
	HookFailureStage,
} from "./types.ts";

export const FAIL_CLOSED_REASON = "Tool execution was blocked by fail-closed hook policy.";

const DEFAULT_HOOK_FAILURE: HookFailure = {
	type: "hook_failure",
	sanitized: true,
	code: "hook_failed",
	stage: "unknown",
};

const HOOK_FAILURE_CODES: ReadonlySet<string> = new Set<string>([
	"hook_failed",
	"hook_rejected",
	"hook_timeout",
	"hook_unavailable",
]);

const HOOK_FAILURE_STAGES: ReadonlySet<string> = new Set<string>(["tool_call", "tool_result", "unknown"]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isHookFailureCode(value: unknown): value is HookFailureCode {
	return typeof value === "string" && HOOK_FAILURE_CODES.has(value);
}

function isHookFailureStage(value: unknown): value is HookFailureStage {
	return typeof value === "string" && HOOK_FAILURE_STAGES.has(value);
}

function readHookFailureCode(value: unknown): HookFailureCode {
	return isHookFailureCode(value) ? value : DEFAULT_HOOK_FAILURE.code;
}

function readHookFailureStage(value: unknown): HookFailureStage {
	return isHookFailureStage(value) ? value : DEFAULT_HOOK_FAILURE.stage;
}

export function sanitizeHookFailure(failure?: unknown): HookFailure {
	if (!isRecord(failure)) {
		return { ...DEFAULT_HOOK_FAILURE };
	}

	return {
		type: "hook_failure",
		sanitized: true,
		code: readHookFailureCode(failure.code),
		stage: readHookFailureStage(failure.stage),
	};
}

export function formatFailClosedReason(failure?: unknown): string {
	void failure;
	return FAIL_CLOSED_REASON;
}

export function createFailClosedToolCallResult(failure?: unknown): FailClosedToolCallResult {
	return {
		block: true,
		reason: formatFailClosedReason(failure),
	};
}

export function createFailClosedToolResult(failure?: unknown): FailClosedToolResult {
	return {
		content: [{ type: "text", text: formatFailClosedReason(failure) }],
		details: sanitizeHookFailure(failure),
		isError: true,
	};
}
