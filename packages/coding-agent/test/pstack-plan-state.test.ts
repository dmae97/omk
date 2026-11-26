import { describe, expect, it } from "vitest";
import {
	applyDoneSteps,
	buildPlanSystemInjection,
	extractDoneStepNumbers,
	extractPlanFromText,
	filterReadOnlyTools,
	formatPlanDraft,
	formatPlanStatusBadge,
	formatPlanWidgetLines,
	IDLE_PLAN_STATE,
	isReadOnlyPlanCommand,
	isShellToolName,
	isWriteToolName,
	parsePersistedPlanState,
	parsePlanCommandArgs,
	reducePlanState,
} from "../src/core/pstack-plan-state.ts";

describe("parsePlanCommandArgs", () => {
	it("parses control verbs and playbooks", () => {
		expect(parsePlanCommandArgs("")).toEqual({ kind: "toggle" });
		expect(parsePlanCommandArgs("off")).toEqual({ kind: "exit" });
		expect(parsePlanCommandArgs("status")).toEqual({ kind: "status" });
		expect(parsePlanCommandArgs("run")).toEqual({ kind: "execute" });
		expect(parsePlanCommandArgs("help")).toEqual({ kind: "help" });
		expect(parsePlanCommandArgs("bug-fix memory leak")).toEqual({
			kind: "enter",
			playbook: "bug-fix",
			goal: "memory leak",
		});
		expect(parsePlanCommandArgs("refactor auth parser")).toEqual({
			kind: "enter",
			playbook: "refactoring",
			goal: "auth parser",
		});
		expect(parsePlanCommandArgs("build branch switcher")).toEqual({
			kind: "enter",
			playbook: "feature",
			goal: "build branch switcher",
		});
	});
});

describe("read-only planning guards", () => {
	it("filters mutating tools while keeping custom/MCP read tools", () => {
		const tools = ["read", "bash", "edit", "write", "replace", "grep", "todo", "adaptorch__adaptorch_route_topology"];
		expect(filterReadOnlyTools(tools)).toEqual([
			"read",
			"bash",
			"grep",
			"todo",
			"adaptorch__adaptorch_route_topology",
		]);
		expect(isWriteToolName("edit")).toBe(true);
		expect(isWriteToolName("write")).toBe(true);
		expect(isWriteToolName("replace_match")).toBe(true);
		expect(isWriteToolName("read")).toBe(false);
	});

	it("allows safe read-only commands and rejects mutating or redirected commands", () => {
		expect(isReadOnlyPlanCommand("git status")).toBe(true);
		expect(isReadOnlyPlanCommand("git log --oneline -n 10 | head -n 5")).toBe(true);
		expect(isReadOnlyPlanCommand("git worktree list --porcelain")).toBe(true);
		expect(isReadOnlyPlanCommand("herdr pane list && herdr worktree list")).toBe(true);
		expect(isReadOnlyPlanCommand("rg -n setHeader packages/coding-agent/src")).toBe(true);

		expect(isReadOnlyPlanCommand("")).toBe(false);
		expect(isReadOnlyPlanCommand("git switch main")).toBe(false);
		expect(isReadOnlyPlanCommand("git commit -m 'x'")).toBe(false);
		expect(isReadOnlyPlanCommand("git worktree add ../foo")).toBe(false);
		expect(isReadOnlyPlanCommand("git branch -D old")).toBe(false);
		expect(isReadOnlyPlanCommand("echo hi > out.txt")).toBe(false);
		expect(isReadOnlyPlanCommand("ls $(rm -rf /tmp/x)")).toBe(false);
		expect(isReadOnlyPlanCommand("ls && rm foo.ts")).toBe(false);
		expect(isReadOnlyPlanCommand("npm install lodash")).toBe(false);
		expect(isReadOnlyPlanCommand("herdr pane run p1 'rm -rf /'")).toBe(false);
	});
});

describe("plan state machine and extraction", () => {
	it("injects nothing when idle (G0 invariant)", () => {
		expect(buildPlanSystemInjection(IDLE_PLAN_STATE)).toBeUndefined();
		expect(formatPlanStatusBadge(IDLE_PLAN_STATE)).toBeUndefined();
		expect(formatPlanWidgetLines(IDLE_PLAN_STATE, "main")).toBeUndefined();
	});

	it("extracts Data Shape and numbered Plan steps and tracks [DONE:n] progress", () => {
		const assistantText = [
			"Data Shape: Discriminated union PlanState = idle | planning | executing",
			"",
			"**Plan:**",
			"1. Add pure plan state reducer",
			"2. Wire builtin pstack-workflow extension",
			"3. Verify in tmux TUI",
		].join("\n");
		const extracted = extractPlanFromText(assistantText);
		expect(extracted.dataShape).toContain("Discriminated union PlanState");
		expect(extracted.steps).toEqual([
			{ step: 1, text: "Add pure plan state reducer", done: false },
			{ step: 2, text: "Wire builtin pstack-workflow extension", done: false },
			{ step: 3, text: "Verify in tmux TUI", done: false },
		]);

		let state = reducePlanState(IDLE_PLAN_STATE, {
			type: "enter_plan",
			playbook: "feature",
			goal: "Add /plan",
			savedTools: ["read", "bash", "edit", "write"],
		});
		expect(state.phase).toBe("planning");
		expect(formatPlanStatusBadge(state)).toBe("plan:feature (ro)");
		expect(buildPlanSystemInjection(state)).toContain("PSTACK PLAN MODE");

		state = reducePlanState(state, {
			type: "capture_plan",
			steps: extracted.steps,
			dataShape: extracted.dataShape,
		});
		state = reducePlanState(state, { type: "start_execution", branch: "feat/pstack-plan" });
		expect(state.phase).toBe("executing");
		expect(formatPlanStatusBadge(state)).toBe("plan:feature 0/3");
		expect(formatPlanWidgetLines(state, "feat/pstack-plan")?.join("\n")).toContain("feat/pstack-plan");

		const done1 = applyDoneSteps(state, extractDoneStepNumbers("Finished first two [DONE:1] [done:2]"));
		expect(done1.newlyCompleted).toBe(2);
		expect(done1.allDone).toBe(false);
		expect(formatPlanStatusBadge(done1.state)).toBe("plan:feature 2/3");

		const done2 = applyDoneSteps(done1.state, extractDoneStepNumbers("All finished [DONE:3]"));
		expect(done2.newlyCompleted).toBe(1);
		expect(done2.allDone).toBe(true);
	});

	it("validates persisted session data at the boundary", () => {
		expect(parsePersistedPlanState(null)).toEqual(IDLE_PLAN_STATE);
		expect(parsePersistedPlanState({ phase: "unknown" })).toEqual(IDLE_PLAN_STATE);
		expect(
			parsePersistedPlanState({
				phase: "planning",
				playbook: "bug-fix",
				goal: "fix crash",
				steps: [{ step: 1, text: "Reproduce", done: false }],
				savedTools: ["read", "edit"],
			}),
		).toEqual({
			phase: "planning",
			playbook: "bug-fix",
			goal: "fix crash",
			steps: [{ step: 1, text: "Reproduce", done: false }],
			savedTools: ["read", "edit"],
		});
	});

	it("hardens read-only guards against alternate shells, find -delete/-exec, and git -c while allowing jq and gh view", () => {
		expect(isWriteToolName("lean-ctx__ctx_patch")).toBe(true);
		expect(isWriteToolName("subagent")).toBe(true);
		expect(isWriteToolName("github__create_pull_request")).toBe(true);
		expect(isShellToolName("bash")).toBe(true);
		expect(isShellToolName("hypa_shell")).toBe(true);
		expect(isShellToolName("lean-ctx__ctx_shell")).toBe(true);
		expect(isShellToolName("read")).toBe(false);

		expect(isReadOnlyPlanCommand("find . -delete")).toBe(false);
		expect(isReadOnlyPlanCommand("find . -exec rm {} +")).toBe(false);
		expect(isReadOnlyPlanCommand("git -c core.fsmonitor=evil status")).toBe(false);
		expect(isReadOnlyPlanCommand("gh pr create --title x")).toBe(false);

		expect(isReadOnlyPlanCommand("find src -name '*.ts'")).toBe(true);
		expect(isReadOnlyPlanCommand("jq '.name' package.json")).toBe(true);
		expect(isReadOnlyPlanCommand("gh pr view 123")).toBe(true);
		expect(isReadOnlyPlanCommand("git -C /repo status")).toBe(true);
	});

	it("parses heading-style plans with blank lines, sub-bullets, and /plan done args", () => {
		const text = [
			"## Data Shape",
			"PlanState discriminated union",
			"",
			"### 2. 실행 계획",
			"1. Harden guards",
			"   - block hypa_shell",
			"",
			"2. Update widget",
			"",
			"## Verification",
			"1. Run vitest",
		].join("\n");
		const ext = extractPlanFromText(text);
		expect(ext.dataShape).toBe("PlanState discriminated union");
		expect(ext.steps).toEqual([
			{ step: 1, text: "Harden guards", done: false },
			{ step: 2, text: "Update widget", done: false },
		]);
		expect(parsePlanCommandArgs("done 1 2")).toEqual({ kind: "done", steps: [1, 2] });
		const state = reducePlanState(
			reducePlanState(IDLE_PLAN_STATE, { type: "enter_plan", playbook: "feature", savedTools: ["read"] }),
			{ type: "capture_plan", steps: ext.steps, dataShape: ext.dataShape },
		);
		expect(formatPlanDraft(state)).toContain("Data Shape: PlanState discriminated union");
		expect(formatPlanDraft(state)).toContain("1. Harden guards");
		const widget = formatPlanWidgetLines(state, "main")!.join("\n");
		expect(widget).toContain("── ● PLAN · FEATURE (RO) · GIT main");
		expect(widget).toContain("│ ○ 1. Harden guards");
	});
});
