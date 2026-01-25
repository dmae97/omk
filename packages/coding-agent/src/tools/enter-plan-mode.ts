import * as fs from "node:fs/promises";
import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import { StringEnum } from "@oh-my-pi/pi-ai";
import { isEnoent } from "@oh-my-pi/pi-utils";
import { Type } from "@sinclair/typebox";
import { renderPromptTemplate } from "../config/prompt-templates";
import { resolvePlanUrlToPath } from "../internal-urls";
import enterPlanModeDescription from "../prompts/tools/enter-plan-mode.md" with { type: "text" };
import type { ToolSession } from ".";
import { ToolError } from "./tool-errors";

const enterPlanModeSchema = Type.Object({
	workflow: Type.Optional(
		StringEnum(["parallel", "iterative"], {
			description: "Planning workflow to use",
		}),
	),
});

export interface EnterPlanModeDetails {
	planFilePath: string;
	planExists: boolean;
	workflow?: "parallel" | "iterative";
}

export class EnterPlanModeTool implements AgentTool<typeof enterPlanModeSchema, EnterPlanModeDetails> {
	public readonly name = "enter_plan_mode";
	public readonly label = "EnterPlanMode";
	public readonly description: string;
	public readonly parameters = enterPlanModeSchema;

	private readonly session: ToolSession;

	constructor(session: ToolSession) {
		this.session = session;
		this.description = renderPromptTemplate(enterPlanModeDescription);
	}

	public async execute(
		_toolCallId: string,
		params: { workflow?: "parallel" | "iterative" },
		_signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<EnterPlanModeDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<EnterPlanModeDetails>> {
		const state = this.session.getPlanModeState?.();
		if (state?.enabled) {
			throw new ToolError("Plan mode is already active.");
		}

		const sessionId = this.session.getSessionId?.();
		if (!sessionId) {
			throw new ToolError("Plan mode requires an active session.");
		}

		const settingsManager = this.session.settingsManager;
		if (!settingsManager) {
			throw new ToolError("Settings manager unavailable for plan mode.");
		}

		const planFilePath = `plan://${sessionId}/plan.md`;
		const resolvedPlanPath = resolvePlanUrlToPath(planFilePath, {
			getPlansDirectory: settingsManager.getPlansDirectory.bind(settingsManager),
			cwd: this.session.cwd,
		});
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
			content: [{ type: "text", text: "Plan mode requested." }],
			details: { planFilePath, planExists, workflow: params.workflow },
		};
	}
}
