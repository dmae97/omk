import type { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import type { Usage } from "@oh-my-pi/pi-ai";
import { type Static, Type } from "@sinclair/typebox";

/** Source of an agent definition */
export type AgentSource = "bundled" | "user" | "project";

function getEnv(name: string, defaultValue: number): number {
	const value = process.env[name];
	if (value === undefined) {
		return defaultValue;
	}
	try {
		const number = Number.parseInt(value, 10);
		if (!Number.isNaN(number) && number > 0) {
			return number;
		}
	} catch {}
	return defaultValue;
}

/** Maximum tasks per call */
export const MAX_PARALLEL_TASKS = getEnv("OMP_TASK_MAX_PARALLEL", 32);

/** Maximum concurrent workers */
export const MAX_CONCURRENCY = getEnv("OMP_TASK_MAX_CONCURRENCY", 16);

/** Maximum output bytes per agent */
export const MAX_OUTPUT_BYTES = getEnv("OMP_TASK_MAX_OUTPUT_BYTES", 500_000);

/** Maximum output lines per agent */
export const MAX_OUTPUT_LINES = getEnv("OMP_TASK_MAX_OUTPUT_LINES", 5000);

/** EventBus channel for raw subagent events */
export const TASK_SUBAGENT_EVENT_CHANNEL = "task:subagent:event";

/** EventBus channel for aggregated subagent progress */
export const TASK_SUBAGENT_PROGRESS_CHANNEL = "task:subagent:progress";

/** Single task item for parallel execution */
export const taskItemSchema = Type.Object({
	id: Type.String({
		description: "Task ID, CamelCase, max 32 chars",
		maxLength: 32,
	}),
	description: Type.String({ description: "Short description for display" }),
	args: Type.Optional(
		Type.Record(Type.String(), Type.String(), {
			description: "Arguments to fill {{placeholders}} in context",
		}),
	),
});

export type TaskItem = Static<typeof taskItemSchema>;

/** Task tool parameters */
export const taskSchema = Type.Object({
	agent: Type.String({ description: "Agent type for all tasks" }),
	context: Type.String({ description: "Template with {{placeholders}} for args" }),
	isolated: Type.Optional(Type.Boolean({ description: "Run in isolated git worktree" })),
	output: Type.Optional(
		Type.Record(Type.String(), Type.Unknown(), { description: "JTD schema for structured output" }),
	),
	tasks: Type.Array(taskItemSchema, { description: "Tasks to run in parallel", maxItems: MAX_PARALLEL_TASKS }),
});

export type TaskParams = Static<typeof taskSchema>;

/** A code review finding reported by the reviewer agent */
export interface ReviewFinding {
	title: string;
	body: string;
	priority: number;
	confidence: number;
	file_path: string;
	line_start: number;
	line_end: number;
}

/** Review summary submitted by the reviewer agent */
export interface ReviewSummary {
	overall_correctness: "correct" | "incorrect";
	explanation: string;
	confidence: number;
}

/** Structured review data extracted from reviewer agent */
export interface ReviewData {
	findings: ReviewFinding[];
	summary?: ReviewSummary;
}

/** Agent definition (bundled or discovered) */
export interface AgentDefinition {
	name: string;
	description: string;
	systemPrompt: string;
	tools?: string[];
	spawns?: string[] | "*";
	model?: string;
	thinkingLevel?: ThinkingLevel;
	output?: unknown;
	source: AgentSource;
	filePath?: string;
}

/** Progress tracking for a single agent */
export interface AgentProgress {
	index: number;
	id: string;
	agent: string;
	agentSource: AgentSource;
	status: "pending" | "running" | "completed" | "failed" | "aborted";
	task: string;
	args?: Record<string, string>;
	description?: string;
	currentTool?: string;
	currentToolArgs?: string;
	currentToolStartMs?: number;
	recentTools: Array<{ tool: string; args: string; endMs: number }>;
	recentOutput: string[];
	toolCount: number;
	tokens: number;
	durationMs: number;
	modelOverride?: string;
	/** Data extracted by registered subprocess tool handlers (keyed by tool name) */
	extractedToolData?: Record<string, unknown[]>;
}

/** Result from a single agent execution */
export interface SingleResult {
	index: number;
	id: string;
	agent: string;
	agentSource: AgentSource;
	task: string;
	args?: Record<string, string>;
	description?: string;
	exitCode: number;
	output: string;
	stderr: string;
	truncated: boolean;
	durationMs: number;
	tokens: number;
	modelOverride?: string;
	error?: string;
	aborted?: boolean;
	/** Aggregated usage from the subprocess, accumulated incrementally from message_end events. */
	usage?: Usage;
	/** Output path for the task result */
	outputPath?: string;
	/** Patch path for isolated worktree output */
	patchPath?: string;
	/** Data extracted by registered subprocess tool handlers (keyed by tool name) */
	extractedToolData?: Record<string, unknown[]>;
	/** Output metadata for agent:// URL integration */
	outputMeta?: { lineCount: number; charCount: number };
}

/** Tool details for TUI rendering */
export interface TaskToolDetails {
	projectAgentsDir: string | null;
	results: SingleResult[];
	totalDurationMs: number;
	/** Aggregated usage across all subagents. */
	usage?: Usage;
	outputPaths?: string[];
	progress?: AgentProgress[];
}
