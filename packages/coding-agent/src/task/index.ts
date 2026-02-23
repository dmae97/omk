/**
 * Task tool - Delegate tasks to specialized agents.
 *
 * Discovers agent definitions from:
 *   - Bundled agents (shipped with omp-coding-agent)
 *   - ~/.omp/agent/agents/*.md (user-level)
 *   - .omp/agents/*.md (project-level)
 *
 * Supports:
 *   - Single agent execution
 *   - Parallel execution with concurrency limits
 *   - Progress tracking via JSON events
 *   - Session artifacts for debugging
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";
import type { AgentTool, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import type { Usage } from "@oh-my-pi/pi-ai";
import { $env, Snowflake } from "@oh-my-pi/pi-utils";
import { $ } from "bun";
import type { ToolSession } from "..";
import { isDefaultModelAlias } from "../config/model-resolver";
import { renderPromptTemplate } from "../config/prompt-templates";
import type { Theme } from "../modes/theme/theme";
import planModeSubagentPrompt from "../prompts/system/plan-mode-subagent.md" with { type: "text" };
import taskDescriptionTemplate from "../prompts/tools/task.md" with { type: "text" };
import taskSummaryTemplate from "../prompts/tools/task-summary.md" with { type: "text" };
import { formatBytes, formatDuration } from "../tools/render-utils";
// Import review tools for side effects (registers subagent tool handlers)
import "../tools/review";
import { discoverAgents, getAgent } from "./discovery";
import { runSubprocess } from "./executor";
import { AgentOutputManager } from "./output-manager";
import { mapWithConcurrencyLimit, Semaphore } from "./parallel";
import { renderCall, renderResult } from "./render";
import { renderTemplate } from "./template";
import {
	type AgentDefinition,
	type AgentProgress,
	type SingleResult,
	type TaskParams,
	type TaskSchema,
	type TaskToolDetails,
	taskSchema,
	taskSchemaNoIsolation,
} from "./types";
import {
	applyBaseline,
	captureBaseline,
	captureDeltaPatch,
	cleanupFuseOverlay,
	cleanupWorktree,
	ensureFuseOverlay,
	ensureWorktree,
	getRepoRoot,
	type WorktreeBaseline,
} from "./worktree";

function createUsageTotals(): Usage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function addUsageTotals(target: Usage, usage: Partial<Usage>): void {
	const input = usage.input ?? 0;
	const output = usage.output ?? 0;
	const cacheRead = usage.cacheRead ?? 0;
	const cacheWrite = usage.cacheWrite ?? 0;
	const totalTokens = usage.totalTokens ?? input + output + cacheRead + cacheWrite;
	const cost =
		usage.cost ??
		({
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0,
		} satisfies Usage["cost"]);

	target.input += input;
	target.output += output;
	target.cacheRead += cacheRead;
	target.cacheWrite += cacheWrite;
	target.totalTokens += totalTokens;
	target.cost.input += cost.input;
	target.cost.output += cost.output;
	target.cost.cacheRead += cost.cacheRead;
	target.cost.cacheWrite += cost.cacheWrite;
	target.cost.total += cost.total;
}

// Re-export types and utilities
export { loadBundledAgents as BUNDLED_AGENTS } from "./agents";
export { discoverCommands, expandCommand, getCommand } from "./commands";
export { discoverAgents, getAgent } from "./discovery";
export { AgentOutputManager } from "./output-manager";
export type { AgentDefinition, AgentProgress, SingleResult, TaskParams, TaskToolDetails } from "./types";
export { taskSchema } from "./types";

/**
 * Render the tool description from a cached agent list and current settings.
 */
function renderDescription(
	agents: AgentDefinition[],
	maxConcurrency: number,
	isolationEnabled: boolean,
	asyncEnabled: boolean,
	disabledAgents: string[],
): string {
	const filteredAgents = disabledAgents.length > 0 ? agents.filter(a => !disabledAgents.includes(a.name)) : agents;
	return renderPromptTemplate(taskDescriptionTemplate, {
		agents: filteredAgents,
		MAX_CONCURRENCY: maxConcurrency,
		isolationEnabled,
		asyncEnabled,
	});
}

// ═══════════════════════════════════════════════════════════════════════════
// Tool Class
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Task tool - Delegate tasks to specialized agents.
 *
 * Requires async initialization to discover available agents.
 * Use `TaskTool.create(session)` to instantiate.
 */
export class TaskTool implements AgentTool<TaskSchema, TaskToolDetails, Theme> {
	readonly name = "task";
	readonly label = "Task";
	readonly strict = true;
	readonly parameters: TaskSchema;
	readonly renderCall = renderCall;
	readonly renderResult = renderResult;
	readonly #discoveredAgents: AgentDefinition[];
	readonly #blockedAgent: string | undefined;

	/** Dynamic description that reflects current disabled-agent settings */
	get description(): string {
		const disabledAgents = this.session.settings.get("task.disabledAgents") as string[];
		const maxConcurrency = this.session.settings.get("task.maxConcurrency");
		const isolationMode = this.session.settings.get("task.isolation.mode");
		return renderDescription(
			this.#discoveredAgents,
			maxConcurrency,
			isolationMode !== "none",
			this.session.settings.get("async.enabled"),
			disabledAgents,
		);
	}
	private constructor(
		private readonly session: ToolSession,
		discoveredAgents: AgentDefinition[],
		isolationEnabled: boolean,
	) {
		this.parameters = isolationEnabled ? taskSchema : taskSchemaNoIsolation;
		this.#blockedAgent = $env.PI_BLOCKED_AGENT;
		this.#discoveredAgents = discoveredAgents;
	}

	/**
	 * Create a TaskTool instance with async agent discovery.
	 */
	static async create(session: ToolSession): Promise<TaskTool> {
		const isolationMode = session.settings.get("task.isolation.mode");
		const { agents } = await discoverAgents(session.cwd);
		return new TaskTool(session, agents, isolationMode !== "none");
	}

	async execute(
		_toolCallId: string,
		params: TaskParams,
		signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<TaskToolDetails>,
	): Promise<AgentToolResult<TaskToolDetails>> {
		const asyncEnabled = this.session.settings.get("async.enabled");
		const selectedAgent = this.#discoveredAgents.find(agent => agent.name === params.agent);
		if (!asyncEnabled || selectedAgent?.blocking === true) {
			return this.#executeSync(_toolCallId, params, signal, onUpdate);
		}

		const manager = this.session.asyncJobManager;
		if (!manager) {
			return {
				content: [{ type: "text", text: "Async execution is enabled but no async job manager is available." }],
				details: { projectAgentsDir: null, results: [], totalDurationMs: 0 },
			};
		}

		const taskItems = params.tasks ?? [];
		if (taskItems.length === 0) {
			return this.#executeSync(_toolCallId, params, signal, onUpdate);
		}

		const outputManager =
			this.session.agentOutputManager ?? new AgentOutputManager(this.session.getArtifactsDir ?? (() => null));
		const uniqueIds = await outputManager.allocateBatch(taskItems.map(t => t.id));
		const fallbackAgentSource =
			this.#discoveredAgents.find(agent => agent.name === params.agent)?.source ?? "bundled";
		const renderedTasks = taskItems.map(taskItem => renderTemplate(params.context, taskItem));
		const progressByTaskId = new Map<string, AgentProgress>();
		for (let index = 0; index < renderedTasks.length; index++) {
			const renderedTask = renderedTasks[index];
			progressByTaskId.set(renderedTask.id, {
				index,
				id: renderedTask.id,
				agent: params.agent,
				agentSource: fallbackAgentSource,
				status: "pending",
				task: renderedTask.task,
				description: renderedTask.description,
				recentTools: [],
				recentOutput: [],
				toolCount: 0,
				tokens: 0,
				durationMs: 0,
			});
		}

		const startedJobs: Array<{ jobId: string; taskId: string }> = [];
		const failedSchedules: string[] = [];
		let completedJobs = 0;
		let failedJobs = 0;

		const getProgressSnapshot = (): AgentProgress[] => {
			return Array.from(progressByTaskId.values())
				.sort((a, b) => a.index - b.index)
				.map(progress => structuredClone(progress));
		};

		const buildAsyncDetails = (state: "running" | "completed" | "failed", jobId: string): TaskToolDetails => ({
			projectAgentsDir: null,
			results: [],
			totalDurationMs: 0,
			progress: getProgressSnapshot(),
			async: { state, jobId, type: "task" },
		});

		const emitAsyncUpdate = (state: "running" | "completed" | "failed", text: string): void => {
			const primaryJobId = startedJobs[0]?.jobId ?? "task";
			onUpdate?.({
				content: [{ type: "text", text }],
				details: buildAsyncDetails(state, primaryJobId),
			});
		};

		const maxConcurrency = this.session.settings.get("task.maxConcurrency");
		const semaphore = new Semaphore(maxConcurrency);

		for (let i = 0; i < taskItems.length; i++) {
			const taskItem = taskItems[i];
			if (signal?.aborted) {
				failedSchedules.push(`${taskItem.id}: cancelled before scheduling`);
				const progress = progressByTaskId.get(taskItem.id);
				if (progress) {
					progress.status = "aborted";
				}
				continue;
			}

			const uniqueId = uniqueIds[i];
			const singleParams: TaskParams = { ...params, tasks: [taskItem] };
			const label = uniqueId;
			try {
				const jobId = manager.register(
					"task",
					label,
					async ({ signal: runSignal, reportProgress }) => {
						const startedAt = Date.now();
						const progress = progressByTaskId.get(taskItem.id);
						await semaphore.acquire();
						if (runSignal.aborted) {
							semaphore.release();
							if (progress) {
								progress.status = "aborted";
							}
							throw new Error("Aborted before execution");
						}
						if (progress) {
							progress.status = "running";
						}
						await reportProgress(
							`Running background task ${taskItem.id}...`,
							buildAsyncDetails("running", startedJobs[0]?.jobId ?? label) as unknown as Record<string, unknown>,
						);
						try {
							const result = await this.#executeSync(_toolCallId, singleParams, runSignal, undefined, [
								uniqueId,
							]);
							const finalText = result.content.find(part => part.type === "text")?.text ?? "(no output)";
							const singleResult = result.details?.results[0];
							if (progress) {
								progress.status = singleResult?.aborted
									? "aborted"
									: (singleResult?.exitCode ?? 0) === 0
										? "completed"
										: "failed";
								progress.durationMs = singleResult?.durationMs ?? Math.max(0, Date.now() - startedAt);
								progress.tokens = singleResult?.tokens ?? 0;
								progress.extractedToolData = singleResult?.extractedToolData;
							}
							completedJobs += 1;
							if (singleResult && ((singleResult.aborted ?? false) || singleResult.exitCode !== 0)) {
								failedJobs += 1;
							}
							const remaining = taskItems.length - completedJobs;
							const isDone = remaining === 0;
							await reportProgress(
								isDone
									? `Background task batch complete: ${completedJobs}/${taskItems.length} finished.`
									: `Background task batch progress: ${completedJobs}/${taskItems.length} finished (${remaining} running).`,
								buildAsyncDetails(
									isDone ? (failedJobs > 0 || failedSchedules.length > 0 ? "failed" : "completed") : "running",
									startedJobs[0]?.jobId ?? label,
								) as unknown as Record<string, unknown>,
							);
							if (isDone) {
								emitAsyncUpdate(
									failedJobs > 0 || failedSchedules.length > 0 ? "failed" : "completed",
									`Background task batch complete: ${completedJobs}/${taskItems.length} finished.`,
								);
							}
							return finalText;
						} catch (error) {
							if (progress) {
								progress.status = "failed";
								progress.durationMs = Math.max(0, Date.now() - startedAt);
							}
							completedJobs += 1;
							failedJobs += 1;
							const remaining = taskItems.length - completedJobs;
							const isDone = remaining === 0;
							await reportProgress(
								isDone
									? `Background task batch complete with failures: ${failedJobs} failed.`
									: `Background task batch progress: ${completedJobs}/${taskItems.length} finished (${remaining} running).`,
								buildAsyncDetails(
									isDone ? "failed" : "running",
									startedJobs[0]?.jobId ?? label,
								) as unknown as Record<string, unknown>,
							);
							if (isDone) {
								emitAsyncUpdate(
									"failed",
									`Background task batch complete with failures: ${failedJobs} failed.`,
								);
							}
							throw error;
						} finally {
							semaphore.release();
						}
					},
					{
						id: label,
						onProgress: (text, details) => {
							const progressDetails =
								(details as TaskToolDetails | undefined) ??
								buildAsyncDetails("running", startedJobs[0]?.jobId ?? label);
							onUpdate?.({ content: [{ type: "text", text }], details: progressDetails });
						},
					},
				);
				startedJobs.push({ jobId, taskId: taskItem.id });
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				failedSchedules.push(`${taskItem.id}: ${message}`);
				const progress = progressByTaskId.get(taskItem.id);
				if (progress) {
					progress.status = "failed";
				}
			}
		}

		if (startedJobs.length === 0) {
			const failureText = `Failed to start background task jobs: ${failedSchedules.join("; ")}`;
			return {
				content: [{ type: "text", text: failureText }],
				details: { projectAgentsDir: null, results: [], totalDurationMs: 0 },
			};
		}

		emitAsyncUpdate(
			"running",
			`Launching ${startedJobs.length} background ${startedJobs.length === 1 ? "task" : "tasks"}...`,
		);

		const scheduleFailureSummary =
			failedSchedules.length > 0
				? ` Failed to schedule ${failedSchedules.length} task${failedSchedules.length === 1 ? "" : "s"}.`
				: "";

		return {
			content: [
				{
					type: "text",
					text: `Started ${startedJobs.length} background task job${startedJobs.length === 1 ? "" : "s"} using ${params.agent}.${scheduleFailureSummary} Results will be delivered when complete.`,
				},
			],
			details: {
				projectAgentsDir: null,
				results: [],
				totalDurationMs: 0,
				progress: getProgressSnapshot(),
				async: { state: "running", jobId: startedJobs[0].jobId, type: "task" },
			},
		};
	}

	async #executeSync(
		_toolCallId: string,
		params: TaskParams,
		signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<TaskToolDetails>,
		preAllocatedIds?: string[],
	): Promise<AgentToolResult<TaskToolDetails>> {
		const startTime = Date.now();
		const { agents, projectAgentsDir } = await discoverAgents(this.session.cwd);
		const { agent: agentName, context, schema: outputSchema } = params;
		const isolationMode = this.session.settings.get("task.isolation.mode");
		const isolationRequested = "isolated" in params ? params.isolated === true : false;
		const isIsolated = isolationMode !== "none" && isolationRequested;
		const maxConcurrency = this.session.settings.get("task.maxConcurrency");
		const taskDepth = this.session.taskDepth ?? 0;

		if (isolationMode === "none" && "isolated" in params) {
			return {
				content: [
					{
						type: "text",
						text: "Task isolation is disabled. Remove the isolated argument or set task.isolation.mode to 'worktree' or 'fuse-overlay'.",
					},
				],
				details: {
					projectAgentsDir,
					results: [],
					totalDurationMs: 0,
				},
			};
		}

		// Validate agent exists
		const agent = getAgent(agents, agentName);
		if (!agent) {
			const available = agents.map(a => a.name).join(", ") || "none";
			return {
				content: [
					{
						type: "text",
						text: `Unknown agent "${agentName}". Available: ${available}`,
					},
				],
				details: {
					projectAgentsDir,
					results: [],
					totalDurationMs: 0,
				},
			};
		}

		// Check if agent is disabled in settings
		const disabledAgents = this.session.settings.get("task.disabledAgents") as string[];
		if (disabledAgents.length > 0 && disabledAgents.includes(agentName)) {
			const enabled = agents.filter(a => !disabledAgents.includes(a.name)).map(a => a.name);
			return {
				content: [
					{
						type: "text",
						text: `Agent "${agentName}" is disabled in settings. Enable it via /agents, or use a different agent type.${enabled.length > 0 ? ` Available: ${enabled.join(", ")}` : ""}`,
					},
				],
				details: {
					projectAgentsDir,
					results: [],
					totalDurationMs: 0,
				},
			};
		}

		const planModeState = this.session.getPlanModeState?.();
		const planModeTools = ["read", "grep", "find", "ls", "lsp", "fetch", "web_search"];
		const effectiveAgent: typeof agent = planModeState?.enabled
			? {
					...agent,
					systemPrompt: `${planModeSubagentPrompt}\n\n${agent.systemPrompt}`,
					tools: planModeTools,
					spawns: undefined,
				}
			: agent;

		// Apply per-agent model override from settings (highest priority)
		const agentModelOverrides = this.session.settings.get("task.agentModelOverrides") as Record<string, string>;
		const settingsModelOverride = agentModelOverrides[agentName];
		const effectiveAgentModel = isDefaultModelAlias(effectiveAgent.model) ? undefined : effectiveAgent.model;
		const modelOverride =
			settingsModelOverride ??
			effectiveAgentModel ??
			this.session.getActiveModelString?.() ??
			this.session.getModelString?.();
		const thinkingLevelOverride = effectiveAgent.thinkingLevel;

		// Output schema priority: agent frontmatter > params > inherited from parent session
		const effectiveOutputSchema = effectiveAgent.output ?? outputSchema ?? this.session.outputSchema;

		// Handle empty or missing tasks
		if (!params.tasks || params.tasks.length === 0) {
			return {
				content: [
					{
						type: "text",
						text: `No tasks provided. Use: { agent, context, tasks: [{id, description, args}, ...] }`,
					},
				],
				details: {
					projectAgentsDir,
					results: [],
					totalDurationMs: 0,
				},
			};
		}

		const tasks = params.tasks;
		const missingTaskIndexes: number[] = [];
		const idIndexes = new Map<string, number[]>();

		for (let i = 0; i < tasks.length; i++) {
			const id = tasks[i]?.id;
			if (typeof id !== "string" || id.trim() === "") {
				missingTaskIndexes.push(i);
				continue;
			}
			const normalizedId = id.toLowerCase();
			const indexes = idIndexes.get(normalizedId);
			if (indexes) {
				indexes.push(i);
			} else {
				idIndexes.set(normalizedId, [i]);
			}
		}

		const duplicateIds: Array<{ id: string; indexes: number[] }> = [];
		for (const [normalizedId, indexes] of idIndexes.entries()) {
			if (indexes.length > 1) {
				duplicateIds.push({
					id: tasks[indexes[0]]?.id ?? normalizedId,
					indexes,
				});
			}
		}

		if (missingTaskIndexes.length > 0 || duplicateIds.length > 0) {
			const problems: string[] = [];
			if (missingTaskIndexes.length > 0) {
				problems.push(`Missing task ids at indexes: ${missingTaskIndexes.join(", ")}`);
			}
			if (duplicateIds.length > 0) {
				const details = duplicateIds.map(entry => `${entry.id} (indexes ${entry.indexes.join(", ")})`).join("; ");
				problems.push(`Duplicate task ids detected (case-insensitive): ${details}`);
			}
			return {
				content: [{ type: "text", text: `Invalid tasks: ${problems.join(". ")}` }],
				details: {
					projectAgentsDir,
					results: [],
					totalDurationMs: 0,
				},
			};
		}

		let repoRoot: string | null = null;
		let baseline: WorktreeBaseline | null = null;
		if (isIsolated) {
			try {
				repoRoot = await getRepoRoot(this.session.cwd);
				baseline = await captureBaseline(repoRoot);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					content: [
						{
							type: "text",
							text: `Isolated task execution requires a git repository. ${message}`,
						},
					],
					details: {
						projectAgentsDir,
						results: [],
						totalDurationMs: Date.now() - startTime,
					},
				};
			}
		}

		// Derive artifacts directory
		const sessionFile = this.session.getSessionFile();
		const artifactsDir = sessionFile ? sessionFile.slice(0, -6) : null;
		const tempArtifactsDir = artifactsDir ? null : path.join(os.tmpdir(), `omp-task-${Snowflake.next()}`);
		const effectiveArtifactsDir = artifactsDir || tempArtifactsDir!;

		// Initialize progress tracking
		const progressMap = new Map<number, AgentProgress>();

		// Update callback
		const emitProgress = () => {
			const progress = Array.from(progressMap.values()).sort((a, b) => a.index - b.index);
			onUpdate?.({
				content: [{ type: "text", text: `Running ${params.tasks.length} agents...` }],
				details: {
					projectAgentsDir,
					results: [],
					totalDurationMs: Date.now() - startTime,
					progress,
				},
			});
		};

		try {
			// Check self-recursion prevention
			if (this.#blockedAgent && agentName === this.#blockedAgent) {
				return {
					content: [
						{
							type: "text",
							text: `Cannot spawn ${this.#blockedAgent} agent from within itself (recursion prevention). Use a different agent type.`,
						},
					],
					details: {
						projectAgentsDir,
						results: [],
						totalDurationMs: Date.now() - startTime,
					},
				};
			}

			// Check spawn restrictions from parent
			const parentSpawns = this.session.getSessionSpawns() ?? "*";
			const allowedSpawns = parentSpawns.split(",").map(s => s.trim());
			const isSpawnAllowed = (): boolean => {
				if (parentSpawns === "") return false; // Empty = deny all
				if (parentSpawns === "*") return true; // Wildcard = allow all
				return allowedSpawns.includes(agentName);
			};

			if (!isSpawnAllowed()) {
				const allowed = parentSpawns === "" ? "none (spawns disabled for this agent)" : parentSpawns;
				return {
					content: [{ type: "text", text: `Cannot spawn '${agentName}'. Allowed: ${allowed}` }],
					details: {
						projectAgentsDir,
						results: [],
						totalDurationMs: Date.now() - startTime,
					},
				};
			}

			// Write parent conversation context for subagents
			await fs.mkdir(effectiveArtifactsDir, { recursive: true });
			const compactContext = this.session.getCompactContext?.();
			let contextFilePath: string | undefined;
			if (compactContext) {
				contextFilePath = path.join(effectiveArtifactsDir, "context.md");
				await Bun.write(contextFilePath, compactContext);
			}

			// Build full prompts with context prepended
			// Allocate unique IDs across the session to prevent artifact collisions
			let uniqueIds: string[];
			if (preAllocatedIds && preAllocatedIds.length === tasks.length) {
				uniqueIds = preAllocatedIds;
			} else {
				const outputManager =
					this.session.agentOutputManager ?? new AgentOutputManager(this.session.getArtifactsDir ?? (() => null));
				uniqueIds = await outputManager.allocateBatch(tasks.map(t => t.id));
			}
			const tasksWithUniqueIds = tasks.map((t, i) => ({ ...t, id: uniqueIds[i] }));

			// Build full prompts with context prepended
			const tasksWithContext = tasksWithUniqueIds.map(t => renderTemplate(context, t));
			const contextFiles = this.session.contextFiles;
			const availableSkills = this.session.skills;
			const availableSkillList = availableSkills ?? [];
			const promptTemplates = this.session.promptTemplates;
			const skillLookup = new Map(availableSkillList.map(skill => [skill.name, skill]));
			const missingSkillsByTask: Array<{ id: string; missing: string[] }> = [];
			const tasksWithSkills = tasksWithContext.map(task => {
				if (task.skills === undefined) {
					return { ...task, resolvedSkills: availableSkills, preloadedSkills: undefined };
				}
				const requested = task.skills;
				const resolved = [] as typeof availableSkillList;
				const missing: string[] = [];
				const seen = new Set<string>();
				for (const name of requested) {
					const trimmed = name.trim();
					if (!trimmed || seen.has(trimmed)) continue;
					seen.add(trimmed);
					const skill = skillLookup.get(trimmed);
					if (skill) {
						resolved.push(skill);
					} else {
						missing.push(trimmed);
					}
				}
				if (missing.length > 0) {
					missingSkillsByTask.push({ id: task.id, missing });
				}
				return { ...task, resolvedSkills: resolved, preloadedSkills: resolved };
			});

			if (missingSkillsByTask.length > 0) {
				const available = availableSkillList.map(skill => skill.name).join(", ") || "none";
				const details = missingSkillsByTask.map(entry => `${entry.id}: ${entry.missing.join(", ")}`).join("; ");
				return {
					content: [
						{
							type: "text",
							text: `Unknown skills requested: ${details}. Available skills: ${available}`,
						},
					],
					details: {
						projectAgentsDir,
						results: [],
						totalDurationMs: Date.now() - startTime,
					},
				};
			}

			// Initialize progress for all tasks
			for (let i = 0; i < tasksWithSkills.length; i++) {
				const t = tasksWithSkills[i];
				progressMap.set(i, {
					index: i,
					id: t.id,
					agent: agentName,
					agentSource: agent.source,
					status: "pending",
					task: t.task,
					recentTools: [],
					recentOutput: [],
					toolCount: 0,
					tokens: 0,
					durationMs: 0,
					modelOverride,
					description: t.description,
				});
			}
			emitProgress();

			const runTask = async (task: (typeof tasksWithSkills)[number], index: number) => {
				if (!isIsolated) {
					return runSubprocess({
						cwd: this.session.cwd,
						agent,
						task: task.task,
						description: task.description,
						index,
						id: task.id,
						taskDepth,
						modelOverride,
						thinkingLevel: thinkingLevelOverride,
						outputSchema: effectiveOutputSchema,
						sessionFile,
						persistArtifacts: !!artifactsDir,
						artifactsDir: effectiveArtifactsDir,
						contextFile: contextFilePath,
						enableLsp: false,
						signal,
						eventBus: undefined,
						onProgress: progress => {
							progressMap.set(index, {
								...structuredClone(progress),
							});
							emitProgress();
						},
						authStorage: this.session.authStorage,
						modelRegistry: this.session.modelRegistry,
						settings: this.session.settings,
						mcpManager: this.session.mcpManager,
						contextFiles,
						skills: task.resolvedSkills,
						preloadedSkills: task.preloadedSkills,
						promptTemplates,
					});
				}

				const taskStart = Date.now();
				let isolationDir: string | undefined;
				try {
					if (!repoRoot || !baseline) {
						throw new Error("Isolated task execution not initialized.");
					}

					if (isolationMode === "fuse-overlay") {
						isolationDir = await ensureFuseOverlay(repoRoot, task.id);
						// Overlay already reflects the full working tree state — no baseline apply needed
					} else {
						isolationDir = await ensureWorktree(repoRoot, task.id);
						await applyBaseline(isolationDir, baseline);
					}

					const result = await runSubprocess({
						cwd: this.session.cwd,
						worktree: isolationDir,
						agent,
						task: task.task,
						description: task.description,
						index,
						id: task.id,
						taskDepth,
						modelOverride,
						thinkingLevel: thinkingLevelOverride,
						outputSchema: effectiveOutputSchema,
						sessionFile,
						persistArtifacts: !!artifactsDir,
						artifactsDir: effectiveArtifactsDir,
						contextFile: contextFilePath,
						enableLsp: false,
						signal,
						eventBus: undefined,
						onProgress: progress => {
							progressMap.set(index, {
								...structuredClone(progress),
							});
							emitProgress();
						},
						authStorage: this.session.authStorage,
						modelRegistry: this.session.modelRegistry,
						settings: this.session.settings,
						mcpManager: this.session.mcpManager,
						contextFiles,
						skills: task.resolvedSkills,
						preloadedSkills: task.preloadedSkills,
						promptTemplates,
					});
					const patch = await captureDeltaPatch(isolationDir, baseline);
					const patchPath = path.join(effectiveArtifactsDir, `${task.id}.patch`);
					await Bun.write(patchPath, patch);
					return {
						...result,
						patchPath,
					};
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					return {
						index,
						id: task.id,
						agent: agent.name,
						agentSource: agent.source,
						task: task.task,
						description: task.description,
						exitCode: 1,
						output: "",
						stderr: message,
						truncated: false,
						durationMs: Date.now() - taskStart,
						tokens: 0,
						modelOverride,
						error: message,
					};
				} finally {
					if (isolationDir) {
						if (isolationMode === "fuse-overlay") {
							await cleanupFuseOverlay(isolationDir);
						} else {
							await cleanupWorktree(isolationDir);
						}
					}
				}
			};

			// Execute in parallel with concurrency limit
			const { results: partialResults, aborted } = await mapWithConcurrencyLimit(
				tasksWithSkills,
				maxConcurrency,
				runTask,
				signal,
			);

			// Fill in skipped tasks (undefined entries from abort) with placeholder results
			const results: SingleResult[] = partialResults.map((result, index) => {
				if (result !== undefined) {
					return result;
				}
				const task = tasksWithSkills[index];
				return {
					index,
					id: task.id,
					agent: agentName,
					agentSource: agent.source,
					task: task.task,
					description: task.description,
					exitCode: 1,
					output: "",
					stderr: "Skipped (cancelled before start)",
					truncated: false,
					durationMs: 0,
					tokens: 0,
					modelOverride,
					error: "Skipped",
					aborted: true,
				};
			});

			// Aggregate usage from executor results (already accumulated incrementally)
			const aggregatedUsage = createUsageTotals();
			let hasAggregatedUsage = false;
			for (const result of results) {
				if (result.usage) {
					addUsageTotals(aggregatedUsage, result.usage);
					hasAggregatedUsage = true;
				}
			}

			// Collect output paths (artifacts already written by executor in real-time)
			const outputPaths: string[] = [];
			const patchPaths: string[] = [];
			for (const result of results) {
				if (result.outputPath) {
					outputPaths.push(result.outputPath);
				}
				if (result.patchPath) {
					patchPaths.push(result.patchPath);
				}
			}

			let patchApplySummary = "";
			let patchesApplied: boolean | null = null;
			if (isIsolated) {
				const patchesInOrder = results.map(result => result.patchPath).filter(Boolean) as string[];
				const missingPatch = results.some(result => !result.patchPath);
				if (!repoRoot || missingPatch) {
					patchesApplied = false;
				} else {
					const patchStats = await Promise.all(
						patchesInOrder.map(async patchPath => ({
							patchPath,
							size: (await fs.stat(patchPath)).size,
						})),
					);
					const nonEmptyPatches = patchStats.filter(patch => patch.size > 0).map(patch => patch.patchPath);
					if (nonEmptyPatches.length === 0) {
						patchesApplied = true;
					} else {
						const patchTexts = await Promise.all(
							nonEmptyPatches.map(async patchPath => Bun.file(patchPath).text()),
						);
						const combinedPatch = patchTexts.map(text => (text.endsWith("\n") ? text : `${text}\n`)).join("");
						if (!combinedPatch.trim()) {
							patchesApplied = true;
						} else {
							const combinedPatchPath = path.join(os.tmpdir(), `omp-task-combined-${Snowflake.next()}.patch`);
							try {
								await Bun.write(combinedPatchPath, combinedPatch);
								const checkResult = await $`git apply --check --binary ${combinedPatchPath}`
									.cwd(repoRoot)
									.quiet()
									.nothrow();
								if (checkResult.exitCode !== 0) {
									patchesApplied = false;
								} else {
									const applyResult = await $`git apply --binary ${combinedPatchPath}`
										.cwd(repoRoot)
										.quiet()
										.nothrow();
									patchesApplied = applyResult.exitCode === 0;
								}
							} finally {
								await fs.rm(combinedPatchPath, { force: true });
							}
						}
					}
				}

				if (patchesApplied) {
					patchApplySummary = "\n\nApplied patches: yes";
				} else {
					const notification =
						"<system-notification>Patches were not applied and must be handled manually.</system-notification>";
					const patchList =
						patchPaths.length > 0
							? `\n\nPatch artifacts:\n${patchPaths.map(patch => `- ${patch}`).join("\n")}`
							: "";
					patchApplySummary = `\n\n${notification}${patchList}`;
				}
			}

			// Build final output - match plugin format
			const successCount = results.filter(r => r.exitCode === 0).length;
			const cancelledCount = results.filter(r => r.aborted).length;
			const totalDuration = Date.now() - startTime;

			const summaries = results.map(r => {
				const status = r.aborted ? "cancelled" : r.exitCode === 0 ? "completed" : `failed (exit ${r.exitCode})`;
				const output = r.output.trim() || r.stderr.trim() || "(no output)";
				const outputCharCount = r.outputMeta?.charCount ?? output.length;
				const fullOutputThreshold = 5000;
				let preview = output;
				let truncated = false;
				if (outputCharCount > fullOutputThreshold) {
					const slice = output.slice(0, fullOutputThreshold);
					const lastNewline = slice.lastIndexOf("\n");
					preview = lastNewline >= 0 ? slice.slice(0, lastNewline) : slice;
					truncated = true;
				}
				return {
					agent: r.agent,
					status,
					id: r.id,
					preview,
					truncated,
					meta: r.outputMeta
						? {
								lineCount: r.outputMeta.lineCount,
								charSize: formatBytes(r.outputMeta.charCount),
							}
						: undefined,
				};
			});

			const outputIds = results.filter(r => !r.aborted || r.output.trim()).map(r => `agent://${r.id}`);
			const summary = renderPromptTemplate(taskSummaryTemplate, {
				successCount,
				totalCount: results.length,
				cancelledCount,
				hasCancelledNote: aborted && cancelledCount > 0,
				duration: formatDuration(totalDuration),
				summaries,
				outputIds,
				agentName,
				patchApplySummary,
			});

			// Cleanup temp directory if used
			const shouldCleanupTempArtifacts =
				tempArtifactsDir && (!isIsolated || patchesApplied === true || patchesApplied === null);
			if (shouldCleanupTempArtifacts) {
				await fs.rm(tempArtifactsDir, { recursive: true, force: true });
			}

			return {
				content: [{ type: "text", text: summary }],
				details: {
					projectAgentsDir,
					results: results,
					totalDurationMs: totalDuration,
					usage: hasAggregatedUsage ? aggregatedUsage : undefined,
					outputPaths,
				},
			};
		} catch (err) {
			return {
				content: [{ type: "text", text: `Task execution failed: ${err}` }],
				details: {
					projectAgentsDir,
					results: [],
					totalDurationMs: Date.now() - startTime,
				},
			};
		}
	}
}
