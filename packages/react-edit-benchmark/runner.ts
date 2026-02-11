/**
 * Edit benchmark runner.
 *
 * Orchestrates benchmark runs by launching RPC clients, sending prompts,
 * and verifying results. Supports parallel runs for reliability measurement.
 */
/// <reference types="./bun-imports.d.ts" />
import * as fs from "node:fs/promises";
import { join } from "node:path";
import type { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import { RpcClient } from "@oh-my-pi/pi-coding-agent";
import { TempDir } from "@oh-my-pi/pi-utils";
import { renderPromptTemplate } from "../coding-agent/src/config/prompt-templates";
import { computeLineHash } from "../coding-agent/src/patch/hashline";
import { diffLines } from "diff";
import { formatDirectory } from "./formatter";
import { type EditTask, extractTaskFiles } from "./tasks";
import { verifyExpectedFileSubset, verifyExpectedFiles } from "./verify";

import benchmarkTaskPrompt from "./prompts/benchmark-task.md" with { type: "text" };

const TMP_DIR = await TempDir.create("@reach-benchmark-");
const TMP = TMP_DIR.path();

export interface BenchmarkConfig {
	provider: string;
	model: string;
	thinkingLevel?: ThinkingLevel;
	runsPerTask: number;
	timeout: number;
	taskConcurrency: number;
	requireEditToolCall?: boolean;
	requireReadToolCall?: boolean;
	noEditRequired?: boolean;
	autoFormat?: boolean;
	editVariant?: "replace" | "patch" | "hashline" | "auto";
	editFuzzy?: boolean | "auto";
	editFuzzyThreshold?: number | "auto";
	guided?: boolean;
	maxAttempts?: number;
	timeoutRetryCount?: number;
}

function splitLines(value: string): string[] {
	return value.split("\n").filter((line, idx, arr) => idx < arr.length - 1 || line);
}

function getEditPathFromArgs(args: unknown): string | null {
	if (!args || typeof args !== "object") return null;
	const pathValue = (args as { path?: unknown }).path;
	return typeof pathValue === "string" && pathValue.length > 0 ? pathValue : null;
}

const HASHLINE_SUBTYPES = ["replaceLine", "replaceLines", "insertAfter"] as const;

function countHashlineEditSubtypes(args: unknown): Record<string, number> {
	const counts: Record<string, number> = Object.fromEntries(HASHLINE_SUBTYPES.map((k) => [k, 0]));
	if (!args || typeof args !== "object") return counts;
	const edits = (args as { edits?: unknown[] }).edits;
	if (!Array.isArray(edits)) return counts;
	for (const edit of edits) {
		if (!edit || typeof edit !== "object") continue;
		for (const key of HASHLINE_SUBTYPES) {
			if (key in edit) {
				counts[key]++;
				break;
			}
		}
	}
	return counts;
}

async function collectOriginalFileContents(cwd: string, files: string[]): Promise<Map<string, string>> {
	const originals = new Map<string, string>();
	for (const file of files) {
		const fullPath = join(cwd, file);
		try {
			originals.set(fullPath, await Bun.file(fullPath).text());
		} catch {
			// Ignore missing files; not all tasks include all paths in every run.
		}
	}
	return originals;
}

function buildMutationPreviewAgainstOriginal(original: string, current: string, maxLines = 8): string | null {
	if (original === current) return null;

	const changes = diffLines(original, current);
	const preview: string[] = [];
	let lineNum = 1;

	for (const change of changes) {
		const lines = splitLines(change.value);
		if (!change.added && !change.removed) {
			lineNum += lines.length;
			continue;
		}

		if (change.removed) {
			for (const line of lines) {
				const hash = computeLineHash(lineNum, line);
				preview.push(`${lineNum}:${hash}| -${line}`);
				lineNum += 1;
				if (preview.length >= maxLines) return preview.join("\n");
			}
			continue;
		}

		for (const line of lines) {
			const hash = computeLineHash(lineNum, line);
			preview.push(`${lineNum}:${hash}| +${line}`);
			if (preview.length >= maxLines) return preview.join("\n");
		}
	}

	return preview.length > 0 ? preview.join("\n") : null;
}

async function appendNoChangeMutationHint(
	error: string,
	args: unknown,
	cwd: string,
	originalFiles: Map<string, string>
): Promise<string> {
	if (!error.includes("No changes made")) return error;
	const editPath = getEditPathFromArgs(args);
	if (!editPath) return error;

	const fullPath = editPath.startsWith("/") ? editPath : join(cwd, editPath);
	const original = originalFiles.get(fullPath);
	if (original === undefined) return error;

	let current: string;
	try {
		current = await Bun.file(fullPath).text();
	} catch {
		return error;
	}

	const preview = buildMutationPreviewAgainstOriginal(original, current);
	if (!preview) return error;

	return `${error}\nThe file differs from the original fixture at these lines:\n${preview}`;
}

export interface PromptAttemptTelemetry {
	elapsedMs: number;
	eventCount: number;
	toolExecutionStarts: number;
	toolExecutionEnds: number;
	messageEnds: number;
	lastEventType?: string;
	recentEventTypes: string[];
	pendingRetry: boolean;
}

class PromptTimeoutError extends Error {
	telemetry: PromptAttemptTelemetry;

	constructor(telemetry: PromptAttemptTelemetry) {
		super("Timeout waiting for agent_end");
		this.name = "PromptTimeoutError";
		this.telemetry = telemetry;
	}
}

export interface MutationIntentValidation {
	matched: boolean;
	reason: string;
	mutationType?: string;
	file?: string;
	lineNumber?: number;
}

function buildTimeoutRetryContext(telemetry: PromptAttemptTelemetry, retryNumber: number, retryLimit: number): string {
	return [
		`Previous attempt timed out waiting for agent_end after ${telemetry.elapsedMs}ms.`,
		`Observed events=${telemetry.eventCount}, tool_starts=${telemetry.toolExecutionStarts}, tool_ends=${telemetry.toolExecutionEnds}, message_ends=${telemetry.messageEnds}.`,
		telemetry.lastEventType
			? `Last event type: ${telemetry.lastEventType}.`
			: "No events were observed before timeout.",
		`Timeout retry ${retryNumber}/${retryLimit}: emit one minimal, concrete edit attempt quickly and stop.`,
	].join("\n");
}

async function evaluateMutationIntent(
	task: EditTask,
	cwd: string,
	expectedDir: string
): Promise<MutationIntentValidation | null> {
	const metadata = task.metadata;
	const file = metadata?.fileName ?? task.files[0];
	const lineNumber = metadata?.lineNumber;
	if (!file || typeof lineNumber !== "number" || lineNumber < 1) {
		return null;
	}

	const currentPath = file.startsWith("/") ? file : join(cwd, file);
	const expectedPath = file.startsWith("/") ? file : join(expectedDir, file);

	let currentText: string;
	let expectedText: string;
	try {
		currentText = await Bun.file(currentPath).text();
		expectedText = await Bun.file(expectedPath).text();
	} catch {
		return {
			matched: false,
			reason: "Unable to read current/expected target file for mutation-intent check.",
			mutationType: metadata?.mutationType,
			file,
			lineNumber,
		};
	}

	const currentLine = currentText.split("\n")[lineNumber - 1] ?? "";
	const expectedLine = expectedText.split("\n")[lineNumber - 1] ?? "";
	const originalSnippet = metadata?.originalSnippet;
	const mutatedSnippet = metadata?.mutatedSnippet;

	if (currentLine === expectedLine && expectedLine.length > 0) {
		return {
			matched: true,
			reason: "Target line exactly matches expected fixture.",
			mutationType: metadata?.mutationType,
			file,
			lineNumber,
		};
	}

	if (typeof originalSnippet === "string" && originalSnippet.length > 0) {
		const hasOriginal = currentLine.includes(originalSnippet);
		const stillHasMutated =
			typeof mutatedSnippet === "string" && mutatedSnippet.length > 0 ? currentLine.includes(mutatedSnippet) : false;
		if (hasOriginal && !stillHasMutated) {
			return {
				matched: true,
				reason: "Target line contains original snippet and no longer contains mutated snippet.",
				mutationType: metadata?.mutationType,
				file,
				lineNumber,
			};
		}
	}

	return {
		matched: false,
		reason: `Target line mismatch at ${file}:${lineNumber}.`,
		mutationType: metadata?.mutationType,
		file,
		lineNumber,
	};
}

type GuidedHashlineEdit =
	| { replaceLine: { loc: string; content: string } }
	| { replaceLines: { start: string; end: string; content: string } }
	| { insertAfter: { loc: string; content: string } };

function buildGuidedHashlineEdits(actual: string, expected: string): GuidedHashlineEdit[] {
	const changes = diffLines(actual, expected);
	const actualLines = actual.split("\n");

	let line = 1;
	let pendingStart = 1;
	let pendingRemoved: string[] = [];
	let pendingAdded: string[] = [];
	const edits: GuidedHashlineEdit[] = [];

	const flush = () => {
		if (pendingRemoved.length === 0 && pendingAdded.length === 0) {
			return;
		}

		if (pendingRemoved.length === 0) {
			const insertLine = pendingStart;
			if (pendingAdded.length === 0) return;
			if (insertLine === 1) {
				const firstLine = actualLines[0] ?? "";
				const firstRef = `1:${computeLineHash(1, firstLine)}`;
				edits.push({
					replaceLine: { loc: firstRef, content: pendingAdded.join("\n") + "\n" + firstLine },
				});
			} else if (insertLine <= actualLines.length) {
				const afterLine = actualLines[insertLine - 2] ?? "";
				const afterRef = `${insertLine - 1}:${computeLineHash(insertLine - 1, afterLine)}`;
				edits.push({
					insertAfter: { loc: afterRef, content: pendingAdded.join("\n") },
				});
			} else if (insertLine === actualLines.length + 1 && actualLines.length > 0) {
				const afterLine = actualLines[actualLines.length - 1] ?? "";
				const afterRef = `${actualLines.length}:${computeLineHash(actualLines.length, afterLine)}`;
				edits.push({
					insertAfter: { loc: afterRef, content: pendingAdded.join("\n") },
				});
			}
		} else {
			const startLine = pendingStart;
			const endLine = pendingStart + pendingRemoved.length - 1;
			const startContent = actualLines[startLine - 1] ?? "";
			const startRef = `${startLine}:${computeLineHash(startLine, startContent)}`;
			if (startLine === endLine) {
				edits.push({ replaceLine: { loc: startRef, content: pendingAdded.join("\n") } });
			} else {
				const endContent = actualLines[endLine - 1] ?? "";
				const endRef = `${endLine}:${computeLineHash(endLine, endContent)}`;
				edits.push({
					replaceLines: { start: startRef, end: endRef, content: pendingAdded.join("\n") },
				});
			}
		}

		pendingRemoved = [];
		pendingAdded = [];
	};

	for (const change of changes) {
		const lines = splitLines(change.value);
		if (!change.added && !change.removed) {
			flush();
			line += lines.length;
			continue;
		}
		if (pendingRemoved.length === 0 && pendingAdded.length === 0) {
			pendingStart = line;
		}
		if (change.removed) {
			pendingRemoved.push(...lines);
			line += lines.length;
		}
		if (change.added) {
			pendingAdded.push(...lines);
		}
	}
	flush();

	return edits;
}

async function buildGuidedContext(
	task: EditTask,
	cwd: string,
	expectedDir: string,
	config: BenchmarkConfig
): Promise<string | null> {
	if (!config.guided) return null;
	if (config.editVariant !== "hashline") return null;

	const file = task.metadata?.fileName ?? task.files[0];
	if (!file) return null;

	const actualPath = join(cwd, file);
	const expectedPath = join(expectedDir, file);
	const actual = await Bun.file(actualPath)
		.text()
		.catch(() => null);
	const expected = await Bun.file(expectedPath)
		.text()
		.catch(() => null);
	if (actual === null || expected === null) return null;

	const edits = buildGuidedHashlineEdits(actual, expected);
	if (edits.length === 0) return null;
	if (edits.length > 25) return null;

	const args = { path: file, edits };
	const argsText = JSON.stringify(args, null, 2);
	if (argsText.length > 20_000) return null;
	const metaParts: string[] = [];
	if (typeof task.metadata?.lineNumber === "number") metaParts.push(`Line: ${task.metadata.lineNumber}`);
	if (typeof task.metadata?.mutationType === "string") metaParts.push(`Mutation: ${task.metadata.mutationType}`);

	return [
		`Target file: \`${file}\`${metaParts.length > 0 ? ` (${metaParts.join(", ")})` : ""}.`,
		"Apply this edit tool call (single call; copy/paste args exactly):",
		"```diff\n" + argsText + "\n```",
	].join("\n\n");
}

function buildInstructions(config: BenchmarkConfig): string {
	return config.noEditRequired
		? "Read the relevant files first, then apply the fix."
		: "Read the relevant files first, then use the edit tool to apply the fix.";
}

function buildBenchmarkPrompt(params: {
	multiFile: boolean;
	taskPrompt: string;
	guidedContext?: string | null;
	retryContext?: string | null;
	config: BenchmarkConfig;
}): string {
	return renderPromptTemplate(benchmarkTaskPrompt, {
		multiFile: params.multiFile,
		task_prompt: params.taskPrompt,
		guided_context: params.guidedContext ?? undefined,
		retry_context: params.retryContext ?? undefined,
		instructions: buildInstructions(params.config),
	});
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
	/** Hashline edit subtype counts (replaceLine, replaceLines, etc.) — only when editVariant is hashline */
	hashlineEditSubtypes?: Record<string, number>;
	mutationIntentMatched?: boolean;
	mutationIntentReason?: string;
	timeoutTelemetry?: PromptAttemptTelemetry;
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
	timeoutRuns: number;
	mutationIntentMatchRate?: number;
	/** Hashline edit subtype totals — only when editVariant is hashline */
	hashlineEditSubtypes?: Record<string, number>;
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

const BATCH_MIN_SIZE = 1;
const BATCH_MAX_SIZE = 1;

async function copyFixtures(task: EditTask, destDir: string): Promise<void> {
	if (task.tarballPath) {
		await extractTaskFiles(task.tarballPath, task.id, destDir, "input");
	} else if (task.inputDir) {
		const entries = await fs.readdir(task.inputDir, { withFileTypes: true });
		await Promise.all(
			entries.map((entry) => fs.cp(join(task.inputDir!, entry.name), join(destDir, entry.name), { recursive: true }))
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
		await fs.mkdir(tempDir, { recursive: true });
		await extractTaskFiles(task.tarballPath, task.id, tempDir, "expected");
		return {
			dir: tempDir,
			cleanup: async () => {
				await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
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
	cliPath: string
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
	let timeoutTelemetry: PromptAttemptTelemetry | undefined;
	let mutationIntentValidation: MutationIntentValidation | null = null;
	let toolStats = {
		read: 0,
		edit: 0,
		write: 0,
		editSuccesses: 0,
		editFailures: 0,
		totalInputChars: 0,
	};
	const hashlineSubtypes: Record<string, number> = Object.fromEntries(HASHLINE_SUBTYPES.map((k) => [k, 0]));

	const logFile = join(TMP, `run-${task.id}-${runIndex}.jsonl`);
	const logEvent = async (event: unknown) => {
		await fs.appendFile(logFile, JSON.stringify(event) + "\n");
	};
	const originalFiles = await collectOriginalFileContents(cwd, task.files);

	try {
		await fs.appendFile(logFile, `{"type":"meta","task":"${task.id}","run":${runIndex},"workDir":"${cwd}"}\n`);

		const env: Record<string, string> = { PI_NO_TITLE: "1" };
		if (config.editVariant !== undefined) {
			env.PI_EDIT_VARIANT = config.editVariant;
		}
		if (config.editFuzzy !== undefined) {
			env.PI_EDIT_FUZZY = config.editFuzzy === "auto" ? "auto" : config.editFuzzy ? "1" : "0";
		}
		if (config.editFuzzyThreshold !== undefined) {
			env.PI_EDIT_FUZZY_THRESHOLD = config.editFuzzyThreshold === "auto" ? "auto" : String(config.editFuzzyThreshold);
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

		const maxAttempts = Math.max(1, Math.floor(config.maxAttempts ?? 1));
		const timeoutRetryLimit = Math.max(0, Math.floor(config.timeoutRetryCount ?? 1));
		let timeoutRetriesUsed = 0;
		let retryContext: string | null = null;
		let allEvents: Array<{ type: string; [key: string]: unknown }> = [];

		for (let attempt = 0; attempt < maxAttempts; attempt++) {
			const guidedContext = await buildGuidedContext(task, cwd, expectedDir, config);
			const promptWithContext = buildBenchmarkPrompt({
				multiFile: false,
				taskPrompt: task.prompt,
				guidedContext,
				retryContext,
				config,
			});

			await fs.appendFile(
				logFile,
				`{"type":"prompt","attempt":${attempt + 1},"message":${JSON.stringify(promptWithContext)}}\n`
			);

			const statsBefore = await client.getSessionStats();
			let events: Array<{ type: string; [key: string]: unknown }>;
			try {
				events = await collectPromptEvents(client, promptWithContext, config, logEvent);
			} catch (err) {
				if (err instanceof PromptTimeoutError) {
					timeoutTelemetry = err.telemetry;
					await logEvent({ type: "timeout", attempt: attempt + 1, telemetry: err.telemetry });
					if (timeoutRetriesUsed < timeoutRetryLimit) {
						timeoutRetriesUsed += 1;
						retryContext = buildTimeoutRetryContext(err.telemetry, timeoutRetriesUsed, timeoutRetryLimit);
						continue;
					}
				}
				throw err;
			}
			const statsAfter = await client.getSessionStats();
			const attemptTokens = diffTokenStats(statsBefore, statsAfter);
			tokens = {
				input: tokens.input + attemptTokens.input,
				output: tokens.output + attemptTokens.output,
				total: tokens.total + attemptTokens.total,
			};
			await logEvent({ type: "stats", before: statsBefore, after: statsAfter, attempt: attempt + 1 });
			allEvents = allEvents.concat(events);

			agentResponse = (await client.getLastAssistantText()) ?? undefined;
			await logEvent({ type: "response", text: agentResponse, attempt: attempt + 1 });

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
						if (config.editVariant === "hashline" && args) {
							const counts = countHashlineEditSubtypes(args);
							for (const key of HASHLINE_SUBTYPES) {
								hashlineSubtypes[key] += counts[key];
							}
						}
						if (e.isError) {
							toolStats.editFailures++;
							const error = await appendNoChangeMutationHint(
								extractToolErrorMessage(e.result),
								args,
								cwd,
								originalFiles
							);
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
			mutationIntentValidation = await evaluateMutationIntent(task, cwd, expectedDir);
			if (!verification.success && verification.error) {
				error = verification.error;
			}

			if (verification.success) {
				break;
			}

			const mutationIntentSuffix = mutationIntentValidation
				? `\n\nMutation intent: ${mutationIntentValidation.matched ? "matched" : "not matched"} (${mutationIntentValidation.reason})`
				: "";
			retryContext = error
				? `Verification failed: ${error}${diff ? `\n\nDiff (expected vs actual):\n\n\`\`\`diff\n${diff}\n\`\`\`` : ""}${mutationIntentSuffix}`
				: `Previous attempt failed.${mutationIntentSuffix}`;
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
	const mustUseReadTool = Boolean(config.requireReadToolCall) && !config.noEditRequired;
	const editSucceeded = toolStats.editSuccesses > 0;
	const success = verificationPassed && (!mustUseEditTool || editSucceeded) && (!mustUseReadTool || toolStats.read > 0);
	const metadata = task.metadata;

	await logEvent({
		type: "result",
		success,
		patchApplied,
		verificationPassed,
		error,
		duration,
		timeoutTelemetry,
		mutationIntentValidation,
	});
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
		hashlineEditSubtypes: config.editVariant === "hashline" ? hashlineSubtypes : undefined,
		mutationIntentMatched: mutationIntentValidation?.matched,
		mutationIntentReason: mutationIntentValidation?.reason,
		timeoutTelemetry,
	};
}

async function runBatchedTask(
	item: TaskRunItem,
	config: BenchmarkConfig,
	cwd: string,
	expectedDir: string,
	client: RpcClient
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
	let timeoutTelemetry: PromptAttemptTelemetry | undefined;
	let mutationIntentValidation: MutationIntentValidation | null = null;
	let toolStats = {
		read: 0,
		edit: 0,
		write: 0,
		editSuccesses: 0,
		editFailures: 0,
		totalInputChars: 0,
	};
	const hashlineSubtypes: Record<string, number> = Object.fromEntries(HASHLINE_SUBTYPES.map((k) => [k, 0]));

	const logFile = join(TMP, `run-${task.id}-${runIndex}.jsonl`);
	const logEvent = async (event: unknown) => {
		await fs.appendFile(logFile, JSON.stringify(event) + "\n");
	};
	const originalFiles = await collectOriginalFileContents(cwd, task.files);

	try {
		await fs.appendFile(
			logFile,
			`{"type":"meta","task":"${task.id}","run":${runIndex},"workDir":"${cwd}","batched":true}\n`
		);

		const maxAttempts = Math.max(1, Math.floor(config.maxAttempts ?? 1));
		const timeoutRetryLimit = Math.max(0, Math.floor(config.timeoutRetryCount ?? 1));
		let timeoutRetriesUsed = 0;
		let retryContext: string | null = null;

		for (let attempt = 0; attempt < maxAttempts; attempt++) {
			const guidedContext = await buildGuidedContext(task, cwd, expectedDir, config);
			const promptWithContext = buildBenchmarkPrompt({
				multiFile: true,
				taskPrompt: task.prompt,
				guidedContext,
				retryContext,
				config,
			});
			await fs.appendFile(
				logFile,
				`{"type":"prompt","attempt":${attempt + 1},"message":${JSON.stringify(promptWithContext)}}\n`
			);

			const statsBefore = await client.getSessionStats();
			let events: Array<{ type: string; [key: string]: unknown }>;
			try {
				events = await collectPromptEvents(client, promptWithContext, config, logEvent);
			} catch (err) {
				if (err instanceof PromptTimeoutError) {
					timeoutTelemetry = err.telemetry;
					await logEvent({ type: "timeout", attempt: attempt + 1, telemetry: err.telemetry });
					if (timeoutRetriesUsed < timeoutRetryLimit) {
						timeoutRetriesUsed += 1;
						retryContext = buildTimeoutRetryContext(err.telemetry, timeoutRetriesUsed, timeoutRetryLimit);
						continue;
					}
				}
				throw err;
			}
			const statsAfter = await client.getSessionStats();
			const attemptTokens = diffTokenStats(statsBefore, statsAfter);
			tokens = {
				input: tokens.input + attemptTokens.input,
				output: tokens.output + attemptTokens.output,
				total: tokens.total + attemptTokens.total,
			};
			await logEvent({ type: "stats", before: statsBefore, after: statsAfter, attempt: attempt + 1 });

			agentResponse = (await client.getLastAssistantText()) ?? undefined;
			await logEvent({ type: "response", text: agentResponse, attempt: attempt + 1 });

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
						if (config.editVariant === "hashline" && args) {
							const counts = countHashlineEditSubtypes(args);
							for (const key of HASHLINE_SUBTYPES) {
								hashlineSubtypes[key] += counts[key];
							}
						}
						if (e.isError) {
							toolStats.editFailures++;
							const toolError = await appendNoChangeMutationHint(
								extractToolErrorMessage(e.result),
								args,
								cwd,
								originalFiles
							);
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
			mutationIntentValidation = await evaluateMutationIntent(task, cwd, expectedDir);
			if (!verification.success && verification.error) {
				error = verification.error;
			}

			if (verification.success) {
				break;
			}

			const mutationIntentSuffix = mutationIntentValidation
				? `\n\nMutation intent: ${mutationIntentValidation.matched ? "matched" : "not matched"} (${mutationIntentValidation.reason})`
				: "";
			retryContext = error
				? `Verification failed: ${error}${diff ? `\n\nDiff (expected vs actual):\n\n\`\`\`diff\n${diff}\n\`\`\`` : ""}${mutationIntentSuffix}`
				: `Previous attempt failed.${mutationIntentSuffix}`;
		}
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
		await logEvent({ type: "error", error });
	}

	const duration = Date.now() - startTime;
	const mustUseEditTool = Boolean(config.requireEditToolCall) && !config.noEditRequired;
	const mustUseReadTool = Boolean(config.requireReadToolCall) && !config.noEditRequired;
	const editSucceeded = toolStats.editSuccesses > 0;
	const success = verificationPassed && (!mustUseEditTool || editSucceeded) && (!mustUseReadTool || toolStats.read > 0);
	const metadata = task.metadata;

	await logEvent({
		type: "result",
		success,
		patchApplied,
		verificationPassed,
		error,
		duration,
		timeoutTelemetry,
		mutationIntentValidation,
	});
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
		hashlineEditSubtypes: config.editVariant === "hashline" ? hashlineSubtypes : undefined,
		mutationIntentMatched: mutationIntentValidation?.matched,
		mutationIntentReason: mutationIntentValidation?.reason,
		timeoutTelemetry,
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

async function collectPromptEvents(
	client: RpcClient,
	prompt: string,
	config: BenchmarkConfig,
	logEvent: (event: unknown) => Promise<void>
): Promise<Array<{ type: string; [key: string]: unknown }>> {
	const events: Array<{ type: string; [key: string]: unknown }> = [];
	let unsubscribe: (() => void) | undefined;
	const startedAt = Date.now();
	let pendingRetry = false;
	let toolExecutionStarts = 0;
	let toolExecutionEnds = 0;
	let messageEnds = 0;
	let lastEventType: string | undefined;
	const recentEventTypes: string[] = [];
	let timer: NodeJS.Timeout | undefined;
	let settled = false;

	const eventsPromise = new Promise<void>((resolve, reject) => {
		const resolveWait = () => {
			if (settled) {
				return;
			}
			settled = true;
			if (timer) {
				clearTimeout(timer);
			}
			unsubscribe?.();
			resolve();
		};

		const rejectWait = (err: Error) => {
			if (settled) {
				return;
			}
			settled = true;
			if (timer) {
				clearTimeout(timer);
			}
			unsubscribe?.();
			reject(err);
		};

		timer = setTimeout(() => {
			rejectWait(
				new PromptTimeoutError({
					elapsedMs: Date.now() - startedAt,
					eventCount: events.length,
					toolExecutionStarts,
					toolExecutionEnds,
					messageEnds,
					lastEventType,
					recentEventTypes: [...recentEventTypes],
					pendingRetry,
				})
			);
		}, config.timeout);

		unsubscribe = client.onEvent(async (event) => {
			if (!event) {
				return;
			}
			const typedEvent = event as { type: string; [key: string]: unknown };
			events.push(typedEvent);
			lastEventType = typedEvent.type;
			recentEventTypes.push(typedEvent.type);
			if (recentEventTypes.length > 8) {
				recentEventTypes.shift();
			}
			if (typedEvent.type === "tool_execution_start") {
				toolExecutionStarts += 1;
			}
			if (typedEvent.type === "tool_execution_end") {
				toolExecutionEnds += 1;
			}
			if (typedEvent.type === "message_end") {
				messageEnds += 1;
			}

			if (
				typedEvent.type === "tool_execution_start" ||
				typedEvent.type === "tool_execution_end" ||
				typedEvent.type === "message_end"
			) {
				await logEvent(typedEvent);
			}
			if (typedEvent.type === "auto_retry_start") {
				pendingRetry = true;
			} else if (typedEvent.type === "turn_start" && pendingRetry) {
				pendingRetry = false;
			}
			if (typedEvent.type === "agent_end") {
				if (pendingRetry) {
					return;
				}
				resolveWait();
			}
		});
	});

	try {
		await client.prompt(prompt);
	} catch (err) {
		if (timer) {
			clearTimeout(timer);
		}
		unsubscribe?.();
		throw err;
	}
	await eventsPromise;
	return events;
}

function diffTokenStats(
	before: { tokens: { input: number; output: number; total: number } },
	after: { tokens: { input: number; output: number; total: number } }
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
	onProgress?: (event: ProgressEvent) => void
): Promise<Array<{ task: EditTask; result: TaskRunResult }>> {
	const workDir = join(TMP, `batch-${crypto.randomUUID()}`);
	await fs.mkdir(workDir, { recursive: true });
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
			})
		);

		await Promise.all(orderedItems.map((item) => copyFixtures(item.task, workDir)));

		const env: Record<string, string> = { PI_NO_TITLE: "1" };
		if (config.editVariant !== undefined) {
			env.PI_EDIT_VARIANT = config.editVariant;
		}
		if (config.editFuzzy !== undefined) {
			env.PI_EDIT_FUZZY = config.editFuzzy === "auto" ? "auto" : config.editFuzzy ? "1" : "0";
		}
		if (config.editFuzzyThreshold !== undefined) {
			env.PI_EDIT_FUZZY_THRESHOLD = config.editFuzzyThreshold === "auto" ? "auto" : String(config.editFuzzyThreshold);
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
			await fs.rm(workDir, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors
		}
	}

	return results;
}

export async function runTask(
	task: EditTask,
	config: BenchmarkConfig,
	onProgress?: (event: ProgressEvent) => void
): Promise<TaskResult> {
	const tempDirs: TempDir[] = [];
	const { dir: expectedDir, cleanup: cleanupExpected } = await getExpectedDir(task);

	const cliPath = join(import.meta.dir, "../coding-agent/src/cli.ts");

	try {
		for (let i = 0; i < config.runsPerTask; i++) {
			const tempDir = await TempDir.create(join(TMP, `${task.id}-`));
			tempDirs.push(tempDir);
			await copyFixtures(task, tempDir.path());
		}

		const runPromises = tempDirs.map(async (tempDirObj, index) => {
			onProgress?.({ taskId: task.id, runIndex: index, status: "started" });
			const result = await runSingleTask(task, index, config, tempDirObj.path(), expectedDir, cliPath);
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
	onProgress?: (event: ProgressEvent) => void
): Promise<BenchmarkResult> {
	const startTime = new Date().toISOString();
	const runItems: TaskRunItem[] = tasks.flatMap((task) =>
		Array.from({ length: config.runsPerTask }, (_, runIndex) => ({ task, runIndex }))
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
	const timeoutRuns = allRuns.filter((r) => r.error?.includes("Timeout waiting for agent_end")).length;
	const runsWithMutationIntent = allRuns.filter((r) => typeof r.mutationIntentMatched === "boolean");
	const mutationIntentMatchRate =
		runsWithMutationIntent.length > 0
			? runsWithMutationIntent.filter((r) => r.mutationIntentMatched).length / runsWithMutationIntent.length
			: undefined;

	const hashlineEditSubtypes: Record<string, number> | undefined =
		config.editVariant === "hashline"
			? Object.fromEntries(
					HASHLINE_SUBTYPES.map((key) => [
						key,
						allRuns.reduce((sum, r) => sum + (r.hashlineEditSubtypes?.[key] ?? 0), 0),
					])
				)
			: undefined;

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
		timeoutRuns,
		mutationIntentMatchRate,
		hashlineEditSubtypes,
	};

	return {
		config,
		tasks: taskResults,
		summary,
		startTime,
		endTime,
	};
}
