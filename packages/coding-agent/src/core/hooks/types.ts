export type HookFailureCode = "hook_failed" | "hook_rejected" | "hook_timeout" | "hook_unavailable";

export type HookFailureStage = "tool_call" | "tool_result" | "unknown";

/**
 * Sanitized hook failure metadata safe to expose in tool results.
 *
 * This structure intentionally carries only bounded coded values. It must not
 * include raw causes, stacks, commands, content, or filesystem paths.
 */
export interface HookFailure {
	type: "hook_failure";
	sanitized: true;
	code: HookFailureCode;
	stage: HookFailureStage;
}

export interface FailClosedTextContent {
	type: "text";
	text: string;
}

export interface FailClosedToolCallResult {
	block: true;
	reason: string;
}

export interface FailClosedToolResult {
	content: FailClosedTextContent[];
	details: HookFailure;
	isError: true;
}
