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
import { $ } from "bun";
import { nanoid } from "nanoid";
import type { ToolSession } from "..";
import { isDefaultModelAlias } from "../config/model-resolver";
import { renderPromptTemplate } from "../config/prompt-templates";
import type { Theme } from "../modes/theme/theme";
import planModeSubagentPrompt from "../prompts/system/plan-mode-subagent.md" with { type: "text" };
import taskDescriptionTemplate from "../prompts/tools/task.md" with { type: "text" };
import taskSummaryTemplate from "../prompts/tools/task-summary.md" with { type: "text" };
import { formatDuration } from "../tools/render-utils";
// Import review tools for side effects (registers subagent tool handlers)
import "../tools/review";
import { discoverAgents, getAgent } from "./discovery";
import { runSubprocess } from "./executor";
import { AgentOutputManager } from "./output-manager";
import { mapWithConcurrencyLimit } from "./parallel";
import { renderCall, renderResult } from "./render";
import { renderTemplate } from "./template";
import { type AgentProgress, type SingleResult, type TaskParams, type TaskToolDetails, taskSchema } from "./types";
import {
	applyBaseline,
	captureBaseline,
	captureDeltaPatch,
	cleanupWorktree,
	ensureWorktree,
	getRepoRoot,
} from "./worktree";

/** Format byte count for display */
function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
	return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

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
 * Build dynamic tool description listing available agents.
 */
async function buildDescription(cwd: string, maxConcurrency: number): Promise<string> {
	const { agents } = await discoverAgents(cwd);

	return renderPromptTemplate(taskDescriptionTemplate, {
		agents,
		MAX_CONCURRENCY: maxConcurrency,
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
export class TaskTool implements AgentTool<typeof taskSchema, TaskToolDetails, Theme> {
	public readonly name = "task";
	public readonly label = "Task";
	public readonly description: string;
	public readonly parameters = taskSchema;
	public readonly renderCall = renderCall;
	public readonly renderResult = renderResult;

	private readonly session: ToolSession;
	private readonly blockedAgent: string | undefined;

	private constructor(session: ToolSession, description: string) {
		this.session = session;
		this.description = description;
		this.blockedAgent = process.env.OMP_BLOCKED_AGENT;
	}

	/**
	 * Create a TaskTool instance with async agent discovery.
	 */
	public static async create(session: ToolSession): Promise<TaskTool> {
		const maxConcurrency = session.settings.get("task.maxConcurrency");
		const description = await buildDescription(session.cwd, maxConcurrency);
		return new TaskTool(session, description);
	}

	public async execute(
		_toolCallId: string,
		params: TaskParams,
		signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<TaskToolDetails>,
	): Promise<AgentToolResult<TaskToolDetails>> {
		const startTime = Date.now();
		const { agents, projectAgentsDir } = await discoverAgents(this.session.cwd);
		const { agent: agentName, context, schema: outputSchema, isolated } = params;
		const isIsolated = isolated === true;
		const maxConcurrency = this.session.settings.get("task.maxConcurrency");

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

		const effectiveAgentModel = isDefaultModelAlias(effectiveAgent.model) ? undefined : effectiveAgent.model;
		const modelOverride =
			effectiveAgentModel ?? this.session.getActiveModelString?.() ?? this.session.getModelString?.();
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
		let baseline = null as Awaited<ReturnType<typeof captureBaseline>> | null;
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
		const tempArtifactsDir = artifactsDir ? null : path.join(os.tmpdir(), `omp-task-${nanoid()}`);
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
			if (this.blockedAgent && agentName === this.blockedAgent) {
				return {
					content: [
						{
							type: "text",
							text: `Cannot spawn ${this.blockedAgent} agent from within itself (recursion prevention). Use a different agent type.`,
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
			const outputManager =
				this.session.agentOutputManager ?? new AgentOutputManager(this.session.getArtifactsDir ?? (() => null));
			const uniqueIds = await outputManager.allocateBatch(tasks.map(t => t.id));
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
					args: t.args,
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
						context: undefined, // Already prepended above
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
								args: tasksWithSkills[index]?.args,
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
				let worktreeDir: string | undefined;
				try {
					if (!repoRoot || !baseline) {
						throw new Error("Isolated task execution not initialized.");
					}
					worktreeDir = await ensureWorktree(repoRoot, task.id);
					await applyBaseline(worktreeDir, baseline);
					const result = await runSubprocess({
						cwd: this.session.cwd,
						worktree: worktreeDir,
						agent,
						task: task.task,
						description: task.description,
						index,
						id: task.id,
						context: undefined, // Already prepended above
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
								args: tasksWithSkills[index]?.args,
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
					const patch = await captureDeltaPatch(worktreeDir, baseline);
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
					if (worktreeDir) {
						await cleanupWorktree(worktreeDir);
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
					return {
						...result,
						args: tasksWithSkills[index]?.args,
					};
				}
				const task = tasksWithSkills[index];
				return {
					index,
					id: task.id,
					agent: agentName,
					agentSource: agent.source,
					task: task.task,
					args: task.args,
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
							const combinedPatchPath = path.join(os.tmpdir(), `omp-task-combined-${nanoid()}.patch`);
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
