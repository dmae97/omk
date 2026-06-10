import type { OmkRequestIntent } from "./omk-runtime-sidecar.ts";

export interface OmkReasoningTrace {
	id: string;
	turnId: string;
	timestamp: string;
	userIntent: OmkTraceIntent;
	plan: OmkTracePlan;
	execution: OmkTraceExecution;
	evidence: OmkTraceEvidence;
	result: OmkTraceResult;
	privacy: OmkTracePrivacy;
}

export interface OmkTraceIntent {
	raw: string;
	classified: OmkRequestIntent;
	risk: string;
	confidence: number;
}

export interface OmkTracePlan {
	summary: string;
	steps: readonly string[];
	toolsSelected: readonly string[];
	mcpSelected: readonly string[];
	connectedMcp: readonly string[];
	disconnectedMcp: readonly string[];
	skillsSelected: readonly string[];
	hooksSelected: readonly string[];
}

export interface OmkTraceExecution {
	toolSequence: readonly OmkTraceToolCall[];
	decisionRecords: readonly OmkTraceDecision[];
	durationMs: number;
	retries: number;
}

export interface OmkTraceToolCall {
	name: string;
	args?: string;
	resultSummary: string;
	success: boolean;
	durationMs: number;
}

export interface OmkTraceDecision {
	point: string;
	chosen: string;
	alternatives: readonly string[];
	reason: string;
}

export interface OmkTraceEvidence {
	testResult?: OmkTraceTestResult;
	diffSummary?: string;
	filesChanged: readonly string[];
	commandsRun: readonly string[];
	screenshots: readonly string[];
}

export interface OmkTraceTestResult {
	passed: number;
	failed: number;
	skipped: number;
	duration: string;
	failures: readonly string[];
}

export interface OmkTraceResult {
	status: "success" | "partial" | "failed" | "blocked";
	summary: string;
	failureReason?: string;
	acceptReject: "accept" | "reject" | "pending";
	confidence: number;
}

export interface OmkTracePrivacy {
	level: "l0" | "l1" | "l2" | "l3";
	redacted: boolean;
	includedInDataset: boolean;
	consentGiven: boolean;
	redactionRules: readonly string[];
}

export interface OmkTraceSummary {
	intent: string;
	planSummary: string;
	toolsUsed: readonly string[];
	testResult?: string;
	outcome: string;
	duration: string;
	confidence: number;
}

export interface OmkConsentReportInput {
	trace: OmkReasoningTrace;
	consentLevel: OmkTracePrivacy["level"];
	language: "ko" | "en";
	includeFiles: boolean;
	includeCommands: boolean;
}

export interface OmkConsentReportOutput {
	summary: OmkTraceSummary;
	report: string;
	redactedFields: readonly string[];
	eligibleForDataset: boolean;
}

export function createOmkReasoningTrace(input: {
	turnId: string;
	userRequest: string;
	intent: OmkRequestIntent;
	risk: string;
	confidence: number;
	planSummary: string;
	planSteps: readonly string[];
	toolsSelected: readonly string[];
	mcpSelected: readonly string[];
	connectedMcp?: readonly string[];
	disconnectedMcp?: readonly string[];
	skillsSelected: readonly string[];
	hooksSelected?: readonly string[];
	toolSequence: readonly OmkTraceToolCall[];
	decisionRecords: readonly OmkTraceDecision[];
	durationMs: number;
	retries?: number;
	testResult?: OmkReasoningTrace["evidence"]["testResult"];
	diffSummary?: string;
	filesChanged?: readonly string[];
	commandsRun?: readonly string[];
	status: OmkTraceResult["status"];
	resultSummary: string;
	failureReason?: string;
	acceptReject: OmkTraceResult["acceptReject"];
	resultConfidence: number;
	privacyLevel: OmkTracePrivacy["level"];
	consentGiven?: boolean;
}): OmkReasoningTrace {
	const now = new Date().toISOString();
	return {
		id: createTraceId(),
		turnId: input.turnId,
		timestamp: now,
		userIntent: {
			raw: input.userRequest,
			classified: input.intent,
			risk: input.risk,
			confidence: input.confidence,
		},
		plan: {
			summary: input.planSummary,
			steps: input.planSteps,
			toolsSelected: input.toolsSelected,
			mcpSelected: input.mcpSelected,
			connectedMcp: input.connectedMcp ?? [],
			disconnectedMcp: input.disconnectedMcp ?? [],
			skillsSelected: input.skillsSelected,
			hooksSelected: input.hooksSelected ?? [],
		},
		execution: {
			toolSequence: input.toolSequence,
			decisionRecords: input.decisionRecords,
			durationMs: input.durationMs,
			retries: input.retries ?? 0,
		},
		evidence: {
			testResult: input.testResult,
			diffSummary: input.diffSummary,
			filesChanged: input.filesChanged ?? [],
			commandsRun: input.commandsRun ?? [],
			screenshots: [],
		},
		result: {
			status: input.status,
			summary: input.resultSummary,
			failureReason: input.failureReason,
			acceptReject: input.acceptReject,
			confidence: input.resultConfidence,
		},
		privacy: {
			level: input.privacyLevel,
			redacted: false,
			includedInDataset: false,
			consentGiven: input.consentGiven ?? false,
			redactionRules: [],
		},
	};
}

const REDACTION_PATTERNS: ReadonlyArray<{ pattern: RegExp; replacement: string; label: string }> = [
	{
		pattern: /(?:sk|sk-|key-|api[_-]?key[_=:]?\s*)[A-Za-z0-9_-]{20,}/gi,
		replacement: "[API_KEY_REDACTED]",
		label: "api_key",
	},
	{
		pattern: /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}/g,
		replacement: "[GITHUB_TOKEN_REDACTED]",
		label: "github_token",
	},
	{
		pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g,
		replacement: "[PRIVATE_KEY_REDACTED]",
		label: "private_key",
	},
	{ pattern: /(?:password|passwd|pwd)\s*[:=]\s*\S+/gi, replacement: "[PASSWORD_REDACTED]", label: "password" },
	{ pattern: /\/home\/[^/\s]+/g, replacement: "/home/[USER]", label: "home_path" },
	{ pattern: /\/Users\/[^/\s]+/g, replacement: "/Users/[USER]", label: "user_path" },
	{ pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: "[EMAIL_REDACTED]", label: "email" },
];

export function redactOmkText(
	text: string,
	level: OmkTracePrivacy["level"],
): { text: string; applied: readonly string[] } {
	if (level === "l0") {
		return { text: "[REDACTED_L0]", applied: ["full_redaction"] };
	}

	let result = text;
	const applied: string[] = [];
	for (const { pattern, replacement, label } of REDACTION_PATTERNS) {
		const before = result;
		result = result.replace(pattern, replacement);
		if (result !== before && !applied.includes(label)) {
			applied.push(label);
		}
	}

	return { text: result, applied };
}

export function redactOmkTrace(trace: OmkReasoningTrace): OmkReasoningTrace {
	const { text: redactedIntent, applied: intentRedactions } = redactOmkText(trace.userIntent.raw, trace.privacy.level);
	const { text: redactedPlan, applied: planRedactions } = redactOmkText(trace.plan.summary, trace.privacy.level);
	const { text: redactedResult, applied: resultRedactions } = redactOmkText(trace.result.summary, trace.privacy.level);
	const redactedTools = trace.execution.toolSequence.map((toolCall) => ({
		...toolCall,
		args: toolCall.args ? redactOmkText(toolCall.args, trace.privacy.level).text : undefined,
		resultSummary: redactOmkText(toolCall.resultSummary, trace.privacy.level).text,
	}));
	const redactedDiff = trace.evidence.diffSummary
		? redactOmkText(trace.evidence.diffSummary, trace.privacy.level).text
		: undefined;
	const allRedactions = [...new Set([...intentRedactions, ...planRedactions, ...resultRedactions])];

	return {
		...trace,
		userIntent: { ...trace.userIntent, raw: redactedIntent },
		plan: { ...trace.plan, summary: redactedPlan },
		execution: { ...trace.execution, toolSequence: redactedTools },
		evidence: { ...trace.evidence, diffSummary: redactedDiff },
		result: { ...trace.result, summary: redactedResult },
		privacy: {
			...trace.privacy,
			redacted: true,
			redactionRules: allRedactions,
		},
	};
}

export function summarizeOmkTrace(trace: OmkReasoningTrace): OmkTraceSummary {
	const toolNames = [...new Set(trace.execution.toolSequence.map((toolCall) => toolCall.name))];
	const testResult = trace.evidence.testResult
		? `${trace.evidence.testResult.passed}/${trace.evidence.testResult.passed + trace.evidence.testResult.failed} passed`
		: undefined;
	const durationSec = Math.round(trace.execution.durationMs / 1000);
	const duration = durationSec < 60 ? `${durationSec}s` : `${Math.round(durationSec / 60)}m ${durationSec % 60}s`;

	return {
		intent: trace.userIntent.classified,
		planSummary: trace.plan.summary,
		toolsUsed: toolNames,
		testResult,
		outcome: trace.result.summary,
		duration,
		confidence: trace.result.confidence,
	};
}

export function generateOmkConsentReport(input: OmkConsentReportInput): OmkConsentReportOutput {
	const trace = input.consentLevel === "l0" ? redactOmkTrace(input.trace) : input.trace;
	const summary = summarizeOmkTrace(trace);
	const redactedFields: string[] = [];
	const files = input.includeFiles ? trace.evidence.filesChanged : [];
	const commands = input.includeCommands ? trace.evidence.commandsRun : [];

	if (!input.includeFiles) redactedFields.push("filesChanged");
	if (!input.includeCommands) redactedFields.push("commandsRun");
	if (input.consentLevel === "l0") redactedFields.push("full_redaction");

	const lines: string[] = [];
	if (input.language === "ko") {
		lines.push("## 작업 추론 요약");
		lines.push(`**의도:** ${summary.intent} (신뢰도: ${Math.round(summary.confidence * 100)}%)`);
		lines.push(`**계획:** ${summary.planSummary}`);
		if (summary.toolsUsed.length > 0) lines.push(`**사용 도구:** ${summary.toolsUsed.join(", ")}`);
		if (summary.testResult) lines.push(`**테스트:** ${summary.testResult}`);
		lines.push(`**결과:** ${summary.outcome}`);
		lines.push(`**소요 시간:** ${summary.duration}`);
		if (files.length > 0) lines.push(`**변경 파일:** ${files.length}개`);
		if (commands.length > 0) lines.push(`**실행 명령:** ${commands.length}개`);
		if (trace.result.failureReason) lines.push(`**실패 원인:** ${trace.result.failureReason}`);
	} else {
		lines.push("## Reasoning Summary");
		lines.push(`**Intent:** ${summary.intent} (confidence: ${Math.round(summary.confidence * 100)}%)`);
		lines.push(`**Plan:** ${summary.planSummary}`);
		if (summary.toolsUsed.length > 0) lines.push(`**Tools:** ${summary.toolsUsed.join(", ")}`);
		if (summary.testResult) lines.push(`**Tests:** ${summary.testResult}`);
		lines.push(`**Outcome:** ${summary.outcome}`);
		lines.push(`**Duration:** ${summary.duration}`);
		if (files.length > 0) lines.push(`**Files changed:** ${files.length}`);
		if (commands.length > 0) lines.push(`**Commands run:** ${commands.length}`);
		if (trace.result.failureReason) lines.push(`**Failure reason:** ${trace.result.failureReason}`);
	}

	return {
		summary,
		report: lines.join("\n"),
		redactedFields,
		eligibleForDataset: input.consentLevel !== "l0" && trace.privacy.consentGiven,
	};
}
function createTraceId(): string {
	const randomUuid = globalThis.crypto?.randomUUID?.();
	if (randomUuid) return randomUuid;
	return `trace-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
