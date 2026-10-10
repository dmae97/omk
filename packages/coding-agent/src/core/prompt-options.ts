import type { ImageContent } from "omk-ai";
import type { InputSource } from "./extensions/types.ts";
import type { RunBudgetLimits } from "./run-budget-policy.ts";

/** Options for AgentSession.prompt() */
export interface PromptOptions {
	/** Shared logical request/concurrency limits and a monotonic deadline for this prompt. */
	runBudget?: RunBudgetLimits;
	/** Whether to expand file-based prompt templates (default: true) */
	expandPromptTemplates?: boolean;
	/** Image attachments */
	images?: ImageContent[];
	/** When streaming, how to queue the message: "steer" (interrupt) or "followUp" (wait). Required if streaming. */
	streamingBehavior?: "steer" | "followUp";
	/** Source of input for extension input event handlers. Defaults to "interactive". */
	source?: InputSource;
	activeSkillNames?: readonly string[];
	activeSkillSource?: string;
	/** Internal hook used by RPC mode to observe prompt preflight acceptance or rejection. */
	preflightResult?: (success: boolean) => void;
}
