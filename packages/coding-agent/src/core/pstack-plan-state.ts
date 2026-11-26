import type { PlanState, PlanStep, PstackPlaybook } from "./pstack-plan-format.ts";

export {
	extractDoneStepNumbers,
	extractPlanFromText,
	formatPlanDraft,
	formatPlanStatusBadge,
	formatPlanWidgetLines,
	type PlanState,
	type PlanStep,
	type PlanWidgetTheme,
	type PstackPlaybook,
} from "./pstack-plan-format.ts";
export { filterReadOnlyTools, isReadOnlyPlanCommand, isShellToolName, isWriteToolName } from "./pstack-plan-guards.ts";

export interface PlaybookProfile {
	readonly id: PstackPlaybook;
	readonly label: string;
	readonly sections: readonly string[];
	readonly promptHint: string;
}

export const PLAYBOOK_PROFILES: Readonly<Record<PstackPlaybook, PlaybookProfile>> = {
	feature: {
		id: "feature",
		label: "Feature",
		sections: ["Data Shape", "Boundary & Scope", "Plan", "Verification"],
		promptHint: "Name the data shape first, keep the diff minimal, and verify the real surface.",
	},
	"bug-fix": {
		id: "bug-fix",
		label: "Bug fix",
		sections: ["Reproduction", "Root Cause", "Plan", "Regression Test"],
		promptHint: "Reproduce first, isolate the root cause, lock a regression test, then fix minimally.",
	},
	refactoring: {
		id: "refactoring",
		label: "Refactoring",
		sections: ["Target Shape", "Invariants", "Plan", "Verification"],
		promptHint: "Preserve observable behavior, subtract dead weight before adding, verify each unit.",
	},
	investigation: {
		id: "investigation",
		label: "Investigation",
		sections: ["Question", "Evidence Plan", "Plan", "Deliverable"],
		promptHint: "Stay read-only and answer with cited file paths and observed behavior.",
	},
	"multi-phase-plan": {
		id: "multi-phase-plan",
		label: "Multi-phase plan",
		sections: ["Data Shape", "Phase Boundaries", "Plan", "Checkpoints"],
		promptHint: "Sequence work into small verifiable units that each end in a green check.",
	},
};

const PLAYBOOK_ALIASES: Readonly<Record<string, PstackPlaybook>> = {
	feature: "feature",
	feat: "feature",
	"bug-fix": "bug-fix",
	bug: "bug-fix",
	fix: "bug-fix",
	refactoring: "refactoring",
	refactor: "refactoring",
	investigation: "investigation",
	investigate: "investigation",
	"multi-phase-plan": "multi-phase-plan",
	"multi-phase": "multi-phase-plan",
	phases: "multi-phase-plan",
};

export const IDLE_PLAN_STATE: PlanState = { phase: "idle" };

export type PlanCommandAction =
	| { readonly kind: "toggle" }
	| { readonly kind: "enter"; readonly playbook: PstackPlaybook; readonly goal?: string }
	| { readonly kind: "status" }
	| { readonly kind: "exit" }
	| { readonly kind: "execute" }
	| { readonly kind: "done"; readonly steps: readonly number[] }
	| { readonly kind: "help" };

export type PlanStateEvent =
	| {
			readonly type: "enter_plan";
			readonly playbook: PstackPlaybook;
			readonly goal?: string;
			readonly savedTools: readonly string[];
	  }
	| { readonly type: "capture_plan"; readonly steps: readonly PlanStep[]; readonly dataShape?: string }
	| { readonly type: "start_execution"; readonly branch?: string }
	| { readonly type: "exit" };

export function parsePlanCommandArgs(raw: string): PlanCommandAction {
	const trimmed = raw.trim();
	if (!trimmed) return { kind: "toggle" };
	const [head, ...rest] = trimmed.split(/\s+/);
	const key = head.toLowerCase();
	if (key === "off" || key === "exit" || key === "stop" || key === "cancel") return { kind: "exit" };
	if (key === "status" || key === "show") return { kind: "status" };
	if (key === "run" || key === "exec" || key === "execute") return { kind: "execute" };
	if (key === "done") {
		const steps = rest.map(Number).filter((n) => Number.isInteger(n) && n > 0);
		return steps.length > 0 ? { kind: "done", steps } : { kind: "help" };
	}
	if (key === "help" || key === "-h" || key === "--help") return { kind: "help" };
	const playbook = PLAYBOOK_ALIASES[key];
	if (playbook) {
		const goal = rest.join(" ").trim();
		return goal ? { kind: "enter", playbook, goal } : { kind: "enter", playbook };
	}
	return { kind: "enter", playbook: "feature", goal: trimmed };
}

export function reducePlanState(state: PlanState, event: PlanStateEvent): PlanState {
	if (event.type === "exit") return IDLE_PLAN_STATE;
	if (event.type === "enter_plan") {
		return {
			phase: "planning",
			playbook: event.playbook,
			...(event.goal ? { goal: event.goal } : {}),
			steps: [],
			savedTools: [...event.savedTools],
		};
	}
	if (state.phase !== "planning") return state;
	if (event.type === "capture_plan") {
		return { ...state, steps: event.steps, ...(event.dataShape ? { dataShape: event.dataShape } : {}) };
	}
	return {
		phase: "executing",
		playbook: state.playbook,
		...(state.goal ? { goal: state.goal } : {}),
		...(state.dataShape ? { dataShape: state.dataShape } : {}),
		steps: state.steps,
		...(event.branch ? { branch: event.branch } : {}),
	};
}

export function applyDoneSteps(
	state: PlanState,
	doneNumbers: readonly number[],
): { readonly state: PlanState; readonly newlyCompleted: number; readonly allDone: boolean } {
	if (state.phase !== "executing" || state.steps.length === 0) return { state, newlyCompleted: 0, allDone: false };
	const doneSet = new Set(doneNumbers);
	let newlyCompleted = 0;
	const steps = state.steps.map((item) => {
		if (!item.done && doneSet.has(item.step)) {
			newlyCompleted += 1;
			return { ...item, done: true };
		}
		return item;
	});
	return { state: { ...state, steps }, newlyCompleted, allDone: steps.every((item) => item.done) };
}

export function buildPlanSystemInjection(state: PlanState): string | undefined {
	if (state.phase === "idle") return undefined;
	const profile = PLAYBOOK_PROFILES[state.playbook];
	if (state.phase === "planning") {
		return [
			`[PSTACK PLAN MODE - ${profile.label} (read-only)]`,
			`${state.goal ? `Goal: ${state.goal}\n` : ""}${profile.promptHint}`,
			"Restrictions: read-only inspection only; file edits and mutating shell commands are blocked.",
			`Include sections: ${profile.sections.join(", ")}.`,
			"Format your plan with a 'Data Shape:' line and a 'Plan:' section containing numbered verifiable steps (1., 2., ...).",
		].join("\n");
	}
	const remaining = state.steps.filter((s) => !s.done);
	return [
		`[PSTACK PLAN EXECUTION - ${profile.label}]`,
		state.branch ? `Target branch: ${state.branch}` : "",
		state.dataShape ? `Data Shape: ${state.dataShape}` : "",
		remaining.length > 0
			? `Remaining steps:\n${remaining.map((s) => `${s.step}. ${s.text}`).join("\n")}`
			: "Execute the approved plan.",
		"After completing each step, include [DONE:n] in your response.",
	]
		.filter(Boolean)
		.join("\n");
}

function isPlanStep(raw: unknown): raw is PlanStep {
	if (typeof raw !== "object" || raw === null) return false;
	const r = raw as Record<string, unknown>;
	return typeof r.step === "number" && typeof r.text === "string" && typeof r.done === "boolean";
}

export function parsePersistedPlanState(raw: unknown): PlanState {
	if (typeof raw !== "object" || raw === null) return IDLE_PLAN_STATE;
	const r = raw as Record<string, unknown>;
	const playbook = typeof r.playbook === "string" ? PLAYBOOK_ALIASES[r.playbook] : undefined;
	if (!playbook) return IDLE_PLAN_STATE;
	const steps = Array.isArray(r.steps) ? r.steps.filter(isPlanStep) : [];
	const goal = typeof r.goal === "string" && r.goal.trim() ? r.goal : undefined;
	const dataShape = typeof r.dataShape === "string" && r.dataShape.trim() ? r.dataShape : undefined;
	if (r.phase === "planning") {
		const savedTools = Array.isArray(r.savedTools)
			? r.savedTools.filter((t): t is string => typeof t === "string")
			: [];
		return {
			phase: "planning",
			playbook,
			...(goal ? { goal } : {}),
			...(dataShape ? { dataShape } : {}),
			steps,
			savedTools,
		};
	}
	if (r.phase === "executing") {
		const branch = typeof r.branch === "string" && r.branch.trim() ? r.branch : undefined;
		return {
			phase: "executing",
			playbook,
			...(goal ? { goal } : {}),
			...(dataShape ? { dataShape } : {}),
			steps,
			...(branch ? { branch } : {}),
		};
	}
	return IDLE_PLAN_STATE;
}
