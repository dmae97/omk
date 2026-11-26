export type PstackPlaybook = "feature" | "bug-fix" | "refactoring" | "investigation" | "multi-phase-plan";

export interface PlanStep {
	readonly step: number;
	readonly text: string;
	readonly done: boolean;
}

export type PlanState =
	| { readonly phase: "idle" }
	| {
			readonly phase: "planning";
			readonly playbook: PstackPlaybook;
			readonly goal?: string;
			readonly dataShape?: string;
			readonly steps: readonly PlanStep[];
			readonly savedTools: readonly string[];
	  }
	| {
			readonly phase: "executing";
			readonly playbook: PstackPlaybook;
			readonly goal?: string;
			readonly dataShape?: string;
			readonly steps: readonly PlanStep[];
			readonly branch?: string;
	  };
export interface PlanWidgetTheme {
	fg(color: "borderMuted" | "accent" | "warning" | "success" | "dim" | "muted", text: string): string;
}

const DATA_SHAPE_INLINE_RE = /^(?:\*\*|#{1,4}\s*)?(?:\d+\.\s*)?(?:Data Shape|데이터\s*셰이프)\s*:\*?\*?\s*(.+)$/im;
const DATA_SHAPE_HEADING_RE = /(?:^|\n)#{1,4}\s*(?:\d+\.\s*)?(?:Data Shape|데이터\s*셰이프)\s*\n+([^\n#*-][^\n]*)/i;
const PLAN_SECTION_RE = /(?:^|\n)(?:\*\*|#{1,4}\s*)?(?:\d+\.\s*)?(?:Plan|실행\s*계획|계획)\s*:?\*?\*?\s*\n([\s\S]*)/i;
const SECTION_STOP_RE = /^(?:#{1,4}\s|\*\*(?:Verification|검증|Risks|리스크|Notes|Open Decisions)\b)/i;

export function extractPlanFromText(text: string): {
	readonly dataShape?: string;
	readonly steps: readonly PlanStep[];
} {
	const dataShape = text.match(DATA_SHAPE_INLINE_RE)?.[1]?.trim() ?? text.match(DATA_SHAPE_HEADING_RE)?.[1]?.trim();
	const planHeader = text.match(PLAN_SECTION_RE);
	if (!planHeader) return { ...(dataShape ? { dataShape } : {}), steps: [] };
	const steps: PlanStep[] = [];
	for (const line of planHeader[1].split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		if (SECTION_STOP_RE.test(trimmed)) break;
		if (/^\s/.test(line)) continue;
		const match = trimmed.match(/^(\d+)[.)]\s+(.+)$/);
		if (!match) continue;
		const stepText = match[2].replace(/\*\*/g, "").trim();
		if (stepText.length >= 3) steps.push({ step: Number(match[1]), text: stepText, done: false });
	}
	return { ...(dataShape ? { dataShape } : {}), steps };
}

export function extractDoneStepNumbers(text: string): number[] {
	const found: number[] = [];
	for (const match of text.matchAll(/\[DONE:(\d+)\]/gi)) {
		const num = Number(match[1]);
		if (Number.isInteger(num) && num > 0) found.push(num);
	}
	return found;
}

export function formatPlanStatusBadge(state: PlanState): string | undefined {
	if (state.phase === "idle") return undefined;
	if (state.phase === "planning") return `plan:${state.playbook} (ro)`;
	return `plan:${state.playbook} ${state.steps.filter((s) => s.done).length}/${state.steps.length}`;
}

export function formatPlanDraft(state: PlanState): string {
	if (state.phase === "idle") return "";
	const lines: string[] = [];
	if (state.dataShape) lines.push(`Data Shape: ${state.dataShape}`, "");
	lines.push("Plan:");
	for (const step of state.steps) lines.push(`${step.step}. ${step.text}`);
	return lines.join("\n");
}

export function formatPlanWidgetLines(
	state: PlanState,
	branch: string | null,
	uiTheme?: PlanWidgetTheme,
): string[] | undefined {
	if (state.phase === "idle") return undefined;
	const fg = (color: "borderMuted" | "accent" | "warning" | "success" | "dim" | "muted", text: string) =>
		uiTheme ? uiTheme.fg(color, text) : text;
	const pb = state.playbook.toUpperCase();
	const dot = fg("borderMuted", " · ");
	const pipe = fg("borderMuted", "│");
	const header =
		state.phase === "planning"
			? `${fg("borderMuted", "──")} ${fg("warning", "●")} ${fg("dim", `PLAN · ${pb} (RO)`)}${branch ? `${dot}${fg("dim", "GIT")} ${fg("muted", branch)}` : ""}`
			: `${fg("borderMuted", "──")} ${fg("accent", "▸")} ${fg("dim", `EXEC · ${pb} ${state.steps.filter((s) => s.done).length}/${state.steps.length}`)}${branch ? `${dot}${fg("dim", "GIT")} ${fg("muted", branch)}` : ""}`;
	const lines = [header];
	if (state.dataShape) lines.push(`${pipe} ${fg("dim", "SHAPE")} ${fg("muted", state.dataShape)}`);
	for (const step of state.steps) {
		const mark = step.done ? fg("success", "✓") : fg("dim", "○");
		const text = fg(step.done ? "dim" : "muted", `${step.step}. ${step.text}`);
		lines.push(`${pipe} ${mark} ${text}`);
	}
	return lines;
}
