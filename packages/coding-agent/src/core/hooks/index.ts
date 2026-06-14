export {
	createFailClosedToolCallResult,
	createFailClosedToolResult,
	FAIL_CLOSED_REASON,
	formatFailClosedReason,
	sanitizeHookFailure,
} from "./fail-closed.ts";
export type {
	FailClosedTextContent,
	FailClosedToolCallResult,
	FailClosedToolResult,
	HookFailure,
	HookFailureCode,
	HookFailureStage,
} from "./types.ts";
