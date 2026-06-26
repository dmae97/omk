export {
	createFailClosedToolCallResult,
	createFailClosedToolResult,
	DEFAULT_HOOK_POLICY,
	FAIL_CLOSED_REASON,
	formatFailClosedReason,
	MAX_HOOK_TIMEOUT_MS,
	sanitizeHookFailure,
	sanitizeHookPolicy,
} from "./fail-closed.ts";
export type {
	FailClosedTextContent,
	FailClosedToolCallResult,
	FailClosedToolResult,
	HookFailure,
	HookFailureCode,
	HookFailureMode,
	HookFailureStage,
	HookPolicyEffect,
	HookPolicyMetadata,
	HookPolicyStage,
} from "./types.ts";
