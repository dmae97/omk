export type OmkRequestIntent =
	| "status"
	| "resume"
	| "memory_query"
	| "repo_read"
	| "code_edit"
	| "debug_error"
	| "web_research"
	| "plan"
	| "chat"
	| "unknown";

export type OmkDebloatRisk = "read" | "write" | "network" | "dangerous";
export type OmkDebloatSandbox = "read-only" | "workspace-write" | "full-access";
export type OmkFailurePolicy = "required-only" | "strict";
export type OmkProviderRuntimeMode = "provider-event" | "provider-print";

export interface OmkRawPromptEnvelope {
	rawText: string;
	provider?: string;
	model?: string;
	userPayload?: string;
	risk?: OmkDebloatRisk;
	sandbox?: OmkDebloatSandbox;
	executionSelection?: string;
	role?: OmkSignalFrame["role"];
	evidenceRequired?: boolean;
	capabilityEnvelope?: {
		mcpEnabled: readonly string[];
		skillsEnabled: readonly string[];
		hooksEnabled?: readonly string[];
		toolsEnabled: boolean;
		liveRequired: boolean;
	};
	runtimeStatus?: {
		failedMcpServers: readonly string[];
		connectedMcpServers: readonly string[];
	};
}

export interface OmkSignalFrame {
	userRequest: string;
	provider: string;
	model: string;
	risk: OmkDebloatRisk;
	sandbox: OmkDebloatSandbox;
	executionSelection?: string;
	role: "coordinator" | "planner" | "executor" | "reviewer";
	evidenceRequired: boolean;
	availableMcp: readonly string[];
	connectedMcp: readonly string[];
	availableSkills: readonly string[];
	availableHooks: readonly string[];
	failedMcp: readonly string[];
}

export interface OmkCapabilitySelection {
	requiredMcp: readonly string[];
	optionalMcp: readonly string[];
	selectedSkills: readonly string[];
	selectedHooks: readonly string[];
	connectedMcp: readonly string[];
	disconnectedMcp: readonly string[];
	disabledMcp: readonly string[];
	persona: string;
}

export interface OmkRuntimeSidecar {
	provider: string;
	model: string;
	intent: OmkRequestIntent;
	risk: OmkDebloatRisk;
	sandbox: OmkDebloatSandbox;
	requiredMcp: readonly string[];
	optionalMcp: readonly string[];
	connectedMcp: readonly string[];
	disconnectedMcp: readonly string[];
	disabledMcp: readonly string[];
	selectedSkills: readonly string[];
	selectedHooks: readonly string[];
	persona: string;
	failurePolicy: OmkFailurePolicy;
}

export interface OmkDebloatDiagnostics {
	originalChars: number;
	finalChars: number;
	compressionRatio: number;
	removedSections: readonly string[];
	warnings: readonly string[];
}

export interface OmkDebloatedCompileResult {
	modelPrompt: string;
	runtimeSidecar: OmkRuntimeSidecar;
	diagnostics: OmkDebloatDiagnostics;
}

interface FailureResolution {
	failurePolicy: "required-only";
	blockers: readonly string[];
	warnings: readonly string[];
}

export function compileOmkBloatToNlp(envelope: OmkRawPromptEnvelope): OmkDebloatedCompileResult {
	const signal = extractOmkSignalFrame(envelope);
	const intent = classifyOmkRequestIntent(signal.userRequest);
	const selection = selectOmkCapabilities({
		intent,
		role: signal.role,
		availableMcp: signal.availableMcp,
		connectedMcp: signal.connectedMcp,
		availableSkills: signal.availableSkills,
		availableHooks: signal.availableHooks,
		failedMcp: signal.failedMcp,
	});
	const failure = resolveOmkFailurePolicy({
		requiredMcp: selection.requiredMcp,
		failedMcp: signal.failedMcp,
		disconnectedMcp: selection.disconnectedMcp,
	});
	const runtimeSidecar = buildRuntimeSidecar(signal, intent, selection);
	const modelPrompt =
		failure.blockers.length > 0
			? renderOmkBlockerPrompt({ signal, intent, blockers: failure.blockers, persona: selection.persona })
			: renderOmkNlpPrompt({ signal, intent, selection, warnings: failure.warnings });
	const diagnostics = validateOmkDebloatedPrompt({
		originalText: envelope.rawText,
		modelPrompt,
		selection,
		signal,
	});

	return {
		modelPrompt,
		runtimeSidecar,
		diagnostics: {
			...diagnostics,
			warnings: unique([...diagnostics.warnings, ...failure.warnings]),
		},
	};
}

export function extractOmkSignalFrame(envelope: OmkRawPromptEnvelope): OmkSignalFrame {
	const rawText = envelope.rawText;
	const userRequest = normalizePromptText(envelope.userPayload ?? parseUserPayload(rawText));
	const intent = classifyOmkRequestIntent(userRequest);
	return {
		userRequest,
		provider:
			envelope.provider ??
			parseLineValue(rawText, "Selected provider") ??
			parseLineValue(rawText, "Provider") ??
			"auto",
		model: envelope.model ?? parseLineValue(rawText, "Selected model") ?? parseLineValue(rawText, "Model") ?? "auto",
		risk:
			envelope.risk ?? normalizeRisk(parseLineValue(rawText, "Turn risk")) ?? classifyOmkRisk(intent, userRequest),
		sandbox: envelope.sandbox ?? normalizeSandbox(parseLineValue(rawText, "Sandbox")),
		executionSelection: envelope.executionSelection ?? parseLineValue(rawText, "Execution selection"),
		role: envelope.role ?? normalizeRole(parseLineValue(rawText, "Role")),
		evidenceRequired: envelope.evidenceRequired ?? /Evidence required:\s*true/i.test(rawText),
		availableMcp: unique([
			...(envelope.capabilityEnvelope?.mcpEnabled ?? []),
			...parseCapabilityList(rawText, "MCP"),
			...parseCapabilityList(rawText, "MCP selected"),
		]),
		connectedMcp: unique([
			...(envelope.runtimeStatus?.connectedMcpServers ?? []),
			...parseCapabilityList(rawText, "Connected MCP"),
			...parseCapabilityList(rawText, "MCP connected"),
			...parseConnectedMcp(rawText),
		]),
		availableSkills: unique([
			...(envelope.capabilityEnvelope?.skillsEnabled ?? []),
			...parseCapabilityList(rawText, "Skills"),
			...parseCapabilityList(rawText, "Skills selected"),
		]),
		availableHooks: unique([
			...(envelope.capabilityEnvelope?.hooksEnabled ?? []),
			...parseCapabilityList(rawText, "Hooks"),
			...parseCapabilityList(rawText, "Hooks selected"),
		]),
		failedMcp: unique(envelope.runtimeStatus?.failedMcpServers ?? parseFailedMcp(rawText)),
	};
}

export function classifyOmkRequestIntent(userRequest: string): OmkRequestIntent {
	const text = userRequest.trim().toLowerCase();
	if (/현재\s*상태|상태|status|progress|어때|어디까지|뭐\s*했|진행/.test(text)) return "status";
	if (/이어|resume|계속|이전|마지막|left off|where we left/.test(text)) return "resume";
	if (/기억|memory|remember|잊어|forget|전에/.test(text)) return "memory_query";
	if (/검색|웹|최신|news|github|x에서|찾아봐/.test(text)) return "web_research";
	if (/파일|읽어|구조|repo|repository|코드베이스|찾아/.test(text)) return "repo_read";
	if (/debug|디버그|에러|오류|실패|깨져|터졌/.test(text)) return "debug_error";
	if (/수정|고쳐|구현|패치|edit|fix|implement|refactor/.test(text)) return "code_edit";
	if (/계획|설계|plan|architecture|알고리즘/.test(text)) return "plan";
	return "chat";
}

export function classifyOmkRisk(intent: OmkRequestIntent, userRequest: string): OmkDebloatRisk {
	if (/\brm\s+-rf\b|\bDROP\s+TABLE\b|\bgit\s+push\s+--force\b|\bsudo\b/i.test(userRequest)) return "dangerous";
	if (/\bcurl\b|\bwget\b|\bfetch\b|\bhttp/i.test(userRequest)) return "network";
	if (/\b(edit|fix|implement|refactor|modify|update|create|write|delete|remove)\b/i.test(userRequest)) return "write";
	if (/\b(read|show|list|find|search|grep|cat|ls|status|check)\b/i.test(userRequest)) return "read";
	if (intent === "code_edit" || intent === "debug_error") return "write";
	if (intent === "web_research") return "network";
	if (intent === "repo_read" || intent === "status") return "read";
	return "read";
}

export function selectOmkCapabilities(input: {
	intent: OmkRequestIntent;
	role: OmkSignalFrame["role"];
	availableMcp: readonly string[];
	connectedMcp: readonly string[];
	availableSkills: readonly string[];
	availableHooks: readonly string[];
	failedMcp: readonly string[];
}): OmkCapabilitySelection {
	const connectedMcp = new Set(input.connectedMcp);
	const availableMcp = new Set(input.availableMcp);
	const failedMcp = new Set(input.failedMcp);
	const usableMcp =
		connectedMcp.size > 0
			? new Set([...connectedMcp].filter((name) => !failedMcp.has(name)))
			: new Set([...availableMcp].filter((name) => !failedMcp.has(name)));
	const disconnectedMcp = [...availableMcp].filter((name) => !failedMcp.has(name) && !usableMcp.has(name));
	const selectedSkills = (...patterns: string[]): string[] => matchNamedCapabilities(input.availableSkills, patterns);
	const selectedHooks = (...patterns: string[]): string[] => matchNamedCapabilities(input.availableHooks, patterns);
	const optionalMcp = (...names: string[]): string[] => names.filter((name) => usableMcp.has(name));
	const requiredIfAvailable = (...names: string[]): string[] => {
		const found = names.find((name) => usableMcp.has(name));
		return found ? [found] : [];
	};
	const persona = describeOmkPersona(input.role, input.intent);

	switch (input.intent) {
		case "status":
			return {
				requiredMcp: [],
				optionalMcp: optionalMcp("omk-project", "memory"),
				connectedMcp: [...usableMcp].filter((name) => ["omk-project", "memory"].includes(name)),
				disconnectedMcp,
				selectedSkills: selectedSkills("context-broker", "project-rules", "status"),
				selectedHooks: selectedHooks("session-context", "stop-verify"),
				disabledMcp: input.failedMcp,
				persona,
			};
		case "resume":
			return {
				requiredMcp: [],
				optionalMcp: optionalMcp("omk-project", "memory", "sqlite"),
				connectedMcp: [...usableMcp].filter((name) => ["omk-project", "memory", "sqlite"].includes(name)),
				disconnectedMcp,
				selectedSkills: selectedSkills("agentmemory", "context-broker", "project-rules", "resume"),
				selectedHooks: selectedHooks("session-context", "precompact-checkpoint"),
				disabledMcp: input.failedMcp,
				persona,
			};
		case "repo_read":
			return {
				requiredMcp: requiredIfAvailable("filesystem-readonly", "filesystem"),
				optionalMcp: optionalMcp("omk-project", "memory"),
				connectedMcp: [...usableMcp].filter((name) =>
					["filesystem-readonly", "filesystem", "omk-project", "memory"].includes(name),
				),
				disconnectedMcp,
				selectedSkills: selectedSkills("repo-explorer", "context-broker", "project-rules"),
				selectedHooks: selectedHooks("protect-secrets", "session-context"),
				disabledMcp: input.failedMcp,
				persona,
			};
		case "code_edit":
			return {
				requiredMcp: requiredIfAvailable("filesystem"),
				optionalMcp: optionalMcp("omk-project", "memory", "sqlite"),
				connectedMcp: [...usableMcp].filter((name) =>
					["filesystem", "omk-project", "memory", "sqlite"].includes(name),
				),
				disconnectedMcp,
				selectedSkills: selectedSkills(
					"feature-dev",
					"typescript-strict",
					"quality-gate",
					"test-debug",
					"code-review",
				),
				selectedHooks: selectedHooks("pre-shell-guard", "protect-secrets", "post-format", "typecheck-after-edit"),
				disabledMcp: input.failedMcp,
				persona,
			};
		case "debug_error":
			return {
				requiredMcp: requiredIfAvailable("filesystem"),
				optionalMcp: optionalMcp("omk-project", "memory"),
				connectedMcp: [...usableMcp].filter((name) => ["filesystem", "omk-project", "memory"].includes(name)),
				disconnectedMcp,
				selectedSkills: selectedSkills("troubleshooting", "test-debug", "quality-gate", "context-broker"),
				selectedHooks: selectedHooks("pre-shell-guard", "protect-secrets", "stop-verify"),
				disabledMcp: input.failedMcp,
				persona,
			};
		case "web_research":
			return {
				requiredMcp: requiredIfAvailable("fetch"),
				optionalMcp: optionalMcp("web-reader", "playwright", "omk-project"),
				connectedMcp: [...usableMcp].filter((name) =>
					["fetch", "web-reader", "playwright", "omk-project"].includes(name),
				),
				disconnectedMcp,
				selectedSkills: selectedSkills("research-verify", "context-broker"),
				selectedHooks: selectedHooks("protect-secrets"),
				disabledMcp: input.failedMcp,
				persona,
			};
		case "plan":
			return {
				requiredMcp: [],
				optionalMcp: optionalMcp("omk-project", "memory"),
				connectedMcp: [...usableMcp].filter((name) => ["omk-project", "memory"].includes(name)),
				disconnectedMcp,
				selectedSkills: selectedSkills("plan-first", "context-broker", "project-rules", "task-router"),
				selectedHooks: selectedHooks("session-context", "precompact-checkpoint"),
				disabledMcp: input.failedMcp,
				persona,
			};
		default:
			return {
				requiredMcp: [],
				optionalMcp: optionalMcp("omk-project", "memory"),
				connectedMcp: [...usableMcp].filter((name) => ["omk-project", "memory"].includes(name)),
				disconnectedMcp,
				selectedSkills: selectedSkills("context-broker"),
				selectedHooks: selectedHooks("session-context"),
				disabledMcp: input.failedMcp,
				persona,
			};
	}
}

export function resolveOmkFailurePolicy(input: {
	requiredMcp: readonly string[];
	failedMcp: readonly string[];
	disconnectedMcp: readonly string[];
}): FailureResolution {
	const required = new Set(input.requiredMcp);
	const blockers = unique([...input.failedMcp, ...input.disconnectedMcp].filter((name) => required.has(name)));
	const warnings = unique([...input.failedMcp, ...input.disconnectedMcp].filter((name) => !required.has(name)));
	return { failurePolicy: "required-only", blockers, warnings };
}

export function renderOmkNlpPrompt(input: {
	signal: OmkSignalFrame;
	intent: OmkRequestIntent;
	selection: OmkCapabilitySelection;
	warnings: readonly string[];
}): string {
	const lines = [
		"You are the OMK root coordinator.",
		"",
		`User request: ${JSON.stringify(input.signal.userRequest)}`,
		"",
		`Intent: ${input.intent}`,
		`Role: ${input.signal.role}`,
		`Persona: ${input.selection.persona}`,
		`Provider: ${input.signal.provider}`,
		`Model: ${input.signal.model}`,
		`Risk: ${input.signal.risk}`,
		`Sandbox: ${input.signal.sandbox}`,
		...(input.signal.executionSelection ? [`Execution selection: ${input.signal.executionSelection}`] : []),
		"",
		`Required MCP: ${formatList(input.selection.requiredMcp)}`,
	];
	if (input.selection.optionalMcp.length > 0) lines.push(`Optional MCP: ${input.selection.optionalMcp.join(", ")}`);
	if (input.selection.connectedMcp.length > 0) lines.push(`Connected MCP: ${input.selection.connectedMcp.join(", ")}`);
	if (input.selection.disconnectedMcp.length > 0)
		lines.push(`Disconnected MCP: ${input.selection.disconnectedMcp.join(", ")}`);
	if (input.selection.selectedSkills.length > 0)
		lines.push(`Selected skills: ${input.selection.selectedSkills.join(", ")}`);
	if (input.selection.selectedHooks.length > 0)
		lines.push(`Selected hooks: ${input.selection.selectedHooks.join(", ")}`);
	if (input.warnings.length > 0) {
		lines.push("", `Warnings: ${input.warnings.join(", ")} unavailable or disconnected; continue unless required.`);
	}
	lines.push(
		"",
		"Instructions:",
		`- ${renderPersonaDirective(input.signal.role, input.intent)}`,
		"- Answer the user request directly.",
		"- Do not activate unrelated capabilities, skills, or hooks.",
		"- Treat optional capability failures as warnings.",
		"- If project state is unavailable, say so briefly.",
		"- Keep the answer concise and operational.",
	);
	return clampPrompt(lines.join("\n"), getOmkPromptBudget(input.intent));
}

export function renderOmkBlockerPrompt(input: {
	signal: OmkSignalFrame;
	intent: OmkRequestIntent;
	blockers: readonly string[];
	persona: string;
}): string {
	return [
		"You are the OMK root coordinator.",
		"",
		`User request: ${JSON.stringify(input.signal.userRequest)}`,
		`Intent: ${input.intent}`,
		`Role: ${input.signal.role}`,
		`Persona: ${input.persona}`,
		"",
		`Required capability unavailable or not connected: ${input.blockers.join(", ")}`,
		"Report this blocker briefly, state the missing DAG resources, and do not claim completion.",
	].join("\n");
}

export function validateOmkDebloatedPrompt(input: {
	originalText: string;
	modelPrompt: string;
	selection: OmkCapabilitySelection;
	signal: OmkSignalFrame;
}): OmkDebloatDiagnostics {
	const warnings: string[] = [];
	if (/MUST activate/i.test(input.modelPrompt)) warnings.push("Model prompt still contains MUST activate.");
	if (/MUST use/i.test(input.modelPrompt)) warnings.push("Model prompt still contains MUST use.");
	if (/TurnBegin\(/.test(input.modelPrompt)) warnings.push("Model prompt still contains raw TurnBegin telemetry.");
	if (/StatusUpdate\(/.test(input.modelPrompt))
		warnings.push("Model prompt still contains raw StatusUpdate telemetry.");
	const allAvailableLeaked =
		input.signal.availableMcp.length > 8 &&
		input.signal.availableMcp.every((name) => input.modelPrompt.includes(name));
	if (allAvailableLeaked) warnings.push("All available MCP names leaked into model prompt.");
	if (countOccurrences(input.modelPrompt, input.signal.userRequest) > 1)
		warnings.push("User payload appears more than once.");
	const originalChars = input.originalText.length;
	const finalChars = input.modelPrompt.length;
	return {
		originalChars,
		finalChars,
		compressionRatio: finalChars / Math.max(originalChars, 1),
		removedSections: [
			"raw telemetry",
			"full capability inventory",
			"duplicated TurnBegin",
			"mandatory all capability directives",
		],
		warnings,
	};
}

export function getOmkPromptBudget(intent: OmkRequestIntent): number {
	switch (intent) {
		case "status":
			return 900;
		case "resume":
			return 1_500;
		case "memory_query":
			return 1_800;
		case "repo_read":
			return 2_400;
		case "code_edit":
			return 3_500;
		case "web_research":
			return 2_800;
		case "debug_error":
			return 3_000;
		default:
			return 1_200;
	}
}

export function filterOmkMcpConfigForRuntime(input: {
	allMcpConfig: Record<string, unknown>;
	sidecar: OmkRuntimeSidecar;
}): { mcpServers: Record<string, unknown> } {
	const allowed = new Set([...input.sidecar.requiredMcp, ...input.sidecar.optionalMcp]);
	const disabled = new Set(input.sidecar.disabledMcp);
	return {
		mcpServers: Object.fromEntries(
			Object.entries(input.allMcpConfig).filter(([name]) => allowed.has(name) && !disabled.has(name)),
		),
	};
}

export function filterOmkMcpConfigForTurn(input: {
	userMcpConfig: Record<string, unknown>;
	projectMcpConfig: Record<string, unknown>;
	sidecar: OmkRuntimeSidecar;
}): { mcpServers: Record<string, unknown> } {
	const merged: Record<string, unknown> = { ...input.projectMcpConfig, ...input.userMcpConfig };
	const allowed = new Set([...input.sidecar.requiredMcp, ...input.sidecar.optionalMcp]);
	const disabled = new Set(input.sidecar.disabledMcp);
	return {
		mcpServers: Object.fromEntries(
			Object.entries(merged).filter(([name]) => allowed.has(name) && !disabled.has(name)),
		),
	};
}

export function selectOmkProviderRuntime(input: {
	provider: string;
	intent: OmkRequestIntent;
	debugRaw?: boolean;
}): OmkProviderRuntimeMode {
	if (input.debugRaw === true) return "provider-print";
	return "provider-event";
}

export function renderOmkUserFacingRoutingNlp(input: {
	intent: OmkRequestIntent;
	role?: OmkSignalFrame["role"];
	selected: OmkCapabilitySelection;
	ignoredMcpCount: number;
}): string {
	const lines = ["OMK routing", "", `Intent: ${input.intent}`];
	if (input.role) lines.push(`Role: ${input.role}`);
	lines.push("", `Required MCP: ${formatList(input.selected.requiredMcp)}`);
	if (input.selected.optionalMcp.length > 0) lines.push(`Optional MCP: ${input.selected.optionalMcp.join(", ")}`);
	if (input.selected.connectedMcp.length > 0) lines.push(`Connected MCP: ${input.selected.connectedMcp.join(", ")}`);
	if (input.selected.disconnectedMcp.length > 0)
		lines.push(`Disconnected MCP: ${input.selected.disconnectedMcp.join(", ")}`);
	if (input.selected.selectedSkills.length > 0)
		lines.push(`Selected skills: ${input.selected.selectedSkills.join(", ")}`);
	if (input.selected.selectedHooks.length > 0)
		lines.push(`Selected hooks: ${input.selected.selectedHooks.join(", ")}`);
	lines.push(`Persona: ${input.selected.persona}`);
	lines.push(`Ignored MCP servers: ${input.ignoredMcpCount}`);
	if (input.selected.disabledMcp.length > 0) {
		lines.push(`Warning: ${input.selected.disabledMcp.join(", ")} unavailable and ignored unless required.`);
	}
	return lines.join("\n");
}

function buildRuntimeSidecar(
	signal: OmkSignalFrame,
	intent: OmkRequestIntent,
	selection: OmkCapabilitySelection,
): OmkRuntimeSidecar {
	return {
		provider: signal.provider,
		model: signal.model,
		intent,
		risk: signal.risk,
		sandbox: signal.sandbox,
		requiredMcp: [...selection.requiredMcp],
		optionalMcp: [...selection.optionalMcp],
		connectedMcp: [...selection.connectedMcp],
		disconnectedMcp: [...selection.disconnectedMcp],
		disabledMcp: [...selection.disabledMcp],
		selectedSkills: [...selection.selectedSkills],
		selectedHooks: [...selection.selectedHooks],
		persona: selection.persona,
		failurePolicy: "required-only",
	};
}

function parseUserPayload(rawText: string): string {
	const jsonMatch = rawText.match(/Payload characters:\s*\d+\s*\n([\s\S]*?)(?:\n\n## |\n## |$)/);
	if (jsonMatch?.[1]) {
		try {
			const parsed = JSON.parse(jsonMatch[1].trim()) as unknown;
			if (typeof parsed === "string") return parsed;
		} catch {
			return jsonMatch[1].trim();
		}
	}
	const requestMatch = rawText.match(/User request:\s*("[\s\S]*?")/i);
	if (requestMatch?.[1]) {
		try {
			const parsed = JSON.parse(requestMatch[1]) as unknown;
			if (typeof parsed === "string") return parsed;
		} catch {
			return requestMatch[1];
		}
	}
	return rawText.trim();
}

function parseLineValue(rawText: string, key: string): string | undefined {
	const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = rawText.match(new RegExp(`^${escaped}:\\s*(.+)$`, "im"));
	return match?.[1]?.trim();
}

function parseCapabilityList(rawText: string, label: string): string[] {
	const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const regex = new RegExp(`^${escaped}[^\\[]*\\[([^\\]]*)\\]`, "im");
	const match = rawText.match(regex);
	if (!match?.[1]) return [];
	return match[1]
		.split(",")
		.map((name) => name.replace(/\+\d+\s+more/g, "").trim())
		.filter(Boolean);
}

function parseFailedMcp(rawText: string): string[] {
	const failed = new Set<string>();
	for (const match of rawText.matchAll(/['"]([a-zA-Z0-9_.-]+)['"]\s*:\s*McpError/g)) failed.add(match[1]);
	for (const match of rawText.matchAll(/([a-zA-Z0-9_.-]+)\s+status=failed/g)) failed.add(match[1]);
	return [...failed];
}

function parseConnectedMcp(rawText: string): string[] {
	const connected = new Set<string>();
	for (const match of rawText.matchAll(/([a-zA-Z0-9_.-]+)\s+status=connected/g)) connected.add(match[1]);
	return [...connected];
}

function describeOmkPersona(role: OmkSignalFrame["role"], intent: OmkRequestIntent): string {
	if (role === "planner") return `planner persona for ${intent}`;
	if (role === "executor") return `executor persona for ${intent}`;
	if (role === "reviewer") return `reviewer persona for ${intent}`;
	return `coordinator persona for ${intent}`;
}

function renderPersonaDirective(role: OmkSignalFrame["role"], intent: OmkRequestIntent): string {
	if (role === "planner")
		return `Decompose the ${intent} request into DAG-ready steps, selected skills, hooks, and MCP requirements.`;
	if (role === "executor")
		return `Execute the ${intent} request with explicit evidence, using only the selected skills, hooks, and connected MCP lanes.`;
	if (role === "reviewer")
		return `Review the ${intent} request for correctness, evidence, and remaining risk before acceptance.`;
	return `Coordinate the ${intent} request, assigning only the selected skills, hooks, and connected MCP lanes.`;
}

function matchNamedCapabilities(available: readonly string[], patterns: readonly string[]): string[] {
	const lowered = available.map((name) => ({ name, lower: name.toLowerCase() }));
	const matches: string[] = [];
	for (const pattern of patterns) {
		const wanted = pattern.toLowerCase();
		for (const candidate of lowered) {
			if (!candidate.lower.includes(wanted)) continue;
			if (matches.includes(candidate.name)) continue;
			matches.push(candidate.name);
			break;
		}
	}
	return matches;
}

function normalizeRisk(value: string | undefined): OmkDebloatRisk | undefined {
	const normalized = value?.toLowerCase();
	if (normalized === "network") return "network";
	if (normalized === "dangerous" || normalized === "shell" || normalized === "merge") return "dangerous";
	if (normalized === "write") return "write";
	if (normalized === "read") return "read";
	return undefined;
}

function normalizeSandbox(value: string | undefined): OmkDebloatSandbox {
	const normalized = value?.toLowerCase();
	if (normalized === "full-access") return "full-access";
	if (normalized === "workspace-write") return "workspace-write";
	return "read-only";
}

function normalizeRole(value: string | undefined): OmkSignalFrame["role"] {
	const normalized = value?.toLowerCase();
	if (normalized === "planner") return "planner";
	if (normalized === "executor" || normalized === "coder") return "executor";
	if (normalized === "reviewer") return "reviewer";
	return "coordinator";
}

function normalizePromptText(value: string): string {
	const normalized = value.replace(/\r\n?/g, "\n").trim();
	return normalized.length > 0 ? normalized : "(empty user request)";
}

function formatList(values: readonly string[]): string {
	return values.length > 0 ? values.join(", ") : "none";
}

function clampPrompt(prompt: string, budget: number): string {
	if (prompt.length <= budget) return prompt;
	return `${prompt.slice(0, Math.max(0, budget - 32)).trimEnd()}\n- Prompt truncated to budget.`;
}

function countOccurrences(text: string, needle: string): number {
	if (!needle) return 0;
	let count = 0;
	let index = text.indexOf(needle);
	while (index >= 0) {
		count += 1;
		index = text.indexOf(needle, index + needle.length);
	}
	return count;
}

function unique(values: readonly string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
