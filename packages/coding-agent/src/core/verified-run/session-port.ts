import type { Agent, AgentTool } from "omk-agent-core";
import type { RunBudgetLimits } from "../run-budget-policy.ts";

/** Host composition port: not accepted from a contract, worker message or RPC payload. */
export interface VerifiedRunSession {
	readonly agent: Pick<Agent, "abort">;
	readonly lastTermination?: { readonly kind: string };
	prompt(
		goal: string,
		options: { readonly expandPromptTemplates: false; readonly runBudget: RunBudgetLimits },
	): Promise<void>;
	getRunBudgetSnapshot(): { readonly activeRequests: number } | undefined;
	abort(): Promise<void>;
	dispose(): void;
}
export interface VerifiedRunSessionInput {
	readonly agent: Agent;
	readonly tool: AgentTool;
	readonly workspace: string;
}
export interface VerifiedRunRuntime {
	readonly createSession: (input: VerifiedRunSessionInput) => VerifiedRunSession;
}
