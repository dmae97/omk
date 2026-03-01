import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import type { Component } from "@oh-my-pi/pi-tui";
import { Text } from "@oh-my-pi/pi-tui";
import { untilAborted } from "@oh-my-pi/pi-utils";
import { type Static, Type } from "@sinclair/typebox";
import { renderPromptTemplate } from "../config/prompt-templates";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import type { Theme } from "../modes/theme/theme";
import resolveDescription from "../prompts/tools/resolve.md" with { type: "text" };
import { Ellipsis, padToWidth, renderStatusLine, truncateToWidth } from "../tui";
import type { ToolSession } from ".";
import { replaceTabs } from "./render-utils";
import { ToolError } from "./tool-errors";
import { toolResult } from "./tool-result";

const resolveSchema = Type.Object({
	action: Type.Union([Type.Literal("apply"), Type.Literal("discard")]),
	reason: Type.String({ description: "Why you're applying or discarding" }),
});

type ResolveParams = Static<typeof resolveSchema>;

export interface ResolveToolDetails {
	action: "apply" | "discard";
	reason: string;
	sourceToolName?: string;
	label?: string;
}

function resolveReasonPreview(reason?: string): string | undefined {
	const trimmed = reason?.trim();
	if (!trimmed) return undefined;
	return truncateToWidth(trimmed, 72, Ellipsis.Omit);
}

export class ResolveTool implements AgentTool<typeof resolveSchema, ResolveToolDetails> {
	readonly name = "resolve";
	readonly label = "Resolve";
	readonly hidden = true;
	readonly description: string;
	readonly parameters = resolveSchema;
	readonly strict = true;

	constructor(private readonly session: ToolSession) {
		this.description = renderPromptTemplate(resolveDescription);
	}

	async execute(
		_toolCallId: string,
		params: ResolveParams,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<ResolveToolDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<ResolveToolDetails>> {
		return untilAborted(signal, async () => {
			const store = this.session.pendingActionStore;
			if (!store || !store.hasPending) {
				throw new ToolError("No pending action to resolve. Nothing to apply or discard.");
			}

			const pendingAction = store.pop();
			if (!pendingAction) {
				throw new ToolError("No pending action to resolve. Nothing to apply or discard.");
			}
			const resolveDetails: ResolveToolDetails = {
				action: params.action,
				reason: params.reason,
				sourceToolName: pendingAction.sourceToolName,
				label: pendingAction.label,
			};

			if (params.action === "apply") {
				const applyResult = await pendingAction.apply(params.reason);
				const appliedText = applyResult.content
					.filter(part => part.type === "text")
					.map(part => part.text)
					.filter(text => text != null && text.length > 0)
					.join("\n");
				const baseResult = toolResult()
					.text(appliedText || `Applied: ${pendingAction.label}.`)
					.done();
				return { ...baseResult, details: resolveDetails };
			}

			if (params.action === "discard" && pendingAction.reject != null) {
				const discardResult = await pendingAction.reject(params.reason);
				if (discardResult != null) {
					return { ...discardResult, details: resolveDetails };
				}
			}
			const discardResult = toolResult().text(`Discarded: ${pendingAction.label}. Reason: ${params.reason}`).done();
			return { ...discardResult, details: resolveDetails };
		});
	}
}

export const resolveToolRenderer = {
	renderCall(args: ResolveParams, _options: RenderResultOptions, uiTheme: Theme): Component {
		const reason = resolveReasonPreview(args.reason);
		const text = renderStatusLine(
			{
				icon: "pending",
				title: "Resolve",
				description: args.action,
				badge: {
					label: args.action === "apply" ? "proposed -> resolved" : "proposed -> rejected",
					color: args.action === "apply" ? "success" : "warning",
				},
				meta: reason ? [uiTheme.fg("muted", reason)] : undefined,
			},
			uiTheme,
		);
		return new Text(text, 0, 0);
	},

	renderResult(
		result: { content: Array<{ type: string; text?: string }>; details?: ResolveToolDetails; isError?: boolean },
		_options: RenderResultOptions,
		uiTheme: Theme,
	): Component {
		const details = result.details;
		const label = replaceTabs(details?.label ?? "pending action");
		const reason = replaceTabs(details?.reason?.trim() || "No reason provided");
		const action = details?.action ?? "apply";
		const isApply = action === "apply" && !result.isError;
		const bgColor = result.isError ? "error" : isApply ? "success" : "warning";
		const icon = isApply ? uiTheme.status.success : uiTheme.status.error;
		const verb = isApply ? "Accept" : "Discard";
		const separator = ": ";
		const separatorIndex = label.indexOf(separator);
		const sourceLabel = separatorIndex > 0 ? label.slice(0, separatorIndex).trim() : undefined;
		const summaryLabel = separatorIndex > 0 ? label.slice(separatorIndex + separator.length).trim() : label;
		const sourceBadge = sourceLabel
			? uiTheme.bold(`${uiTheme.format.bracketLeft}${sourceLabel}${uiTheme.format.bracketRight}`)
			: undefined;
		const headerLine = `${icon} ${uiTheme.bold(`${verb}:`)} ${summaryLabel}${sourceBadge ? ` ${sourceBadge}` : ""}`;
		const lines = ["", headerLine, "", uiTheme.italic(reason), ""];

		return {
			render(width: number) {
				const lineWidth = Math.max(3, width);
				const innerWidth = Math.max(1, lineWidth - 2);
				return lines.map(line => {
					const truncated = truncateToWidth(line, innerWidth, Ellipsis.Omit);
					const framed = ` ${padToWidth(truncated, innerWidth)} `;
					const padded = padToWidth(framed, lineWidth);
					return uiTheme.inverse(uiTheme.fg(bgColor, padded));
				});
			},
			invalidate() {},
		};
	},

	inline: true,
	mergeCallAndResult: true,
};
