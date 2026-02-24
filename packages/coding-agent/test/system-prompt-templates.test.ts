import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import { renderPromptTemplate, type TemplateContext } from "@oh-my-pi/pi-coding-agent/config/prompt-templates";

const systemPromptsDir = path.resolve(import.meta.dir, "../src/prompts/system");

const baseRenderContext: TemplateContext = {
	TASK_TOOL_NAME: "task",
	ARGUMENTS: "alpha beta",
	agent: "You are a delegated worker",
	agentsMdSearch: { files: [] },
	appendPrompt: "Appendix instructions",
	arguments: "alpha beta",
	base: "Base system prompt",
	content: "Rule content",
	context: "Background context",
	contextFile: "/tmp/context.md",
	contextFiles: [{ path: "/tmp/context/a.md", content: "Alpha context" }],
	customPrompt: "Custom prompt body",
	cwd: "/tmp/pi-issue-147",
	date: "2026-02-24",
	dateTime: "2026-02-24T12:00:00Z",
	editToolName: "edit",
	environment: [{ label: "OS", value: "Darwin" }],
	finalPlanFilePath: "local://PLAN_FINAL.md",
	git: {
		isRepo: true,
		currentBranch: "feature/tests",
		mainBranch: "main",
		status: "M packages/coding-agent/src/prompts/system/custom-system-prompt.md",
		commits: "abc123 Fix tests",
	},
	intentField: "agent__intent",
	intentTracing: true,
	iterative: true,
	maxRetries: 3,
	modifiedFiles: ["packages/coding-agent/src/config/prompt-templates.ts"],
	name: "rs-no-unwrap",
	path: "packages/coding-agent/src/config/prompt-templates.ts",
	planContent: "1. Read code\n2. Add tests",
	planExists: true,
	planFilePath: "local://PLAN.md",
	preloadedSkills: [{ name: "semantic-compression", content: "preloaded skill content" }],
	readFiles: ["packages/coding-agent/src/prompts/system/custom-system-prompt.md"],
	repeatToolDescriptions: true,
	reentry: false,
	request: "Create an agent to review prompt templates",
	retryCount: 1,
	rules: [{ name: "rs-no-unwrap", description: "Avoid unwrap", globs: ["**/*.rs"] }],
	skills: [{ name: "system-prompts", description: "Prompt design skill" }],
	systemPromptCustomization: "System customization",
	toolInfo: [{ name: "read", label: "Read", description: "Reads files" }],
	tools: ["read", "grep", "find", "edit", "task", "web_search", "todo_write"],
	worktree: "/tmp/pi-issue-147",
	writeToolName: "write",
};

const expectedMarkerByTemplate = new Map<string, string>([
	["agent-creation-architect.md", "elite AI agent architect"],
	["agent-creation-user.md", "Design a custom agent for this request"],
	["custom-system-prompt.md", "Current working directory:"],
	["file-operations.md", "<read-files>"],
	["plan-mode-active.md", "Plan mode active."],
	["plan-mode-approved.md", "Plan approved."],
	["plan-mode-reference.md", "## Existing Plan"],
	["plan-mode-subagent.md", "Plan mode active."],
	["subagent-submit-reminder.md", "You stopped without calling submit_result"],
	["subagent-system-prompt.md", "Acting as"],
	["subagent-user-prompt.md", "Task"],
	["summarization-system.md", "context summarization assistant"],
	["system-prompt.md", "Environment"],
	["title-system.md", "Generate a very short title"],
	["ttsr-interrupt.md", '<system-interrupt reason="rule_violation"'],
	["web-search.md", "<priorities>"],
]);

async function loadSystemPromptTemplates(): Promise<Map<string, string>> {
	const templates = new Map<string, string>();
	const glob = new Bun.Glob("*.md");

	for await (const fileName of glob.scan({ cwd: systemPromptsDir, onlyFiles: true })) {
		const templatePath = path.join(systemPromptsDir, fileName);
		templates.set(fileName, await Bun.file(templatePath).text());
	}

	return templates;
}

describe("system Handlebars prompt templates", () => {
	test("compiles and renders every system template with representative context", async () => {
		const templates = await loadSystemPromptTemplates();
		expect(templates.size).toBeGreaterThan(0);

		for (const [fileName, template] of templates) {
			const rendered = renderPromptTemplate(template, baseRenderContext);
			expect(rendered.length).toBeGreaterThan(0);
			expect(rendered).not.toContain("{{#");
			expect(rendered).not.toContain("{{/");

			const expectedMarker = expectedMarkerByTemplate.get(fileName);
			expect(expectedMarker, `Missing expected marker for ${fileName}`).toBeDefined();
			expect(rendered).toContain(expectedMarker!);
		}
	});

	test("custom-system-prompt renders project section for context and git combinations", async () => {
		const templatePath = path.join(systemPromptsDir, "custom-system-prompt.md");
		const template = await Bun.file(templatePath).text();

		const both = renderPromptTemplate(template, {
			...baseRenderContext,
			contextFiles: [{ path: "a.txt", content: "A" }],
			git: { ...((baseRenderContext.git as Record<string, unknown>) ?? {}), isRepo: true },
		});
		expect(both).toContain("<project>");
		expect(both).toContain("## Context");
		expect(both).toContain("## Version Control");

		const contextOnly = renderPromptTemplate(template, {
			...baseRenderContext,
			contextFiles: [{ path: "a.txt", content: "A" }],
			git: { isRepo: false },
		});
		expect(contextOnly).toContain("<project>");
		expect(contextOnly).toContain("## Context");
		expect(contextOnly).not.toContain("## Version Control");

		const gitOnly = renderPromptTemplate(template, {
			...baseRenderContext,
			contextFiles: [],
			git: {
				isRepo: true,
				currentBranch: "feature/tests",
				mainBranch: "main",
				status: "clean",
				commits: "abc123 test commit",
			},
		});
		expect(gitOnly).toContain("<project>");
		expect(gitOnly).not.toContain("## Context");
		expect(gitOnly).toContain("## Version Control");

		const neither = renderPromptTemplate(template, {
			...baseRenderContext,
			contextFiles: [],
			git: { isRepo: false },
		});
		expect(neither).not.toContain("<project>");
		expect(neither).not.toContain("## Context");
		expect(neither).not.toContain("## Version Control");
	});
});
