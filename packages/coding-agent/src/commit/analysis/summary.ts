import type { Api, AssistantMessage, Model, ToolCall } from "@oh-my-pi/pi-ai";
import { completeSimple, validateToolCall } from "@oh-my-pi/pi-ai";
import summarySystemPrompt from "@oh-my-pi/pi-coding-agent/commit/prompts/summary-system.md" with { type: "text" };
import summaryUserPrompt from "@oh-my-pi/pi-coding-agent/commit/prompts/summary-user.md" with { type: "text" };
import type { CommitSummary } from "@oh-my-pi/pi-coding-agent/commit/types";
import { renderPromptTemplate } from "@oh-my-pi/pi-coding-agent/config/prompt-templates";
import { Type } from "@sinclair/typebox";

const SummaryTool = {
	name: "create_commit_summary",
	description: "Generate the summary line for a conventional commit message.",
	parameters: Type.Object({
		summary: Type.String(),
	}),
};

export interface SummaryInput {
	model: Model<Api>;
	apiKey: string;
	commitType: string;
	scope: string | null;
	details: string[];
	stat: string;
	maxChars: number;
	userContext?: string;
}

/**
 * Generate a commit summary line for the conventional commit header.
 */
export async function generateSummary({
	model,
	apiKey,
	commitType,
	scope,
	details,
	stat,
	maxChars,
	userContext,
}: SummaryInput): Promise<CommitSummary> {
	const systemPrompt = renderSummaryPrompt({ commitType, scope, maxChars });
	const userPrompt = renderPromptTemplate(summaryUserPrompt, {
		user_context: userContext,
		details: details.join("\n"),
		stat,
	});

	const response = await completeSimple(
		model,
		{
			systemPrompt,
			messages: [{ role: "user", content: userPrompt, timestamp: Date.now() }],
			tools: [SummaryTool],
		},
		{ apiKey, maxTokens: 200 },
	);

	return parseSummaryFromResponse(response, commitType, scope);
}

function renderSummaryPrompt({
	commitType,
	scope,
	maxChars,
}: {
	commitType: string;
	scope: string | null;
	maxChars: number;
}): string {
	const scopePrefix = scope ? `(${scope})` : "";
	return renderPromptTemplate(summarySystemPrompt, {
		commit_type: commitType,
		scope_prefix: scopePrefix,
		chars: String(maxChars),
	});
}

function parseSummaryFromResponse(message: AssistantMessage, commitType: string, scope: string | null): CommitSummary {
	const toolCall = extractToolCall(message, "create_commit_summary");
	if (toolCall) {
		const parsed = validateToolCall([SummaryTool], toolCall) as { summary: string };
		return { summary: stripTypePrefix(parsed.summary, commitType, scope) };
	}
	const text = extractTextContent(message);
	return { summary: stripTypePrefix(text, commitType, scope) };
}

function extractToolCall(message: AssistantMessage, name: string): ToolCall | undefined {
	return message.content.find((content) => content.type === "toolCall" && content.name === name) as
		| ToolCall
		| undefined;
}

function extractTextContent(message: AssistantMessage): string {
	return message.content
		.filter((content) => content.type === "text")
		.map((content) => content.text)
		.join("")
		.trim();
}

export function stripTypePrefix(summary: string, commitType: string, scope: string | null): string {
	const trimmed = summary.trim();
	const scopePart = scope ? `(${scope})` : "";
	const withScope = `${commitType}${scopePart}: `;
	if (trimmed.startsWith(withScope)) {
		return trimmed.slice(withScope.length).trim();
	}
	const withoutScope = `${commitType}: `;
	if (trimmed.startsWith(withoutScope)) {
		return trimmed.slice(withoutScope.length).trim();
	}
	return trimmed;
}
