import type { Api, AssistantMessage, Model, ToolCall } from "@oh-my-pi/pi-ai";
import { completeSimple, validateToolCall } from "@oh-my-pi/pi-ai";
import analysisSystemPrompt from "@oh-my-pi/pi-coding-agent/commit/prompts/analysis-system.md" with { type: "text" };
import analysisUserPrompt from "@oh-my-pi/pi-coding-agent/commit/prompts/analysis-user.md" with { type: "text" };
import type {
	ChangelogCategory,
	ConventionalAnalysis,
	ConventionalDetail,
} from "@oh-my-pi/pi-coding-agent/commit/types";
import { renderPromptTemplate } from "@oh-my-pi/pi-coding-agent/config/prompt-templates";
import { Type } from "@sinclair/typebox";

const ConventionalAnalysisTool = {
	name: "create_conventional_analysis",
	description: "Analyze a diff and return conventional commit classification.",
	parameters: Type.Object({
		type: Type.Union([
			Type.Literal("feat"),
			Type.Literal("fix"),
			Type.Literal("refactor"),
			Type.Literal("docs"),
			Type.Literal("test"),
			Type.Literal("chore"),
			Type.Literal("style"),
			Type.Literal("perf"),
			Type.Literal("build"),
			Type.Literal("ci"),
			Type.Literal("revert"),
		]),
		scope: Type.Union([Type.String(), Type.Null()]),
		details: Type.Array(
			Type.Object({
				text: Type.String(),
				changelog_category: Type.Optional(
					Type.Union([
						Type.Literal("Added"),
						Type.Literal("Changed"),
						Type.Literal("Fixed"),
						Type.Literal("Deprecated"),
						Type.Literal("Removed"),
						Type.Literal("Security"),
						Type.Literal("Breaking Changes"),
					]),
				),
				user_visible: Type.Optional(Type.Boolean()),
			}),
		),
		issue_refs: Type.Array(Type.String()),
	}),
};

export interface ConventionalAnalysisInput {
	model: Model<Api>;
	apiKey: string;
	contextFiles?: Array<{ path: string; content: string }>;
	userContext?: string;
	typesDescription?: string;
	recentCommits?: string[];
	scopeCandidates: string;
	stat: string;
	diff: string;
}

/**
 * Generate conventional analysis data from a diff and metadata.
 */
export async function generateConventionalAnalysis({
	model,
	apiKey,
	contextFiles,
	userContext,
	typesDescription,
	recentCommits,
	scopeCandidates,
	stat,
	diff,
}: ConventionalAnalysisInput): Promise<ConventionalAnalysis> {
	const prompt = renderPromptTemplate(analysisUserPrompt, {
		context_files: contextFiles && contextFiles.length > 0 ? contextFiles : undefined,
		user_context: userContext,
		types_description: typesDescription,
		recent_commits: recentCommits?.join("\n"),
		scope_candidates: scopeCandidates,
		stat,
		diff,
	});

	const response = await completeSimple(
		model,
		{
			systemPrompt: renderPromptTemplate(analysisSystemPrompt),
			messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
			tools: [ConventionalAnalysisTool],
		},
		{ apiKey, maxTokens: 2400 },
	);

	return parseAnalysisFromResponse(response);
}

function parseAnalysisFromResponse(message: AssistantMessage): ConventionalAnalysis {
	const toolCall = extractToolCall(message, "create_conventional_analysis");
	if (toolCall) {
		const parsed = validateToolCall([ConventionalAnalysisTool], toolCall) as {
			type: ConventionalAnalysis["type"];
			scope: string | null;
			details: Array<{ text: string; changelog_category?: ChangelogCategory; user_visible?: boolean }>;
			issue_refs: string[];
		};
		return normalizeAnalysis(parsed);
	}

	const text = extractTextContent(message);
	const parsed = parseJsonPayload(text) as {
		type: ConventionalAnalysis["type"];
		scope: string | null;
		details: Array<{ text: string; changelog_category?: ChangelogCategory; user_visible?: boolean }>;
		issue_refs: string[];
	};
	return normalizeAnalysis(parsed);
}

function normalizeAnalysis(parsed: {
	type: ConventionalAnalysis["type"];
	scope: string | null;
	details: Array<{ text: string; changelog_category?: ChangelogCategory; user_visible?: boolean }>;
	issue_refs: string[];
}): ConventionalAnalysis {
	const details: ConventionalDetail[] = parsed.details.map((detail) => ({
		text: detail.text.trim(),
		changelogCategory: detail.user_visible ? detail.changelog_category : undefined,
		userVisible: detail.user_visible ?? false,
	}));
	return {
		type: parsed.type,
		scope: parsed.scope?.trim() || null,
		details,
		issueRefs: parsed.issue_refs ?? [],
	};
}

function extractToolCall(message: AssistantMessage, name: string): ToolCall | undefined {
	for (const content of message.content) {
		if (content.type === "toolCall" && content.name === name) {
			return content;
		}
	}
	return undefined;
}

function extractTextContent(message: AssistantMessage): string {
	return message.content
		.filter((content) => content.type === "text")
		.map((content) => content.text)
		.join("")
		.trim();
}

function parseJsonPayload(text: string): unknown {
	const trimmed = text.trim();
	if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
		return JSON.parse(trimmed) as unknown;
	}
	const match = trimmed.match(/\{[\s\S]*\}/);
	if (!match) {
		throw new Error("No JSON payload found in analysis response");
	}
	return JSON.parse(match[0]) as unknown;
}
