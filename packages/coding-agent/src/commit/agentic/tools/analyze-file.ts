import { Type } from "@sinclair/typebox";
import analyzeFilePrompt from "$c/commit/agentic/prompts/analyze-file.md" with { type: "text" };
import type { ModelRegistry } from "$c/config/model-registry";
import { renderPromptTemplate } from "$c/config/prompt-templates";
import type { SettingsManager } from "$c/config/settings-manager";
import type { CustomTool, CustomToolContext } from "$c/extensibility/custom-tools/types";
import type { AuthStorage } from "$c/session/auth-storage";
import { TaskTool } from "$c/task";
import type { TaskParams } from "$c/task/types";
import type { ToolSession } from "$c/tools/index";

const analyzeFileSchema = Type.Object({
	files: Type.Array(Type.String({ description: "File path" }), { minItems: 1 }),
	goal: Type.Optional(Type.String({ description: "Optional analysis focus" })),
});

const analyzeFileOutputSchema = {
	properties: {
		summary: { type: "string" },
		highlights: { elements: { type: "string" } },
		risks: { elements: { type: "string" } },
	},
};

function buildToolSession(
	ctx: CustomToolContext,
	options: {
		cwd: string;
		authStorage: AuthStorage;
		modelRegistry: ModelRegistry;
		settingsManager: SettingsManager;
		spawns: string;
	},
): ToolSession {
	const sessionFile = () => ctx.sessionManager.getSessionFile() ?? null;
	return {
		cwd: options.cwd,
		hasUI: false,
		getSessionFile: sessionFile,
		getSessionSpawns: () => options.spawns,
		settings: options.settingsManager,
		settingsManager: options.settingsManager,
		authStorage: options.authStorage,
		modelRegistry: options.modelRegistry,
	};
}

export function createAnalyzeFileTool(options: {
	cwd: string;
	authStorage: AuthStorage;
	modelRegistry: ModelRegistry;
	settingsManager: SettingsManager;
	spawns: string;
}): CustomTool<typeof analyzeFileSchema> {
	return {
		name: "analyze_files",
		label: "Analyze Files",
		description: "Spawn quick_task agents to analyze files.",
		parameters: analyzeFileSchema,
		async execute(toolCallId, params, onUpdate, ctx, signal) {
			const toolSession = buildToolSession(ctx, options);
			const taskTool = await TaskTool.create(toolSession);
			const context = "{{prompt}}";
			const tasks = params.files.map((file, index) => {
				const relatedFiles = formatRelatedFiles(params.files, file);
				const prompt = renderPromptTemplate(analyzeFilePrompt, {
					file,
					goal: params.goal,
					related_files: relatedFiles,
				});
				return {
					id: `AnalyzeFile${index + 1}`,
					description: `Analyze ${file}`,
					args: { prompt },
				};
			});
			const taskParams: TaskParams = {
				agent: "quick_task",
				context,
				output: analyzeFileOutputSchema,
				tasks,
			};
			return taskTool.execute(toolCallId, taskParams, signal, onUpdate);
		},
	};
}

function formatRelatedFiles(files: string[], currentFile: string): string | undefined {
	const others = files.filter((file) => file !== currentFile);
	if (others.length === 0) return undefined;
	return others.map((file) => `- ${file}`).join("\n");
}
