/**
 * Unified guardrail types for OMK hard-fork runtime.
 *
 * Integrates Freedomd strict policy with OMK native extension-based
 * safety hooks (formerly hooks/). All tool/block decisions flow through
 * a single `GuardrailDecision` produced by the `FreedomdAdapter`.
 */

export type ToolCategory =
	| "destructive"
	| "network"
	| "secret_exposure"
	| "privilege_escalation"
	| "filesystem"
	| "shell"
	| "unknown";

export type BlockOrigin = "freedomd" | "omk_extension" | "unified_policy";

export interface GuardrailRule {
	/** Unique rule identifier (kebab-case). */
	id: string;
	/** Human-readable description of what is being blocked. */
	description: string;
	/** Risk category for audit logs. */
	category: ToolCategory;
	/** Where this rule originated. */
	origin: BlockOrigin;
	/** Optional glob or regex matched against tool input. */
	pattern?: string;
	/** Optional exact tool name to match. */
	toolName?: string;
	/** When true the rule is active. */
	enabled: boolean;
}

export interface GuardrailPolicy {
	version: string;
	/** Default action when no rule matches. */
	defaultAction: "allow" | "deny";
	/** Ordered list of unified rules. */
	rules: GuardrailRule[];
}

export interface GuardrailDecision {
	allowed: boolean;
	/** Matched rule, if any. */
	rule?: GuardrailRule;
	/** Human-readable reason for the decision. */
	reason?: string;
	/** Suggested safe alternative, if blocked. */
	suggestion?: string;
}

export interface GuardrailAuditEvent {
	/** ISO-8601 timestamp. */
	timestamp: string;
	/** Goal or session identifier. */
	goalId?: string;
	/** Tool name that was evaluated. */
	toolName: string;
	/** Tool input that was evaluated (sanitized, no secrets). */
	toolInput: string;
	/** Final decision. */
	decision: GuardrailDecision;
}

export interface FreedomdAdapter {
	/**
	 * Evaluate a tool call against the unified policy.
	 * @returns a `GuardrailDecision` and optionally emits an audit event.
	 */
	evaluate(toolName: string, toolInput: unknown): Promise<GuardrailDecision>;
}
