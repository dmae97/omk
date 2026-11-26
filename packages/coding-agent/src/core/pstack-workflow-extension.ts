import type { AgentMessage } from "omk-agent-core";
import type { TextContent } from "omk-ai";
import { Key } from "omk-tui";
import type { ExtensionAPI, ExtensionContext, ExtensionFactory } from "./extensions/types.ts";
import * as gitBranch from "./git-branch-manager.ts";
import { runBranchMenu } from "./git-branch-menu.ts";
import { resolveHerdrConfig } from "./herdr-client.ts";
import * as plan from "./pstack-plan-state.ts";

export interface PstackWorkflowOptions {
	readonly runner?: gitBranch.CommandRunner;
	readonly env?: NodeJS.ProcessEnv;
}

const ENTRY_TYPE = "pstack-plan-state";
const PLAN_HELP =
	"Usage: /plan [feature|bug-fix|refactoring|investigation|multi-phase-plan] [goal] | status | run | done <n...> | off";
const BRANCH_HELP =
	"Usage: /branch [status|list|switch <name>|new <name> [base]|worktree <name> [base] [--pane]|prune [--apply]]";

function readAssistantText(message: AgentMessage): string | undefined {
	if (message.role !== "assistant" || !Array.isArray(message.content)) return undefined;
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

export function createPstackWorkflowExtension(options: PstackWorkflowOptions = {}): ExtensionFactory {
	return (omk: ExtensionAPI) => {
		const herdrActive = resolveHerdrConfig(options.env ?? process.env) !== undefined;
		const runner = options.runner;
		let state: plan.PlanState = plan.IDLE_PLAN_STATE;
		let lastBranch: string | null = null;

		const persist = () => omk.appendEntry(ENTRY_TYPE, state);
		const notifyResult = (ctx: ExtensionContext, res: gitBranch.BranchOpResult) =>
			ctx.ui.notify(res.ok ? res.message : res.error, res.ok ? "info" : "warning");

		const syncPlanUi = (ctx: ExtensionContext) => {
			if (!ctx.hasUI) return;
			const badge = plan.formatPlanStatusBadge(state);
			const color = state.phase === "planning" ? "warning" : "accent";
			ctx.ui.setStatus("plan", badge ? ctx.ui.theme.fg(color, badge) : undefined);
			ctx.ui.setWidget("pstack-plan", plan.formatPlanWidgetLines(state, lastBranch, ctx.ui.theme));
		};

		const syncBranchUi = async (ctx: ExtensionContext): Promise<gitBranch.RepoBranchSnapshot> => {
			const snap = await gitBranch.readRepoBranchSnapshot(ctx.cwd, { runner, herdrActive });
			lastBranch = snap.currentBranch;
			if (ctx.hasUI) {
				const badge = gitBranch.formatBranchBadge(snap);
				ctx.ui.setStatus("branch", badge ? ctx.ui.theme.fg("muted", badge) : undefined);
			}
			return snap;
		};

		const enterPlan = (ctx: ExtensionContext, playbook: plan.PstackPlaybook, goal?: string) => {
			const savedTools = state.phase === "planning" ? state.savedTools : omk.getActiveTools();
			state = plan.reducePlanState(state, { type: "enter_plan", playbook, goal, savedTools });
			omk.setActiveTools(plan.filterReadOnlyTools(savedTools));
			persist();
			syncPlanUi(ctx);
			ctx.ui.notify(`Pstack /plan active (${plan.PLAYBOOK_PROFILES[playbook].label}, read-only).`, "info");
		};

		const exitPlan = (ctx: ExtensionContext, notify = true) => {
			if (state.phase === "planning" && state.savedTools.length > 0) omk.setActiveTools([...state.savedTools]);
			state = plan.reducePlanState(state, { type: "exit" });
			persist();
			syncPlanUi(ctx);
			if (notify) ctx.ui.notify("Pstack /plan exited. Normal tools restored.", "info");
		};

		const startExecution = (ctx: ExtensionContext, branch?: string) => {
			if (state.phase !== "planning") return;
			const restore = state.savedTools;
			state = plan.reducePlanState(state, { type: "start_execution", branch: branch ?? lastBranch ?? undefined });
			if (restore.length > 0) omk.setActiveTools([...restore]);
			persist();
			syncPlanUi(ctx);
			const first = state.phase === "executing" ? state.steps[0]?.text : undefined;
			const content = first
				? `Execute the approved Pstack plan. Start with step 1: ${first}`
				: "Execute the approved Pstack plan.";
			omk.sendMessage({ customType: "pstack-plan-execute", content, display: true }, { triggerTurn: true });
		};

		omk.registerCommand("plan", {
			description: "Pstack read-only /plan mode (feature|bug-fix|refactoring|investigation|multi-phase-plan)",
			handler: async (args, ctx) => {
				const action = plan.parsePlanCommandArgs(args);
				if (action.kind === "help") return ctx.ui.notify(PLAN_HELP, "info");
				if (action.kind === "status") {
					const lines = plan.formatPlanWidgetLines(state, lastBranch);
					return ctx.ui.notify(lines ? lines.join("\n") : "Pstack /plan is idle.", "info");
				}
				if (action.kind === "exit") return exitPlan(ctx);
				if (action.kind === "execute") {
					return state.phase === "planning"
						? startExecution(ctx)
						: ctx.ui.notify("Not in planning phase.", "warning");
				}
				if (action.kind === "done") {
					if (state.phase !== "executing") return ctx.ui.notify("Not in execution phase.", "warning");
					const applied = plan.applyDoneSteps(state, action.steps);
					if (applied.newlyCompleted === 0) return ctx.ui.notify("No matching open plan steps.", "info");
					state = applied.state;
					persist();
					syncPlanUi(ctx);
					if (applied.allDone && state.phase === "executing") {
						const summary = state.steps.map((s) => `[x] ${s.step}. ${s.text}`).join("\n");
						omk.sendMessage(
							{
								customType: "pstack-plan-complete",
								content: `Pstack Plan Complete\n\n${summary}`,
								display: true,
							},
							{ triggerTurn: false },
						);
						return exitPlan(ctx, false);
					}
					return;
				}
				if (action.kind === "enter") return enterPlan(ctx, action.playbook, action.goal);
				if (state.phase !== "idle") return exitPlan(ctx);
				if (!ctx.hasUI) return enterPlan(ctx, "feature");
				const picked = await ctx.ui.select("Select Pstack playbook for /plan", Object.keys(plan.PLAYBOOK_PROFILES));
				if (picked && picked in plan.PLAYBOOK_PROFILES) enterPlan(ctx, picked as plan.PstackPlaybook);
			},
		});

		omk.registerCommand("branch", {
			description: "Manage git branches & worktrees (Herdr pane integration when HERDR_ENV=1)",
			handler: async (args, ctx) => {
				const action = gitBranch.parseBranchCommandArgs(args);
				if (action.kind === "help") return ctx.ui.notify(BRANCH_HELP, "info");
				if (action.kind === "invalid") return ctx.ui.notify(action.message, "warning");
				if (action.kind === "menu") {
					const changed = await runBranchMenu(ctx, await syncBranchUi(ctx), { runner, herdrActive });
					if (changed) {
						await syncBranchUi(ctx);
						syncPlanUi(ctx);
					}
					return;
				}
				if (action.kind === "status" || action.kind === "list") {
					return ctx.ui.notify(gitBranch.formatBranchSnapshotSummary(await syncBranchUi(ctx)), "info");
				}
				const res = await gitBranch.executeBranchAction(ctx.cwd, action, { runner, herdrActive });
				await syncBranchUi(ctx);
				syncPlanUi(ctx);
				notifyResult(ctx, res);
			},
		});

		omk.registerShortcut(Key.ctrlAlt("p"), {
			description: "Toggle Pstack /plan mode",
			handler: async (ctx) => {
				if (state.phase !== "idle") exitPlan(ctx);
				else enterPlan(ctx, "feature");
			},
		});

		omk.on("session_start", async (_event, ctx) => {
			state = plan.IDLE_PLAN_STATE;
			const entries = ctx.sessionManager.getEntries() as Array<{
				type?: string;
				customType?: string;
				data?: unknown;
			}>;
			const saved = entries.filter((e) => e.type === "custom" && e.customType === ENTRY_TYPE).pop();
			if (saved?.data) state = plan.parsePersistedPlanState(saved.data);
			if (state.phase === "planning" && state.savedTools.length > 0) {
				omk.setActiveTools(plan.filterReadOnlyTools(state.savedTools));
			}
			await syncBranchUi(ctx);
			syncPlanUi(ctx);
		});

		omk.on("before_agent_start", () => {
			const content = plan.buildPlanSystemInjection(state);
			return content ? { message: { customType: "pstack-plan-context", content, display: false } } : undefined;
		});

		omk.on("tool_call", (event) => {
			if (state.phase !== "planning") return undefined;
			if (plan.isWriteToolName(event.toolName)) {
				return {
					block: true,
					reason: `Pstack /plan mode is read-only. Use /plan run or /plan off before calling ${event.toolName}.`,
				};
			}
			if (plan.isShellToolName(event.toolName)) {
				const command = String((event.input as { command?: unknown })?.command ?? "");
				if (!plan.isReadOnlyPlanCommand(command)) {
					return { block: true, reason: `Pstack /plan mode blocked non-read-only command: ${command}` };
				}
			}
			return undefined;
		});

		omk.on("turn_end", (event, ctx) => {
			const text = state.phase === "executing" ? readAssistantText(event.message) : undefined;
			if (!text) return;
			const applied = plan.applyDoneSteps(state, plan.extractDoneStepNumbers(text));
			if (applied.newlyCompleted > 0) {
				state = applied.state;
				persist();
				syncPlanUi(ctx);
			}
		});

		omk.on("agent_end", async (event, ctx) => {
			if (state.phase === "executing" && state.steps.length > 0 && state.steps.every((s) => s.done)) {
				const summary = state.steps.map((s) => `[x] ${s.step}. ${s.text}`).join("\n");
				const msg = {
					customType: "pstack-plan-complete",
					content: `Pstack Plan Complete\n\n${summary}`,
					display: true,
				};
				omk.sendMessage(msg, { triggerTurn: false });
				return exitPlan(ctx, false);
			}
			if (state.phase !== "planning" || !ctx.hasUI) return;
			const lastText = [...event.messages]
				.reverse()
				.map(readAssistantText)
				.find((t): t is string => t !== undefined);
			if (lastText) {
				const ext = plan.extractPlanFromText(lastText);
				if (ext.steps.length > 0 || ext.dataShape) {
					state = plan.reducePlanState(state, {
						type: "capture_plan",
						steps: ext.steps,
						dataShape: ext.dataShape,
					});
					persist();
					syncPlanUi(ctx);
				}
			}
			if (state.phase !== "planning" || state.steps.length === 0) return;
			const wtOption = herdrActive ? "Create worktree + Herdr pane" : "Create worktree";
			const choice = await ctx.ui.select("Pstack Plan - next action?", [
				"Execute plan on current branch",
				wtOption,
				"Refine plan",
				"Stay in plan mode",
			]);
			if (choice === "Execute plan on current branch") return startExecution(ctx);
			if (choice === wtOption) {
				const name = (await ctx.ui.input("Worktree branch name", "feat/plan-task"))?.trim();
				if (!name) return;
				const opts = { openPane: herdrActive, runner, herdrActive };
				notifyResult(ctx, await gitBranch.createBranchWorktree(ctx.cwd, name, opts));
				await syncBranchUi(ctx);
			} else if (choice === "Refine plan") {
				const note = (await ctx.ui.editor("Refine Pstack plan:", plan.formatPlanDraft(state)))?.trim();
				if (note) omk.sendUserMessage(note);
			}
		});
	};
}
