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
	/**
	 * Internal hook (next-suggestion accept trace): called once with the branch prompt() actually took: "prompt" when
	 * a run starts, or the requested streamingBehavior when the input is queued (steer/followUp) or deferred for a
	 * prompt in preflight. Not called for input an extension command or input hook handled.
	 */
	dispatched?: (via: "prompt" | "steer" | "followUp", text: string) => void;
}
