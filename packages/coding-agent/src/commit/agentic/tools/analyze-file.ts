import { Type } from "@sinclair/typebox";
import analyzeFilePrompt from "$c/commit/agentic/prompts/analyze-file.md" with { type: "text" };
import type { CommitAgentState } from "$c/commit/agentic/state";
import { getFilePriority } from "$c/commit/agentic/tools/git-file-diff";
import type { NumstatEntry } from "$c/commit/types";
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
	state: CommitAgentState;
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
			const numstat = options.state.overview?.numstat ?? [];
			const tasks = params.files.map((file, index) => {
				const relatedFiles = formatRelatedFiles(params.files, file, numstat);
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

function inferFileType(path: string): string {
	const priority = getFilePriority(path);
	const lowerPath = path.toLowerCase();

	if (priority === -100) return "binary file";
	if (priority === 10) return "test file";
	if (lowerPath.endsWith(".md") || lowerPath.endsWith(".txt")) return "documentation";
	if (
		lowerPath.endsWith(".json") ||
		lowerPath.endsWith(".yaml") ||
		lowerPath.endsWith(".yml") ||
		lowerPath.endsWith(".toml")
	)
		return "configuration";
	if (priority === 70) return "dependency manifest";
	if (priority === 80) return "script";
	if (priority === 100) return "implementation";

	return "source file";
}

function formatRelatedFiles(files: string[], currentFile: string, numstat: NumstatEntry[]): string | undefined {
	const others = files.filter((file) => file !== currentFile);
	if (others.length === 0) return undefined;

	const numstatMap = new Map(numstat.map((entry) => [entry.path, entry]));

	const lines = others.map((file) => {
		const entry = numstatMap.get(file);
		const fileType = inferFileType(file);
		if (entry) {
			const lineCount = entry.additions + entry.deletions;
			return `- ${file} (${lineCount} lines): ${fileType}`;
		}
		return `- ${file}: ${fileType}`;
	});

	return `OTHER FILES IN THIS CHANGE:\n${lines.join("\n")}`;
}
