import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Agent, type AgentTool } from "omk-agent-core";
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider, streamSimple } from "omk-ai";
import type { RunScriptedWriter } from "omk-protocol";
import { Type } from "typebox";
import { convertToLlm } from "../messages.ts";
import { RunBudgetExceededError } from "../run-budget-policy.ts";
import type { OwnedRunResult } from "./owned-execution.ts";
import type { VerifiedRunRuntime, VerifiedRunSession } from "./session-port.ts";
import { VerifiedRunError } from "./storage.ts";

export interface ScriptedWriterContext {
	readonly runtime: VerifiedRunRuntime;
	readonly workspace: string;
	readonly deadline: number;
	readonly requestLimit: number;
	readonly signal?: AbortSignal;
	readonly beforeRequest: () => void;
	readonly executeStep: (index: number, signal?: AbortSignal) => Promise<OwnedRunResult>;
}

/** Offline reference adapter. The real AgentSession is trusted host code; every command stays in bwrap. */
export async function executeScriptedWriter(
	writer: RunScriptedWriter,
	goal: string,
	context: ScriptedWriterContext,
): Promise<void> {
	if (context.signal?.aborted) throw new VerifiedRunError("cancelled");
	const faux = registerFauxProvider({ provider: `verified-scripted-${randomUUID()}` });
	let session: VerifiedRunSession | undefined;
	let failure: unknown;
	let completedSteps = 0;
	const cancel = (): void => session?.agent.abort();
	try {
		const model = faux.getModel();
		const schema = Type.Object(
			{ index: Type.Integer({ minimum: 0, maximum: writer.steps.length - 1 }) },
			{ additionalProperties: false },
		);
		const tool: AgentTool<typeof schema> = {
			name: "verified_step",
			label: "Execute approved step",
			description: "Execute one contract-approved step in order.",
			parameters: schema,
			execute: async (_id, args, signal) => {
				try {
					if (failure || args.index !== completedSteps || !writer.steps[args.index])
						throw new VerifiedRunError("writer_step");
					const { result } = await context.executeStep(args.index, signal);
					if (result.failure) throw new VerifiedRunError(result.failure);
					completedSteps += 1;
					return { content: [{ type: "text", text: result.stdout.toString("utf8") }], details: {} };
				} catch (error) {
					failure = error;
					cancel();
					throw error;
				}
			},
		};
		faux.setResponses([
			...writer.steps.map((_step, index) => fauxAssistantMessage(fauxToolCall(tool.name, { index }))),
			fauxAssistantMessage("Contracted steps finished; only the supervisor may verify the candidate."),
		]);
		const agent = new Agent({
			initialState: { model, tools: [] },
			convertToLlm,
			getApiKey: () => "synthetic-local-only",
			streamFn: (selected, input, options) => {
				context.beforeRequest();
				return streamSimple(selected, input, options);
			},
		});
		session = context.runtime.createSession({ agent, tool, workspace: context.workspace });
		context.signal?.addEventListener("abort", cancel, { once: true });
		if (context.signal?.aborted) throw new VerifiedRunError("cancelled");
		const remaining = Math.floor(context.deadline - performance.now());
		if (remaining <= 0) throw new VerifiedRunError("deadline");
		await session.prompt(goal, {
			expandPromptTemplates: false,
			runBudget: { timeoutMs: remaining, maxRequests: context.requestLimit, maxConcurrentRequests: 1 },
		});
		if (failure) throw failure;
		if (
			completedSteps !== writer.steps.length ||
			session.lastTermination?.kind !== "completed" ||
			session.getRunBudgetSnapshot()?.activeRequests !== 0
		)
			throw new VerifiedRunError("writer_incomplete");
	} catch (error) {
		if (failure instanceof VerifiedRunError) throw failure;
		if (error instanceof RunBudgetExceededError)
			throw new VerifiedRunError(error.code === "requests" ? "model_request_limit" : "deadline");
		throw error;
	} finally {
		context.signal?.removeEventListener("abort", cancel);
		try {
			if (session) {
				await session.abort();
				session.dispose();
			}
		} finally {
			faux.unregister();
		}
	}
}
