import type { Api, AssistantMessage, Model, ToolCall } from "@oh-my-pi/pi-ai";
import { completeSimple, validateToolCall } from "@oh-my-pi/pi-ai";
import changelogSystemPrompt from "@oh-my-pi/pi-coding-agent/commit/prompts/changelog-system.md" with { type: "text" };
import changelogUserPrompt from "@oh-my-pi/pi-coding-agent/commit/prompts/changelog-user.md" with { type: "text" };
import type { ChangelogGenerationResult } from "@oh-my-pi/pi-coding-agent/commit/types";
import { renderPromptTemplate } from "@oh-my-pi/pi-coding-agent/config/prompt-templates";
import { Type } from "@sinclair/typebox";

const ChangelogTool = {
	name: "create_changelog_entries",
	description: "Generate changelog entries grouped by Keep a Changelog categories.",
	parameters: Type.Object({
		entries: Type.Record(Type.String(), Type.Array(Type.String())),
	}),
};

export interface ChangelogPromptInput {
	model: Model<Api>;
	apiKey: string;
	changelogPath: string;
	isPackageChangelog: boolean;
	existingEntries?: string;
	stat: string;
	diff: string;
}

export async function generateChangelogEntries({
	model,
	apiKey,
	changelogPath,
	isPackageChangelog,
	existingEntries,
	stat,
	diff,
}: ChangelogPromptInput): Promise<ChangelogGenerationResult> {
	const prompt = renderPromptTemplate(changelogUserPrompt, {
		changelog_path: changelogPath,
		is_package_changelog: isPackageChangelog,
		existing_entries: existingEntries,
		stat,
		diff,
	});
	const response = await completeSimple(
		model,
		{
			systemPrompt: renderPromptTemplate(changelogSystemPrompt),
			messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
			tools: [ChangelogTool],
		},
		{ apiKey, maxTokens: 1200 },
	);

	const parsed = parseChangelogResponse(response);
	return { entries: dedupeEntries(parsed.entries) };
}

function parseChangelogResponse(message: AssistantMessage): ChangelogGenerationResult {
	const toolCall = extractToolCall(message, "create_changelog_entries");
	if (toolCall) {
		const parsed = validateToolCall([ChangelogTool], toolCall) as ChangelogGenerationResult;
		return { entries: parsed.entries ?? {} };
	}

	const text = extractTextContent(message);
	const parsed = parseJsonPayload(text) as ChangelogGenerationResult;
	return { entries: parsed.entries ?? {} };
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

function parseJsonPayload(text: string): unknown {
	const trimmed = text.trim();
	if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
		return JSON.parse(trimmed) as unknown;
	}
	const match = trimmed.match(/\{[\s\S]*\}/);
	if (!match) {
		throw new Error("No JSON payload found in changelog response");
	}
	return JSON.parse(match[0]) as unknown;
}

function dedupeEntries(entries: Record<string, string[]>): Record<string, string[]> {
	const result: Record<string, string[]> = {};
	for (const [category, values] of Object.entries(entries)) {
		const seen = new Set<string>();
		const cleaned: string[] = [];
		for (const value of values) {
			const trimmed = value.trim().replace(/\.$/, "");
			const key = trimmed.toLowerCase();
			if (!trimmed || seen.has(key)) continue;
			seen.add(key);
			cleaned.push(trimmed);
		}
		if (cleaned.length > 0) {
			result[category] = cleaned;
		}
	}
	return result;
}
