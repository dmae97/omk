export type OmkCoreIntent =
	| "research"
	| "planning"
	| "coding"
	| "debugging"
	| "refactor"
	| "review"
	| "test-generation"
	| "documentation"
	| "shell-operation";

export type OmkCoreRisk = "read" | "write" | "shell" | "merge";

export type OmkCoreCapability = "read" | "write" | "patch" | "shell" | "merge" | "review";

export interface OmkCoreTask {
	id?: string;
	role?: string;
	goal: string;
	prompt: string;
}

export interface OmkCoreRuntime {
	id: string;
	priority?: number;
	capabilities: Partial<Record<OmkCoreCapability, boolean>>;
}

export interface OmkRouteDecision {
	intent: OmkCoreIntent;
	risk: OmkCoreRisk;
	capabilities: OmkCoreCapability[];
	readOnly: boolean;
	sandboxMode: "read-only" | "workspace-write";
	evidenceRequired: boolean;
	selectedRuntime?: string;
	fallbackChain: string[];
	reason: string;
}

export interface OmkEvidenceRecord {
	kind: "command" | "artifact" | "review" | "metric";
	passed: boolean;
	summary: string;
}

export interface OmkEvidenceGateResult {
	passed: boolean;
	required: boolean;
	reason: string;
	acceptedEvidence: OmkEvidenceRecord[];
}

export interface OmkLoopResult {
	route: OmkRouteDecision;
	evidenceGate: OmkEvidenceGateResult;
	control: OmkControlSnapshot;
}

export interface OmkControlSnapshot {
	label: string;
	phase: "route" | "verify" | "loop" | "control";
	status: "ready" | "blocked";
	summary: string;
}

const INTENT_PATTERNS: ReadonlyArray<readonly [OmkCoreIntent, RegExp]> = [
	["debugging", /debug|fix|error|failure|bug|trace/],
	["review", /review|audit|check|validate|verify/],
	["test-generation", /test|spec|coverage|assertion/],
	["refactor", /refactor|optimize|clean|improve|simplify/],
	["research", /research|investigate|explore|search|discover|analy[sz]e/],
	["planning", /plan|design|architect|strategy|roadmap/],
	["documentation", /doc|readme|changelog|comment/],
	["shell-operation", /shell|command|run|exec|script/],
];

export function createOmkCoreBridge() {
	return {
		routeTask: routeOmkTask,
		verifyEvidenceGate: verifyOmkEvidenceGate,
		runLoop: runOmkLoop,
		summarizeControl: summarizeOmkControl,
	};
}

export function routeOmkTask(task: OmkCoreTask, runtimes: OmkCoreRuntime[] = []): OmkRouteDecision {
	const text = `${task.role ?? ""} ${task.goal} ${task.prompt}`;
	const intent = classifyOmkCoreIntent(text);
	const risk = inferOmkCoreRisk(text);
	const capabilities = capabilitiesForRisk(risk);
	const readOnly = risk === "read";
	const sandboxMode = readOnly ? "read-only" : "workspace-write";
	const evidenceRequired = !readOnly || intent === "review" || intent === "test-generation";
	const candidates = runtimes
		.filter((runtime) => runtimeSupports(runtime, capabilities))
		.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
	const selectedRuntime = candidates[0]?.id;
	const fallbackChain = candidates.map((runtime) => runtime.id);
	const reason = [
		`intent=${intent}`,
		`risk=${risk}`,
		`capabilities=${capabilities.join("+")}`,
		selectedRuntime ? `runtime=${selectedRuntime}` : "runtime=unassigned",
	].join("; ");

	return {
		intent,
		risk,
		capabilities,
		readOnly,
		sandboxMode,
		evidenceRequired,
		selectedRuntime,
		fallbackChain,
		reason,
	};
}

export function verifyOmkEvidenceGate(
	decision: OmkRouteDecision,
	evidence: OmkEvidenceRecord[] = [],
): OmkEvidenceGateResult {
	const acceptedEvidence = evidence.filter((record) => record.passed);
	if (!decision.evidenceRequired) {
		return {
			passed: true,
			required: false,
			reason: "Evidence optional for read-only route.",
			acceptedEvidence,
		};
	}
	if (acceptedEvidence.length === 0) {
		return {
			passed: false,
			required: true,
			reason: "Evidence is required before the OMK loop can mark this route complete.",
			acceptedEvidence,
		};
	}
	return {
		passed: true,
		required: true,
		reason: `Accepted ${acceptedEvidence.length} evidence record(s).`,
		acceptedEvidence,
	};
}

export function runOmkLoop(
	task: OmkCoreTask,
	runtimes: OmkCoreRuntime[] = [],
	evidence: OmkEvidenceRecord[] = [],
): OmkLoopResult {
	const route = routeOmkTask(task, runtimes);
	const evidenceGate = verifyOmkEvidenceGate(route, evidence);
	const control = summarizeOmkControl(route, evidenceGate);
	return { route, evidenceGate, control };
}

export function summarizeOmkControl(
	decision: OmkRouteDecision,
	evidenceGate: OmkEvidenceGateResult,
): OmkControlSnapshot {
	const status = evidenceGate.passed ? "ready" : "blocked";
	const phase = evidenceGate.passed ? "control" : "verify";
	return {
		label: "OMK://CONTROL",
		phase,
		status,
		summary: `${decision.intent}/${decision.risk} ${status}: ${evidenceGate.reason}`,
	};
}

function classifyOmkCoreIntent(text: string): OmkCoreIntent {
	const normalized = text.toLowerCase();
	for (const [intent, pattern] of INTENT_PATTERNS) {
		if (pattern.test(normalized)) return intent;
	}
	return "coding";
}

function inferOmkCoreRisk(text: string): OmkCoreRisk {
	const normalized = text.toLowerCase();
	if (/\b(merge|rebase|cherry-pick|conflict|worktree|upstream)\b/.test(normalized)) return "merge";
	if (/\b(shell|command|exec|script|npm|node|git|build|test|install)\b/.test(normalized)) return "shell";
	if (/\b(write|edit|patch|change|modify|delete|rename|create|apply|implement)\b/.test(normalized)) return "write";
	return "read";
}

function capabilitiesForRisk(risk: OmkCoreRisk): OmkCoreCapability[] {
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

function runtimeSupports(runtime: OmkCoreRuntime, capabilities: OmkCoreCapability[]): boolean {
	return capabilities.every((capability) => runtime.capabilities[capability] === true);
}
