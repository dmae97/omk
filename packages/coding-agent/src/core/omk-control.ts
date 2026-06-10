import { VERSION } from "../config.ts";

export type OmkTurnIntent =
	| "research"
	| "planning"
	| "coding"
	| "debugging"
	| "refactor"
	| "review"
	| "test-generation"
	| "documentation"
	| "shell-operation";

export type OmkTurnRisk = "read" | "write" | "shell" | "merge";

export type OmkCapability = "read" | "write" | "patch" | "shell" | "merge" | "review";

export interface OmkControlDecision {
	intent: OmkTurnIntent;
	risk: OmkTurnRisk;
	capabilities: OmkCapability[];
	readOnly: boolean;
	sandboxMode: "read-only" | "workspace-write";
	evidenceRequired: boolean;
	routeReason: string;
}

export interface OmkControlSurface {
	enabled: boolean;
	compactStatus: string;
	expandedStatus: string;
	onboarding: string;
	footerLabel: string;
}

export const OMK_CONTROL_DASHBOARD_MIN_WIDTH = 120;
export const OMK_CONTROL_DASHBOARD_WIDTH = 44;
export const OMK_CONTROL_DASHBOARD_GUTTER_WIDTH = 1;

const OMK_RUNTIME_NAMES = new Set(["omk"]);

export const OMK_CONTROL_BRAND_REVISION = `NIGHT-CITY-MATRIX · omk v${VERSION}`;
export const OMK_CONTROL_BRANDING_ASSET = "omk-control.webp";

const OMK_CONTROL_ASCII_LOGO = [
	"╔═ OMK://CONTROL ═══════════════════════════════════════ NEON GRID ONLINE ═╗",
	"║  ██████╗ ███╗   ███╗██╗  ██╗  //CONTROL                                ║",
	"║ ██╔═══██╗████╗ ████║██║ ██╔╝  OPEN MULTI-AGENT KIT                     ║",
	"║ ██║   ██║██╔████╔██║█████╔╝   CYBERPUNK OPS · MATRIX RUNTIME           ║",
	"║ ██║   ██║██║╚██╔╝██║██╔═██╗   ROUTE · VERIFY · LOOP · CONTROL          ║",
	"║ ╚██████╔╝██║ ╚═╝ ██║██║  ██╗  SKILLS · HOOKS · MCP · SUBAGENT GRID     ║",
	"╚═ evidence gated · viewport locked · metrics wall online · BCLP stable ═╝",
] as const;
const OMK_CONTROL_MATRIX_RAIN = [
	"MATRIX RAIN ▸ 0 1 0 1  ROUTE  1 0 0  VERIFY  0 1  LOOP  1 1  CONTROL  0 1",
	"AGENT GRID  ▸  planner:active  coder:active  reviewer:queued  qa:armed",
	"DAG RUNTIME ▸  MCP-native routing  evidence-gated tools  observable runs",
] as const;

const OMK_CONTROL_FEATURE_STRIP = [
	"ROUTE    Intelligent agent routing & orchestration",
	"VERIFY   Evidence-first execution and checks",
	"LOOP     Stable loops via BCLP policy",
	"CONTROL  Safe observable recoverable runs",
] as const;

const INTENT_PATTERNS: ReadonlyArray<readonly [OmkTurnIntent, RegExp]> = [
	["debugging", /debug|fix|error|failure|bug|trace/],
	["review", /review|audit|check|validate|verify/],
	["test-generation", /test|spec|coverage|assertion/],
	["refactor", /refactor|optimize|clean|improve|simplify/],
	["research", /research|investigate|explore|search|discover|analy[sz]e/],
	["planning", /plan|design|architect|strategy|roadmap/],
	["documentation", /doc|readme|changelog|comment/],
	["shell-operation", /shell|command|run|exec|script/],
];

export function isOmkRuntimeName(name: string | undefined): boolean {
	if (!name) return false;
	return OMK_RUNTIME_NAMES.has(name.trim().toLowerCase());
}

export function classifyOmkTurnIntent(input: string, role?: string): OmkTurnIntent {
	const text = `${role ?? ""} ${input}`.toLowerCase();
	for (const [intent, pattern] of INTENT_PATTERNS) {
		if (pattern.test(text)) return intent;
	}
	return "coding";
}

export function inferOmkTurnRisk(input: string): OmkTurnRisk {
	const text = input.toLowerCase();
	if (/\b(merge|rebase|cherry-pick|conflict|worktree|upstream)\b/.test(text)) return "merge";
	if (/\b(shell|command|exec|script|npm|node|git|build|test|install)\b/.test(text)) return "shell";
	if (/\b(write|edit|patch|change|modify|delete|rename|create|apply|implement)\b/.test(text)) return "write";
	return "read";
}

export function buildOmkControlDecision(input: string, role?: string): OmkControlDecision {
	const intent = classifyOmkTurnIntent(input, role);
	const risk = inferOmkTurnRisk(input);
	const capabilities = capabilitiesForRisk(risk);
	const readOnly = risk === "read";
	const sandboxMode = readOnly ? "read-only" : "workspace-write";
	const evidenceRequired = !readOnly || intent === "review" || intent === "test-generation";
	const routeReason = [
		`intent=${intent}`,
		`risk=${risk}`,
		`capabilities=${capabilities.join("+")}`,
		`evidence=${evidenceRequired ? "required" : "optional"}`,
	].join("; ");

	return {
		intent,
		risk,
		capabilities,
		readOnly,
		sandboxMode,
		evidenceRequired,
		routeReason,
	};
}

export function buildOmkControlAsciiLogo(): readonly string[] {
	return OMK_CONTROL_ASCII_LOGO;
}

export function buildOmkControlMatrixRain(): readonly string[] {
	return OMK_CONTROL_MATRIX_RAIN;
}

export function buildOmkControlFeatureStrip(): readonly string[] {
	return OMK_CONTROL_FEATURE_STRIP;
}

export function buildOmkControlSurface(input = "interactive OMK control startup"): OmkControlSurface {
	const decision = buildOmkControlDecision(input, "coordinator");
	const controlWords = "route/verify/loop/control";
	return {
		enabled: true,
		compactStatus: `OMK//CONTROL ${decision.risk.toUpperCase()} ${controlWords}`,
		expandedStatus: `OMK//CONTROL: ${decision.routeReason}`,
		onboarding:
			"OMK is the operator control plane: route tasks, assign evidence, and keep orchestration loops observable.",
		footerLabel: `OMK//CONTROL ${decision.intent} • ${decision.risk}`,
	};
}

export interface OmkCompactListOptions {
	sort?: boolean;
	maxItems?: number;
	showCount?: boolean;
}

export function summarizeOmkLoadedResources(items: string[], options: OmkCompactListOptions = {}): string {
	const labels = items.map((item) => item.trim()).filter((item) => item.length > 0);
	if (options.sort !== false) {
		labels.sort((a, b) => a.localeCompare(b));
	}
	if (labels.length === 0) {
		return "none";
	}
	const maxItems = options.maxItems ?? 4;
	const shown = labels.slice(0, maxItems);
	const remaining = labels.length - shown.length;
	const countPrefix = options.showCount === false ? "" : `${labels.length} loaded · `;
	return `${countPrefix}${shown.join(", ")}${remaining > 0 ? `, +${remaining} more` : ""}`;
}
export function truncateOmkExpandedResourceBody(body: string, maxLines = 8): string {
	const lines = body
		.split("\n")
		.map((line) => line.trimEnd())
		.filter((line) => line.length > 0);
	if (lines.length <= maxLines) {
		return lines.join("\n");
	}
	return `${lines.slice(0, maxLines).join("\n")}\n  … ${lines.length - maxLines} more entries`;
}

const OMK_ENV_TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const OMK_ENV_FALSE_VALUES = new Set(["0", "false", "no", "off"]);

function normalizeOmkEnvValue(value: string | undefined): string | undefined {
	const normalized = value?.trim().toLowerCase();
	return normalized ? normalized : undefined;
}

export function isOmkEnvFlagEnabled(value: string | undefined): boolean {
	const normalized = normalizeOmkEnvValue(value);
	return normalized !== undefined && OMK_ENV_TRUE_VALUES.has(normalized);
}

export function isOmkEnvFlagDisabled(value: string | undefined): boolean {
	const normalized = normalizeOmkEnvValue(value);
	return normalized !== undefined && OMK_ENV_FALSE_VALUES.has(normalized);
}

export interface OmkTuiEnvironmentDecision {
	fullscreenEnabled: boolean;
	tmuxAltScreenAutoEnabled: boolean;
	disabledReason?: string;
}

export function resolveOmkTuiEnvironment(options: {
	fullscreen?: string;
	noAltScreen?: string;
	tmuxAltScreenAuto?: string;
}): OmkTuiEnvironmentDecision {
	const tmuxAltScreenAutoEnabled = !isOmkEnvFlagDisabled(options.tmuxAltScreenAuto);
	if (isOmkEnvFlagEnabled(options.noAltScreen)) {
		return {
			fullscreenEnabled: false,
			tmuxAltScreenAutoEnabled,
			disabledReason: "OMK_NO_ALT_SCREEN",
		};
	}
	if (isOmkEnvFlagDisabled(options.fullscreen)) {
		return {
			fullscreenEnabled: false,
			tmuxAltScreenAutoEnabled,
			disabledReason: "OMK_FULLSCREEN=0",
		};
	}
	return {
		fullscreenEnabled: true,
		tmuxAltScreenAutoEnabled,
	};
}

export interface OmkTuiDoctorReport {
	terminal: string;
	tmux: boolean;
	tmuxAlternateScreen: string;
	fullscreen: string;
	sidebar: string;
	diagnostics: string;
	envOverrides?: string[];
}

export function formatOmkTuiDoctorReport(report: OmkTuiDoctorReport): string {
	const lines = [
		"TUI",
		`  terminal: ${report.terminal}`,
		`  tmux: ${report.tmux ? "yes" : "no"}`,
		`  tmux alternate-screen: ${report.tmuxAlternateScreen}`,
		`  fullscreen: ${report.fullscreen}`,
		`  sidebar: ${report.sidebar}`,
		`  diagnostics: ${report.diagnostics}`,
	];
	if (report.envOverrides && report.envOverrides.length > 0) {
		lines.push(`  env: ${report.envOverrides.join(", ")}`);
	}
	return lines.join("\n");
}

function capabilitiesForRisk(risk: OmkTurnRisk): OmkCapability[] {
	switch (risk) {
		case "read":
			return ["read"];
		case "write":
			return ["write", "patch"];
		case "merge":
			return ["write", "patch", "shell", "merge"];
		case "shell":
			return ["write", "patch", "shell"];
	}
}
