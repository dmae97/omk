import type { Api, AssistantMessage, Model, ToolCall } from "@oh-my-pi/pi-ai";
import { completeSimple, validateToolCall } from "@oh-my-pi/pi-ai";
import reduceSystemPrompt from "@oh-my-pi/pi-coding-agent/commit/prompts/reduce-system.md" with { type: "text" };
import reduceUserPrompt from "@oh-my-pi/pi-coding-agent/commit/prompts/reduce-user.md" with { type: "text" };
import type { ChangelogCategory, ConventionalAnalysis, FileObservation } from "@oh-my-pi/pi-coding-agent/commit/types";
import { renderPromptTemplate } from "@oh-my-pi/pi-coding-agent/config/prompt-templates";
import { Type } from "@sinclair/typebox";

const ReduceTool = {
	name: "create_conventional_analysis",
	description: "Synthesize file observations into a conventional commit analysis.",
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

export interface ReducePhaseInput {
	model: Model<Api>;
	apiKey: string;
	observations: FileObservation[];
	stat: string;
	scopeCandidates: string;
	typesDescription?: string;
}

export async function runReducePhase({
	model,
	apiKey,
	observations,
	stat,
	scopeCandidates,
	typesDescription,
}: ReducePhaseInput): Promise<ConventionalAnalysis> {
	const prompt = renderPromptTemplate(reduceUserPrompt, {
		types_description: typesDescription,
		observations: observations.flatMap((obs) => obs.observations.map((line) => `- ${obs.file}: ${line}`)).join("\n"),
		stat,
		scope_candidates: scopeCandidates,
	});
	const response = await completeSimple(
		model,
		{
			systemPrompt: renderPromptTemplate(reduceSystemPrompt),
			messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
			tools: [ReduceTool],
		},
		{ apiKey, maxTokens: 2400 },
	);

	return parseAnalysisResponse(response);
}

function parseAnalysisResponse(message: AssistantMessage): ConventionalAnalysis {
	const toolCall = extractToolCall(message, "create_conventional_analysis");
	if (toolCall) {
		const parsed = validateToolCall([ReduceTool], toolCall) as {
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

function parseJsonPayload(text: string): unknown {
	const trimmed = text.trim();
	if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
		return JSON.parse(trimmed) as unknown;
	}
	const match = trimmed.match(/\{[\s\S]*\}/);
	if (!match) {
		throw new Error("No JSON payload found in reduce response");
	}
	return JSON.parse(match[0]) as unknown;
}

function normalizeAnalysis(parsed: {
	type: ConventionalAnalysis["type"];
	scope: string | null;
	details: Array<{ text: string; changelog_category?: ChangelogCategory; user_visible?: boolean }>;
	issue_refs: string[];
}): ConventionalAnalysis {
	return {
		type: parsed.type,
		scope: parsed.scope?.trim() || null,
		details: parsed.details.map((detail) => ({
			text: detail.text.trim(),
			changelogCategory: detail.user_visible ? detail.changelog_category : undefined,
			userVisible: detail.user_visible ?? false,
		})),
		issueRefs: parsed.issue_refs ?? [],
	};
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
