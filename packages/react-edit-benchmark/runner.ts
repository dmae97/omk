/**
 * Edit benchmark runner.
 *
 * Orchestrates benchmark runs by launching RPC clients, sending prompts,
 * and verifying results. Supports parallel runs for reliability measurement.
 */

import type { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import { RpcClient } from "@oh-my-pi/pi-coding-agent";
import { createTempDir } from "@oh-my-pi/pi-utils";
import { appendFile, cp, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { formatDirectory } from "./formatter";
import { extractTaskFiles, type EditTask } from "./tasks";
import { verifyExpectedFileSubset, verifyExpectedFiles } from "./verify";

const TMP_DIR = await createTempDir("@reach-benchmark-");
const TMP = TMP_DIR.path;

export interface BenchmarkConfig {
	provider: string;
	model: string;
	thinkingLevel?: ThinkingLevel;
	runsPerTask: number;
	timeout: number;
	taskConcurrency: number;
	requireEditToolCall?: boolean;
	noEditRequired?: boolean;
	autoFormat?: boolean;
	editVariant?: "replace" | "patch" | "auto";
	editFuzzy?: boolean | "auto";
	editFuzzyThreshold?: number | "auto";
}

export interface TokenStats {
	input: number;
	output: number;
	total: number;
}

export interface ToolCallStats {
	read: number;
	edit: number;
	write: number;
	editSuccesses: number;
	editFailures: number;
	totalInputChars: number;
}

export interface EditFailure {
	toolCallId: string;
	args: unknown;
	error: string;
}

export interface TaskRunResult {
	runIndex: number;
	success: boolean;
	patchApplied: boolean;
	verificationPassed: boolean;
	seed?: number;
	mutationType?: string;
	mutationCategory?: string;
	difficultyScore?: number;
	error?: string;
	tokens: TokenStats;
	duration: number;
	indentScore?: number;
	formattedEquivalent?: boolean;
	diffStats?: { linesChanged: number; charsChanged: number };
	agentResponse?: string;
	diff?: string;
	toolCalls: ToolCallStats;
	editFailures: EditFailure[];
}

export interface ProgressEvent {
	taskId: string;
	runIndex: number;
	status: "started" | "completed";
	result?: TaskRunResult;
}

export interface TaskResult {
	id: string;
	name: string;
	files: string[];
	runs: TaskRunResult[];
	successRate: number;
	avgTokens: TokenStats;
	avgDuration: number;
	avgIndentScore: number;
	avgToolCalls: ToolCallStats;
	editSuccessRate: number;
}

export interface BenchmarkSummary {
	totalTasks: number;
	totalRuns: number;
	successfulRuns: number;
	overallSuccessRate: number;
	tasksWithAllPassing: number;
	tasksWithAnyFailing: number;
	totalTokens: TokenStats;
	avgTokensPerRun: TokenStats;
	totalDuration: number;
	avgDurationPerRun: number;
	avgIndentScore: number;
	totalToolCalls: ToolCallStats;
	avgToolCallsPerRun: ToolCallStats;
	editSuccessRate: number;
}

export interface BenchmarkResult {
	config: BenchmarkConfig;
	tasks: TaskResult[];
	summary: BenchmarkSummary;
	startTime: string;
	endTime: string;
}

interface TaskRunItem {
	task: EditTask;
	runIndex: number;
}

const BATCH_MIN_SIZE = 3;
const BATCH_MAX_SIZE = 5;

async function copyFixtures(task: EditTask, destDir: string): Promise<void> {
	if (task.tarballPath) {
		await extractTaskFiles(task.tarballPath, task.id, destDir, "input");
	} else if (task.inputDir) {
		const entries = await readdir(task.inputDir, { withFileTypes: true });
		await Promise.all(
			entries.map((entry) => cp(join(task.inputDir!, entry.name), join(destDir, entry.name), { recursive: true })),
		);
	} else {
		throw new Error(`Task ${task.id} has neither tarballPath nor inputDir`);
	}
}

async function getExpectedDir(task: EditTask): Promise<{ dir: string; cleanup: () => Promise<void> }> {
	if (task.expectedDir) {
		return { dir: task.expectedDir, cleanup: async () => {} };
	}
	if (task.tarballPath) {
		const tempDir = join(TMP, `expected-${task.id}-${crypto.randomUUID()}`);
		await mkdir(tempDir, { recursive: true });
		await extractTaskFiles(task.tarballPath, task.id, tempDir, "expected");
		return {
			dir: tempDir,
			cleanup: async () => {
				await rm(tempDir, { recursive: true, force: true }).catch(() => {});
			},
		};
	}
	throw new Error(`Task ${task.id} has neither tarballPath nor expectedDir`);
}

async function runSingleTask(
	task: EditTask,
	runIndex: number,
	config: BenchmarkConfig,
	cwd: string,
	expectedDir: string,
	cliPath: string,
): Promise<TaskRunResult> {
	const startTime = Date.now();
	let client: RpcClient | null = null;
	let error: string | undefined;
	let patchApplied = false;
	let verificationPassed = false;
	let indentScore: number | undefined;
	let formattedEquivalent: boolean | undefined;
	let diffStats: { linesChanged: number; charsChanged: number } | undefined;
	let tokens: TokenStats = { input: 0, output: 0, total: 0 };
	let agentResponse: string | undefined;
	let diff: string | undefined;
	let editFailures: EditFailure[] = [];
	let toolStats = {
		read: 0,
		edit: 0,
		write: 0,
		editSuccesses: 0,
		editFailures: 0,
		totalInputChars: 0,
	};

	const logFile = join(TMP, `run-${task.id}-${runIndex}.jsonl`);
	const logEvent = async (event: unknown) => {
		await appendFile(logFile, JSON.stringify(event) + "\n");
	};

	try {
		await appendFile(logFile, `{"type":"meta","task":"${task.id}","run":${runIndex},"workDir":"${cwd}"}\n`);

		const env: Record<string, string> = { OMP_NO_TITLE: "1" };
		if (config.editVariant !== undefined) {
			env.OMP_EDIT_VARIANT = config.editVariant;
		}
		if (config.editFuzzy !== undefined) {
			env.OMP_EDIT_FUZZY = config.editFuzzy === "auto" ? "auto" : config.editFuzzy ? "1" : "0";
		}
		if (config.editFuzzyThreshold !== undefined) {
			env.OMP_EDIT_FUZZY_THRESHOLD =
				config.editFuzzyThreshold === "auto" ? "auto" : String(config.editFuzzyThreshold);
		}

		client = new RpcClient({
			cliPath,
			cwd,
			provider: config.provider,
			model: config.model,
			args: ["--tools", "read,edit,write,ls"],
			env,
		});

		await client.start();

		if (config.thinkingLevel) {
			await client.setThinkingLevel(config.thinkingLevel);
		}

		const promptWithContext = `You are working in a repository with a single edit task.

${task.prompt}

**Important constraints:**
- Make the minimum change necessary. Do not refactor, improve, or "clean up" other code.
- If you see multiple similar patterns, only change the ONE that is buggy.
- Preserve exact code structure. Do not rearrange statements or change formatting.

${
	config.noEditRequired
		? "Read the relevant files first, then apply the fix."
		: "Read the relevant files first, then use the edit tool to apply the fix."
}`;

		await appendFile(logFile, `{"type":"prompt","message":${JSON.stringify(promptWithContext)}}\n`);

		// Collect events with logging
		const events: Array<{ type: string; [key: string]: unknown }> = [];
		const eventsPromise = new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => {
				reject(new Error("Timeout waiting for agent_end"));
			}, config.timeout);

			let pendingRetry = false;

			client!.onEvent(async (event) => {
				events.push(event);

				// Only log tool calls and complete messages
				if (
					event.type === "tool_execution_start" ||
					event.type === "tool_execution_end" ||
					event.type === "message_end"
				) {
					await logEvent(event);
				}

				// Track retry state
				if ((event.type as string) === "auto_retry_start") {
					pendingRetry = true;
				} else if (event.type === "turn_start" && pendingRetry) {
					pendingRetry = false;
				}

				if (event.type === "agent_end") {
					// If there's a pending retry, don't resolve yet
					if (pendingRetry) {
						return;
					}
					clearTimeout(timer);
					resolve();
				}
			});
		});

		await client.prompt(promptWithContext);
		await eventsPromise;

		const stats = await client.getSessionStats();
		tokens = { input: stats.tokens.input, output: stats.tokens.output, total: stats.tokens.total };
		await logEvent({ type: "stats", ...stats });

		agentResponse = (await client.getLastAssistantText()) ?? undefined;
		await logEvent({ type: "response", text: agentResponse });

		// Count tool calls and track success/failure
		const pendingEdits = new Map<string, unknown>();

		for (const event of events) {
			if (event.type === "tool_execution_start") {
				const e = event as { toolName?: string; toolCallId?: string; args?: unknown };
				const toolName = e.toolName;
				if (toolName === "read") toolStats.read++;
				else if (toolName === "edit") {
					toolStats.edit++;
					if (e.toolCallId) pendingEdits.set(e.toolCallId, e.args);
				} else if (toolName === "write") toolStats.write++;

				// Count input chars from args
				if (e.args) {
					toolStats.totalInputChars += JSON.stringify(e.args).length;
				}
			} else if (event.type === "tool_execution_end") {
				const e = event as { toolName?: string; toolCallId?: string; isError?: boolean; result?: unknown };
				if (e.toolName === "edit" && e.toolCallId && pendingEdits.has(e.toolCallId)) {
					const args = pendingEdits.get(e.toolCallId) ?? null;
					pendingEdits.delete(e.toolCallId);
					if (e.isError) {
						toolStats.editFailures++;
						const error = extractToolErrorMessage(e.result);
						editFailures.push({ toolCallId: e.toolCallId, args, error });
					} else {
						toolStats.editSuccesses++;
					}
				}
			}
		}

		patchApplied = toolStats.edit > 0;

		const verification = await verifyExpectedFiles(expectedDir, cwd);
		if (config.autoFormat) {
			await formatDirectory(cwd);
		}

		verificationPassed = verification.success;
		indentScore = verification.indentScore;
		formattedEquivalent = verification.formattedEquivalent;
		diffStats = verification.diffStats;
		diff = verification.diff;
		if (!verification.success && verification.error) {
			error = verification.error;
		}
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
		await logEvent({ type: "error", error });
	} finally {
		if (client) {
			try {
				await client.stop();
			} catch {
				// Ignore stop errors
			}
		}
	}

	const duration = Date.now() - startTime;
	const mustUseEditTool = Boolean(config.requireEditToolCall) && !config.noEditRequired;
	const success = verificationPassed && (!mustUseEditTool || patchApplied);
	const metadata = task.metadata;

	await logEvent({ type: "result", success, patchApplied, verificationPassed, error, duration });
	console.log(`  Log: ${logFile}`);

	return {
		runIndex,
		success,
		patchApplied,
		verificationPassed,
		seed: metadata?.seed,
		mutationType: metadata?.mutationType,
		mutationCategory: metadata?.mutationCategory,
		difficultyScore: metadata?.difficultyScore,
		error,
		tokens,
		duration,
		indentScore,
		formattedEquivalent,
		diffStats,
		agentResponse,
		diff,
		toolCalls: toolStats,
		editFailures,
	};
}

async function runBatchedTask(
	item: TaskRunItem,
	config: BenchmarkConfig,
	cwd: string,
	expectedDir: string,
	client: RpcClient,
): Promise<TaskRunResult> {
	const startTime = Date.now();
	const task = item.task;
	const runIndex = item.runIndex;
	let error: string | undefined;
	let patchApplied = false;
	let verificationPassed = false;
	let indentScore: number | undefined;
	let formattedEquivalent: boolean | undefined;
	let diffStats: { linesChanged: number; charsChanged: number } | undefined;
	let tokens: TokenStats = { input: 0, output: 0, total: 0 };
	let agentResponse: string | undefined;
	let diff: string | undefined;
	let editFailures: EditFailure[] = [];
	let toolStats = {
		read: 0,
		edit: 0,
		write: 0,
		editSuccesses: 0,
		editFailures: 0,
		totalInputChars: 0,
	};

	const logFile = join(TMP, `run-${task.id}-${runIndex}.jsonl`);
	const logEvent = async (event: unknown) => {
		await appendFile(logFile, JSON.stringify(event) + "\n");
	};

	try {
		await appendFile(
			logFile,
			`{"type":"meta","task":"${task.id}","run":${runIndex},"workDir":"${cwd}","batched":true}\n`,
		);

		const promptWithContext = buildPrompt(task, config);
		await appendFile(logFile, `{"type":"prompt","message":${JSON.stringify(promptWithContext)}}\n`);

		const statsBefore = await client.getSessionStats();
		const events = await collectPromptEvents(client, promptWithContext, config, logEvent);
		const statsAfter = await client.getSessionStats();
		tokens = diffTokenStats(statsBefore, statsAfter);
		await logEvent({ type: "stats", before: statsBefore, after: statsAfter });

		agentResponse = (await client.getLastAssistantText()) ?? undefined;
		await logEvent({ type: "response", text: agentResponse });

		const pendingEdits = new Map<string, unknown>();

		for (const event of events) {
			if (event.type === "tool_execution_start") {
				const e = event as { toolName?: string; toolCallId?: string; args?: unknown };
				const toolName = e.toolName;
				if (toolName === "read") toolStats.read++;
				else if (toolName === "edit") {
					toolStats.edit++;
					if (e.toolCallId) pendingEdits.set(e.toolCallId, e.args);
				} else if (toolName === "write") toolStats.write++;

				if (e.args) {
					toolStats.totalInputChars += JSON.stringify(e.args).length;
				}
			} else if (event.type === "tool_execution_end") {
				const e = event as { toolName?: string; toolCallId?: string; isError?: boolean; result?: unknown };
				if (e.toolName === "edit" && e.toolCallId && pendingEdits.has(e.toolCallId)) {
					const args = pendingEdits.get(e.toolCallId) ?? null;
					pendingEdits.delete(e.toolCallId);
					if (e.isError) {
						toolStats.editFailures++;
						const toolError = extractToolErrorMessage(e.result);
						editFailures.push({ toolCallId: e.toolCallId, args, error: toolError });
					} else {
						toolStats.editSuccesses++;
					}
				}
			}
		}

		patchApplied = toolStats.edit > 0;

		const filesToVerify = task.files.length > 0 ? task.files : undefined;
		const verification = await verifyExpectedFileSubset(expectedDir, cwd, filesToVerify);
		if (config.autoFormat) {
			await formatDirectory(cwd);
		}

		verificationPassed = verification.success;
		indentScore = verification.indentScore;
		formattedEquivalent = verification.formattedEquivalent;
		diffStats = verification.diffStats;
		diff = verification.diff;
		if (!verification.success && verification.error) {
			error = verification.error;
		}
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
		await logEvent({ type: "error", error });
	}

	const duration = Date.now() - startTime;
	const mustUseEditTool = Boolean(config.requireEditToolCall) && !config.noEditRequired;
	const success = verificationPassed && (!mustUseEditTool || patchApplied);
	const metadata = task.metadata;

	await logEvent({ type: "result", success, patchApplied, verificationPassed, error, duration });
	console.log(`  Log: ${logFile}`);

	return {
		runIndex,
		success,
		patchApplied,
		verificationPassed,
		seed: metadata?.seed,
		mutationType: metadata?.mutationType,
		mutationCategory: metadata?.mutationCategory,
		difficultyScore: metadata?.difficultyScore,
		error,
		tokens,
		duration,
		indentScore,
		formattedEquivalent,
		diffStats,
		agentResponse,
		diff,
		toolCalls: toolStats,
		editFailures,
	};
}

function extractToolErrorMessage(result: unknown): string {
	if (typeof result === "string") return result;
	if (!result || typeof result !== "object") return "Unknown error";
	const content = (result as { content?: unknown }).content;
	if (Array.isArray(content)) {
		for (const entry of content) {
			if (!entry || typeof entry !== "object") continue;
			if (!("text" in entry)) continue;
			const text = (entry as { text?: unknown }).text;
			if (typeof text === "string") return text;
		}
	}
	try {
		return JSON.stringify(result);
	} catch {
		return "Unknown error";
	}
}

function shuffle<T>(items: T[]): T[] {
	const copy = items.slice();
	for (let i = copy.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[copy[i], copy[j]] = [copy[j]!, copy[i]!];
	}
	return copy;
}

function pickBatchSize(remaining: number): number {
	const maxSize = Math.min(BATCH_MAX_SIZE, remaining);
	const minSize = Math.min(BATCH_MIN_SIZE, maxSize);
	return minSize + Math.floor(Math.random() * (maxSize - minSize + 1));
}

function taskFileKeys(task: EditTask): string[] {
	return task.files.slice().sort();
}

function buildRunBatches(items: TaskRunItem[]): TaskRunItem[][] {
	const pending = shuffle(items);
	const batches: TaskRunItem[][] = [];

	while (pending.length > 0) {
		const targetSize = pickBatchSize(pending.length);
		const batch: TaskRunItem[] = [];
		const usedFiles = new Set<string>();

		for (let i = 0; i < pending.length && batch.length < targetSize; ) {
			const item = pending[i]!;
			const files = taskFileKeys(item.task);
			if (files.some((file) => usedFiles.has(file))) {
				i += 1;
				continue;
			}
			pending.splice(i, 1);
			batch.push(item);
			for (const file of files) {
				usedFiles.add(file);
			}
		}

		if (batch.length === 0 && pending.length > 0) {
			batch.push(pending.shift()!);
		}

		batches.push(shuffle(batch));
	}

	return batches;
}

function buildPrompt(task: EditTask, config: BenchmarkConfig): string {
	return `You are working in a repository with multiple unrelated files.

${task.prompt}

**Important constraints:**
- Make the minimum change necessary. Do not refactor, improve, or "clean up" other code.
- If you see multiple similar patterns, only change the ONE that is buggy.
- Preserve exact code structure. Do not rearrange statements or change formatting.
- Only modify the file(s) referenced by this request. Leave all other files unchanged.

${
	config.noEditRequired
		? "Read the relevant files first, then apply the fix."
		: "Read the relevant files first, then use the edit tool to apply the fix."
}`;
}

async function collectPromptEvents(
	client: RpcClient,
	prompt: string,
	config: BenchmarkConfig,
	logEvent: (event: unknown) => Promise<void>,
): Promise<Array<{ type: string; [key: string]: unknown }>> {
	const events: Array<{ type: string; [key: string]: unknown }> = [];
	let unsubscribe: (() => void) | undefined;
	const eventsPromise = new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			unsubscribe?.();
			reject(new Error("Timeout waiting for agent_end"));
		}, config.timeout);

		let pendingRetry = false;

		unsubscribe = client.onEvent(async (event) => {
			events.push(event);

			if (
				event.type === "tool_execution_start" ||
				event.type === "tool_execution_end" ||
				event.type === "message_end"
			) {
				await logEvent(event);
			}

			if ((event.type as string) === "auto_retry_start") {
				pendingRetry = true;
			} else if (event.type === "turn_start" && pendingRetry) {
				pendingRetry = false;
			}

			if (event.type === "agent_end") {
				if (pendingRetry) {
					return;
				}
				clearTimeout(timer);
				unsubscribe?.();
				resolve();
			}
		});
	});

	try {
		await client.prompt(prompt);
	} catch (err) {
		unsubscribe?.();
		throw err;
	}
	await eventsPromise;
	return events;
}

function diffTokenStats(
	before: { tokens: { input: number; output: number; total: number } },
	after: { tokens: { input: number; output: number; total: number } },
): TokenStats {
	const input = Math.max(0, after.tokens.input - before.tokens.input);
	const output = Math.max(0, after.tokens.output - before.tokens.output);
	const total = Math.max(0, after.tokens.total - before.tokens.total);
	return { input, output, total };
}

function summarizeTaskRuns(task: EditTask, runs: TaskRunResult[]): TaskResult {
	const orderedRuns = runs.slice().sort((a, b) => a.runIndex - b.runIndex);
	const n = orderedRuns.length;
	const successfulRuns = orderedRuns.filter((r) => r.success).length;
	const successRate = n > 0 ? successfulRuns / n : 0;

	const avgTokens: TokenStats =
		n > 0
			? {
					input: Math.round(orderedRuns.reduce((sum, r) => sum + r.tokens.input, 0) / n),
					output: Math.round(orderedRuns.reduce((sum, r) => sum + r.tokens.output, 0) / n),
					total: Math.round(orderedRuns.reduce((sum, r) => sum + r.tokens.total, 0) / n),
				}
			: { input: 0, output: 0, total: 0 };

	const avgDuration = n > 0 ? Math.round(orderedRuns.reduce((sum, r) => sum + r.duration, 0) / n) : 0;
	const indentScores = orderedRuns
		.map((run) => run.indentScore)
		.filter((score): score is number => typeof score === "number");
	const avgIndentScore =
		indentScores.length > 0 ? indentScores.reduce((sum, score) => sum + score, 0) / indentScores.length : 0;

	const avgToolCalls: ToolCallStats =
		n > 0
			? {
					read: orderedRuns.reduce((sum, r) => sum + r.toolCalls.read, 0) / n,
					edit: orderedRuns.reduce((sum, r) => sum + r.toolCalls.edit, 0) / n,
					write: orderedRuns.reduce((sum, r) => sum + r.toolCalls.write, 0) / n,
					editSuccesses: orderedRuns.reduce((sum, r) => sum + r.toolCalls.editSuccesses, 0) / n,
					editFailures: orderedRuns.reduce((sum, r) => sum + r.toolCalls.editFailures, 0) / n,
					totalInputChars: orderedRuns.reduce((sum, r) => sum + r.toolCalls.totalInputChars, 0) / n,
				}
			: { read: 0, edit: 0, write: 0, editSuccesses: 0, editFailures: 0, totalInputChars: 0 };

	const totalEditAttempts = orderedRuns.reduce((sum, r) => sum + r.toolCalls.edit, 0);
	const totalEditSuccesses = orderedRuns.reduce((sum, r) => sum + r.toolCalls.editSuccesses, 0);
	const editSuccessRate = totalEditAttempts > 0 ? totalEditSuccesses / totalEditAttempts : 1;

	return {
		id: task.id,
		name: task.name,
		files: task.files,
		runs: orderedRuns,
		successRate,
		avgTokens,
		avgDuration,
		avgIndentScore,
		avgToolCalls,
		editSuccessRate,
	};
}

function buildFailureResult(item: TaskRunItem, error: string): TaskRunResult {
	return {
		runIndex: item.runIndex,
		success: false,
		patchApplied: false,
		verificationPassed: false,
		error,
		tokens: { input: 0, output: 0, total: 0 },
		duration: 0,
		toolCalls: {
			read: 0,
			edit: 0,
			write: 0,
			editSuccesses: 0,
			editFailures: 0,
			totalInputChars: 0,
		},
		editFailures: [],
	};
}

async function runBatch(
	items: TaskRunItem[],
	config: BenchmarkConfig,
	cliPath: string,
	onProgress?: (event: ProgressEvent) => void,
): Promise<Array<{ task: EditTask; result: TaskRunResult }>> {
	const workDir = join(TMP, `batch-${crypto.randomUUID()}`);
	await mkdir(workDir, { recursive: true });
	const results: Array<{ task: EditTask; result: TaskRunResult }> = [];
	let client: RpcClient | null = null;
	const expectedDirs = new Map<string, { dir: string; cleanup: () => Promise<void> }>();

	const orderedItems = shuffle(items);
	const remaining = orderedItems.slice();

	try {
		await Promise.all(
			orderedItems.map(async (item) => {
				const expected = await getExpectedDir(item.task);
				expectedDirs.set(item.task.id, expected);
			}),
		);

		await Promise.all(orderedItems.map((item) => copyFixtures(item.task, workDir)));

		const env: Record<string, string> = { OMP_NO_TITLE: "1" };
		if (config.editVariant !== undefined) {
			env.OMP_EDIT_VARIANT = config.editVariant;
		}
		if (config.editFuzzy !== undefined) {
			env.OMP_EDIT_FUZZY = config.editFuzzy === "auto" ? "auto" : config.editFuzzy ? "1" : "0";
		}
		if (config.editFuzzyThreshold !== undefined) {
			env.OMP_EDIT_FUZZY_THRESHOLD =
				config.editFuzzyThreshold === "auto" ? "auto" : String(config.editFuzzyThreshold);
		}

		client = new RpcClient({
			cliPath,
			cwd: workDir,
			provider: config.provider,
			model: config.model,
			args: ["--tools", "read,edit,write,ls"],
			env,
		});

		await client.start();

		if (config.thinkingLevel) {
			await client.setThinkingLevel(config.thinkingLevel);
		}

		for (const item of orderedItems) {
			const expectedDir = expectedDirs.get(item.task.id)?.dir;
			if (!expectedDir) {
				throw new Error(`Missing expected directory for task ${item.task.id}`);
			}

			onProgress?.({ taskId: item.task.id, runIndex: item.runIndex, status: "started" });
			const result = await runBatchedTask(item, config, workDir, expectedDir, client);
			onProgress?.({ taskId: item.task.id, runIndex: item.runIndex, status: "completed", result });
			results.push({ task: item.task, result });
			remaining.shift();
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		for (const item of remaining) {
			const result = buildFailureResult(item, message);
			onProgress?.({ taskId: item.task.id, runIndex: item.runIndex, status: "completed", result });
			results.push({ task: item.task, result });
		}
	} finally {
		for (const expected of expectedDirs.values()) {
			await expected.cleanup();
		}
		if (client) {
			try {
				await client.stop();
			} catch {
				// Ignore stop errors
			}
		}
		try {
			await rm(workDir, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors
		}
	}

	return results;
}

export async function runTask(
	task: EditTask,
	config: BenchmarkConfig,
	onProgress?: (event: ProgressEvent) => void,
): Promise<TaskResult> {
	const tempDirs: Array<Awaited<ReturnType<typeof createTempDir>>> = [];
	const { dir: expectedDir, cleanup: cleanupExpected } = await getExpectedDir(task);

	const cliPath = join(import.meta.dir, "../coding-agent/src/cli.ts");

	try {
		for (let i = 0; i < config.runsPerTask; i++) {
			const tempDir = await createTempDir(join(TMP, `${task.id}-`));
			tempDirs.push(tempDir);
			await copyFixtures(task, tempDir.path);
		}

		const runPromises = tempDirs.map(async (tempDirObj, index) => {
			onProgress?.({ taskId: task.id, runIndex: index, status: "started" });
			const result = await runSingleTask(task, index, config, tempDirObj.path, expectedDir, cliPath);
			onProgress?.({ taskId: task.id, runIndex: index, status: "completed", result });
			return result;
		});

		const runs = await Promise.all(runPromises);
		return summarizeTaskRuns(task, runs);
	} finally {
		await cleanupExpected();
		for (const tempDirObj of tempDirs) {
			try {
				await tempDirObj.remove();
			} catch {
				// Ignore cleanup errors
			}
		}
	}
}

export async function runBenchmark(
	tasks: EditTask[],
	config: BenchmarkConfig,
	onProgress?: (event: ProgressEvent) => void,
): Promise<BenchmarkResult> {
	const startTime = new Date().toISOString();
	const runItems: TaskRunItem[] = tasks.flatMap((task) =>
		Array.from({ length: config.runsPerTask }, (_, runIndex) => ({ task, runIndex })),
	);

	const batches = buildRunBatches(runItems);
	const resultsByTask = new Map<string, TaskRunResult[]>();
	const concurrency = Math.max(1, Math.floor(config.taskConcurrency));
	const pendingBatches = [...batches];
	const running: Promise<void>[] = [];
	const cliPath = join(import.meta.dir, "../coding-agent/src/cli.ts");

	const runNext = async (): Promise<void> => {
		const nextBatch = pendingBatches.shift();
		if (!nextBatch) return;
		const batchResults = await runBatch(nextBatch, config, cliPath, onProgress);
		for (const { task, result } of batchResults) {
			const list = resultsByTask.get(task.id) ?? [];
			list.push(result);
			resultsByTask.set(task.id, list);
		}
		await runNext();
	};

	const slots = Math.min(concurrency, pendingBatches.length || 0);
	for (let i = 0; i < slots; i++) {
		running.push(runNext());
	}

	await Promise.all(running);

	const taskResults = tasks.map((task) => summarizeTaskRuns(task, resultsByTask.get(task.id) ?? []));

	const endTime = new Date().toISOString();

	const allRuns = taskResults.flatMap((t) => t.runs);
	const totalRuns = allRuns.length;
	const successfulRuns = allRuns.filter((r) => r.success).length;

	const totalTokens: TokenStats = {
		input: allRuns.reduce((sum, r) => sum + r.tokens.input, 0),
		output: allRuns.reduce((sum, r) => sum + r.tokens.output, 0),
		total: allRuns.reduce((sum, r) => sum + r.tokens.total, 0),
	};

	const totalDuration = allRuns.reduce((sum, r) => sum + r.duration, 0);
	const indentScores = allRuns
		.map((run) => run.indentScore)
		.filter((score): score is number => typeof score === "number");
	const avgIndentScore =
		indentScores.length > 0 ? indentScores.reduce((sum, score) => sum + score, 0) / indentScores.length : 0;

	const totalToolCalls: ToolCallStats = {
		read: allRuns.reduce((sum, r) => sum + r.toolCalls.read, 0),
		edit: allRuns.reduce((sum, r) => sum + r.toolCalls.edit, 0),
		write: allRuns.reduce((sum, r) => sum + r.toolCalls.write, 0),
		editSuccesses: allRuns.reduce((sum, r) => sum + r.toolCalls.editSuccesses, 0),
		editFailures: allRuns.reduce((sum, r) => sum + r.toolCalls.editFailures, 0),
		totalInputChars: allRuns.reduce((sum, r) => sum + r.toolCalls.totalInputChars, 0),
	};

	const editSuccessRate = totalToolCalls.edit > 0 ? totalToolCalls.editSuccesses / totalToolCalls.edit : 1;

	const summary: BenchmarkSummary = {
		totalTasks: tasks.length,
		totalRuns,
		successfulRuns,
		overallSuccessRate: successfulRuns / totalRuns,
		tasksWithAllPassing: taskResults.filter((t) => t.successRate === 1).length,
		tasksWithAnyFailing: taskResults.filter((t) => t.successRate < 1).length,
		totalTokens,
		avgTokensPerRun: {
			input: Math.round(totalTokens.input / totalRuns),
			output: Math.round(totalTokens.output / totalRuns),
			total: Math.round(totalTokens.total / totalRuns),
		},
		totalDuration,
		avgDurationPerRun: Math.round(totalDuration / totalRuns),
		avgIndentScore,
		totalToolCalls,
		avgToolCallsPerRun: {
			read: totalToolCalls.read / totalRuns,
			edit: totalToolCalls.edit / totalRuns,
			write: totalToolCalls.write / totalRuns,
			editSuccesses: totalToolCalls.editSuccesses / totalRuns,
			editFailures: totalToolCalls.editFailures / totalRuns,
			totalInputChars: totalToolCalls.totalInputChars / totalRuns,
		},
		editSuccessRate,
	};

	return {
		config,
		tasks: taskResults,
		summary,
		startTime,
		endTime,
	};
}
