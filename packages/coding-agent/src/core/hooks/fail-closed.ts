import type {
	FailClosedToolCallResult,
	FailClosedToolResult,
	HookFailure,
	HookFailureCode,
	HookFailureStage,
	HookPolicyEffect,
	HookPolicyMetadata,
	HookPolicyStage,
} from "./types.ts";

export const FAIL_CLOSED_REASON = "Tool execution was blocked by fail-closed hook policy.";
export const MAX_HOOK_TIMEOUT_MS = 30_000;
export const DEFAULT_HOOK_POLICY: HookPolicyMetadata = freezeHookPolicy({
	stages: ["tool_call", "tool_result"],
	effects: ["validator"],
	failureMode: "fail-closed",
	timeoutMs: 5_000,
});

const DEFAULT_HOOK_FAILURE: HookFailure = freezeHookFailure({
	type: "hook_failure",
	sanitized: true,
	code: "hook_failed",
	stage: "unknown",
});

const HOOK_FAILURE_CODES: ReadonlySet<string> = new Set<string>([
	"hook_failed",
	"hook_rejected",
	"hook_timeout",
	"hook_unavailable",
]);

const HOOK_FAILURE_STAGES: ReadonlySet<string> = new Set<string>(["tool_call", "tool_result", "unknown"]);
const HOOK_POLICY_STAGES: readonly HookPolicyStage[] = [
	"tool_call",
	"tool_result",
	"session_start",
	"pre_compact",
	"session_stop",
];
const HOOK_POLICY_EFFECTS: readonly HookPolicyEffect[] = ["validator", "mutator", "observer"];
const HOOK_POLICY_STAGE_SET: ReadonlySet<string> = new Set<string>(HOOK_POLICY_STAGES);
const HOOK_POLICY_EFFECT_SET: ReadonlySet<string> = new Set<string>(HOOK_POLICY_EFFECTS);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isHookFailureCode(value: unknown): value is HookFailureCode {
	return typeof value === "string" && HOOK_FAILURE_CODES.has(value);
}

function isHookFailureStage(value: unknown): value is HookFailureStage {
	return typeof value === "string" && HOOK_FAILURE_STAGES.has(value);
}

function isHookPolicyStage(value: unknown): value is HookPolicyStage {
	return typeof value === "string" && HOOK_POLICY_STAGE_SET.has(value);
}

function isHookPolicyEffect(value: unknown): value is HookPolicyEffect {
	return typeof value === "string" && HOOK_POLICY_EFFECT_SET.has(value);
}

function readHookFailureCode(value: unknown): HookFailureCode {
	return isHookFailureCode(value) ? value : DEFAULT_HOOK_FAILURE.code;
}

function readHookFailureStage(value: unknown): HookFailureStage {
	return isHookFailureStage(value) ? value : DEFAULT_HOOK_FAILURE.stage;
}

function freezeHookFailure(failure: HookFailure): HookFailure {
	return Object.freeze({ ...failure });
}

function freezeHookPolicy(policy: HookPolicyMetadata): HookPolicyMetadata {
	return Object.freeze({
		stages: Object.freeze([...policy.stages]),
		effects: Object.freeze([...policy.effects]),
		failureMode: "fail-closed",
		timeoutMs: policy.timeoutMs,
	});
}

function sanitizePolicyStages(value: unknown): readonly HookPolicyStage[] {
	if (!Array.isArray(value)) return [...DEFAULT_HOOK_POLICY.stages];
	const present = new Set(value.filter(isHookPolicyStage));
	if (present.size === 0) return [...DEFAULT_HOOK_POLICY.stages];
	return HOOK_POLICY_STAGES.filter((stage) => present.has(stage));
}

function sanitizePolicyEffects(value: unknown): readonly HookPolicyEffect[] {
	if (!Array.isArray(value)) return [...DEFAULT_HOOK_POLICY.effects];
	const present = new Set(value.filter(isHookPolicyEffect));
	if (present.size === 0) return [...DEFAULT_HOOK_POLICY.effects];
	return HOOK_POLICY_EFFECTS.filter((effect) => present.has(effect));
}

function sanitizePolicyTimeout(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_HOOK_POLICY.timeoutMs;
	const timeoutMs = Math.trunc(value);
	if (timeoutMs <= 0 || timeoutMs > MAX_HOOK_TIMEOUT_MS) return DEFAULT_HOOK_POLICY.timeoutMs;
	return timeoutMs;
}

export function sanitizeHookFailure(failure?: unknown): HookFailure {
	if (!isRecord(failure)) {
		return freezeHookFailure(DEFAULT_HOOK_FAILURE);
	}

	return freezeHookFailure({
		type: "hook_failure",
		sanitized: true,
		code: readHookFailureCode(failure.code),
		stage: readHookFailureStage(failure.stage),
	});
}

export function sanitizeHookPolicy(policy?: unknown): HookPolicyMetadata {
	if (!isRecord(policy)) {
		return freezeHookPolicy({
			stages: [...DEFAULT_HOOK_POLICY.stages],
			effects: [...DEFAULT_HOOK_POLICY.effects],
			failureMode: "fail-closed",
			timeoutMs: DEFAULT_HOOK_POLICY.timeoutMs,
		});
	}

	return freezeHookPolicy({
		stages: sanitizePolicyStages(policy.stages),
		effects: sanitizePolicyEffects(policy.effects),
		failureMode: "fail-closed",
		timeoutMs: sanitizePolicyTimeout(policy.timeoutMs),
	});
}

export function formatFailClosedReason(failure?: unknown): string {
	void failure;
	return FAIL_CLOSED_REASON;
}

export function createFailClosedToolCallResult(failure?: unknown): FailClosedToolCallResult {
	return {
		block: true,
		reason: formatFailClosedReason(failure),
	};
}

export function createFailClosedToolResult(failure?: unknown): FailClosedToolResult {
	return {
		content: [{ type: "text", text: formatFailClosedReason(failure) }],
		details: sanitizeHookFailure(failure),
		isError: true,
	};
}
