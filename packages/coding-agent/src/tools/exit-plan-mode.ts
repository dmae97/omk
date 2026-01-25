import * as fs from "node:fs/promises";
import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import { isEnoent } from "@oh-my-pi/pi-utils";
import { Type } from "@sinclair/typebox";
import { renderPromptTemplate } from "../config/prompt-templates";
import exitPlanModeDescription from "../prompts/tools/exit-plan-mode.md" with { type: "text" };
import type { ToolSession } from ".";
import { resolvePlanPath } from "./plan-mode-guard";
import { ToolError } from "./tool-errors";

const exitPlanModeSchema = Type.Object({});

export interface ExitPlanModeDetails {
	planFilePath: string;
	planExists: boolean;
}

export class ExitPlanModeTool implements AgentTool<typeof exitPlanModeSchema, ExitPlanModeDetails> {
	public readonly name = "exit_plan_mode";
	public readonly label = "ExitPlanMode";
	public readonly description: string;
	public readonly parameters = exitPlanModeSchema;

	private readonly session: ToolSession;

	constructor(session: ToolSession) {
		this.session = session;
		this.description = renderPromptTemplate(exitPlanModeDescription);
	}

	public async execute(
		_toolCallId: string,
		_params: Record<string, never>,
		_signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<ExitPlanModeDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<ExitPlanModeDetails>> {
		const state = this.session.getPlanModeState?.();
		if (!state?.enabled) {
			throw new ToolError("Plan mode is not active.");
		}

		const resolvedPlanPath = resolvePlanPath(this.session, state.planFilePath);
		let planExists = false;
		try {
			const stat = await fs.stat(resolvedPlanPath);
			planExists = stat.isFile();
		} catch (error) {
			if (!isEnoent(error)) {
				throw error;
			}
		}

		return {
			content: [{ type: "text", text: "Plan ready for approval." }],
			details: {
				planFilePath: state.planFilePath,
				planExists,
			},
		};
	}
}
