import { createHash } from "node:crypto";

export const EXACT_CACHE_KEY_VERSION = "v1";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject;

export interface JsonObject {
	readonly [key: string]: JsonValue;
}

export interface ContextBudgetCacheAttributes extends JsonObject {
	readonly policyVersion: string;
	readonly planHash: string;
	readonly emergency: boolean;
	readonly omittedHighPriority: boolean;
}

export interface ExactResponseCacheKeyInput {
	readonly provider: string;
	readonly model: string;
	readonly modelRevision: string;
	readonly messages: JsonValue;
	readonly toolSchema: JsonValue;
	readonly temperature: number | null;
	readonly seed: string | number | null;
	readonly reasoningEffort: string | null;
	readonly promptPolicyVersion: string;
	readonly contextBudget?: ContextBudgetCacheAttributes;
	readonly tenantId: string | null;
	readonly userId: string | null;
	readonly repoHead: string;
	readonly worktreeHash: string;
	readonly environmentHash: string;
}

export interface ExactResponseCacheKeyMaterial extends JsonObject {
	readonly kind: "exact-response";
	readonly version: typeof EXACT_CACHE_KEY_VERSION;
	readonly provider: string;
	readonly model: string;
	readonly modelRevision: string;
	readonly messagesHash: string;
	readonly toolSchemaHash: string;
	readonly temperature: number | null;
	readonly seed: string | number | null;
	readonly reasoningEffort: string | null;
	readonly promptPolicyVersion: string;
	readonly contextBudget: ContextBudgetCacheAttributes | null;
	readonly tenantId: string | null;
	readonly userId: string | null;
	readonly repoHead: string;
	readonly worktreeHash: string;
	readonly environmentHash: string;
}

export interface ExactResponseCacheKey {
	readonly kind: "exact-response";
	readonly version: typeof EXACT_CACHE_KEY_VERSION;
	readonly key: string;
	readonly hash: string;
	readonly messagesHash: string;
	readonly toolSchemaHash: string;
	readonly material: ExactResponseCacheKeyMaterial;
}

export interface ToolResultCacheKeyInput {
	readonly toolName: string;
	readonly args: JsonValue;
	readonly repoHead: string;
	readonly worktreeHash: string;
	readonly toolVersion: string;
	readonly environmentHash: string;
}

export interface ToolResultCacheKeyMaterial extends JsonObject {
	readonly kind: "tool-result";
	readonly version: typeof EXACT_CACHE_KEY_VERSION;
	readonly toolName: string;
	readonly canonicalArgs: string;
	readonly repoHead: string;
	readonly worktreeHash: string;
	readonly toolVersion: string;
	readonly environmentHash: string;
}

export interface ToolResultCacheKey {
	readonly kind: "tool-result";
	readonly version: typeof EXACT_CACHE_KEY_VERSION;
	readonly key: string;
	readonly hash: string;
	readonly canonicalArgs: string;
	readonly argsHash: string;
	readonly material: ToolResultCacheKeyMaterial;
}

export type ToolResultCacheStatus = "success" | "error";

export interface ToolResultCachePolicyCandidate {
	readonly toolName: string;
	readonly status: ToolResultCacheStatus;
	readonly mutates?: boolean;
	readonly secretMarked?: boolean;
	readonly bashPure?: boolean;
}

export type ToolResultCachePolicyReason =
	| "eligible"
	| "tool.mutating"
	| "result.error"
	| "result.secret"
	| "bash.impure";

export interface ToolResultCachePolicyDecision {
	readonly eligible: boolean;
	readonly reason: ToolResultCachePolicyReason;
	readonly detail?: string;
}

export const MUTATING_TOOL_NAME_TERMS = [
	"write",
	"edit",
	"patch",
	"delete",
	"remove",
	"move",
	"rename",
	"commit",
	"merge",
	"rebase",
	"checkout",
	"push",
	"deploy",
	"publish",
	"install",
	"execute",
	"exec",
	"run",
] as const;

export function canonicalizeJson(value: JsonValue): string {
	if (value === null) {
		return "null";
	}

	switch (typeof value) {
		case "string":
		case "boolean":
			return stringifyCanonicalPrimitive(value);
		case "number":
			if (!Number.isFinite(value)) {
				throw new TypeError("Canonical JSON only supports finite numbers");
			}
			return stringifyCanonicalPrimitive(value);
		case "object":
			if (Array.isArray(value)) {
				return `[${value.map((item) => canonicalizeJson(item)).join(",")}]`;
			}
			assertPlainJsonObject(value);
			return canonicalizeObject(value);
		default:
			throw new TypeError(`Unsupported JSON value type: ${typeof value}`);
	}
}

export function hashCanonicalJson(value: JsonValue): string {
	return sha256Hex(canonicalizeJson(value));
}

export function createExactResponseCacheKey(input: ExactResponseCacheKeyInput): ExactResponseCacheKey {
	const messagesHash = hashCanonicalJson(input.messages);
	const toolSchemaHash = hashCanonicalJson(input.toolSchema);
	const material: ExactResponseCacheKeyMaterial = {
		kind: "exact-response",
		version: EXACT_CACHE_KEY_VERSION,
		provider: requireNonEmptyString("provider", input.provider),
		model: requireNonEmptyString("model", input.model),
		modelRevision: requireNonEmptyString("modelRevision", input.modelRevision),
		messagesHash,
		toolSchemaHash,
		temperature: input.temperature,
		seed: input.seed,
		reasoningEffort: normalizeNullableString("reasoningEffort", input.reasoningEffort),
		promptPolicyVersion: requireNonEmptyString("promptPolicyVersion", input.promptPolicyVersion),
		contextBudget: input.contextBudget ? normalizeContextBudgetCacheAttributes(input.contextBudget) : null,
		tenantId: normalizeNullableString("tenantId", input.tenantId),
		userId: normalizeNullableString("userId", input.userId),
		repoHead: requireNonEmptyString("repoHead", input.repoHead),
		worktreeHash: requireNonEmptyString("worktreeHash", input.worktreeHash),
		environmentHash: requireNonEmptyString("environmentHash", input.environmentHash),
	};
	const hash = hashCanonicalJson(material);
	return {
		kind: "exact-response",
		version: EXACT_CACHE_KEY_VERSION,
		key: `exact-response:${EXACT_CACHE_KEY_VERSION}:${hash}`,
		hash,
		messagesHash,
		toolSchemaHash,
		material,
	};
}

export function createToolResultCacheKey(input: ToolResultCacheKeyInput): ToolResultCacheKey {
	const canonicalArgs = canonicalizeJson(input.args);
	const argsHash = sha256Hex(canonicalArgs);
	const material: ToolResultCacheKeyMaterial = {
		kind: "tool-result",
		version: EXACT_CACHE_KEY_VERSION,
		toolName: requireNonEmptyString("toolName", input.toolName),
		canonicalArgs,
		repoHead: requireNonEmptyString("repoHead", input.repoHead),
		worktreeHash: requireNonEmptyString("worktreeHash", input.worktreeHash),
		toolVersion: requireNonEmptyString("toolVersion", input.toolVersion),
		environmentHash: requireNonEmptyString("environmentHash", input.environmentHash),
	};
	const hash = hashCanonicalJson(material);
	return {
		kind: "tool-result",
		version: EXACT_CACHE_KEY_VERSION,
		key: `tool-result:${EXACT_CACHE_KEY_VERSION}:${hash}`,
		hash,
		canonicalArgs,
		argsHash,
		material,
	};
}

export function classifyToolResultCacheEligibility(
	candidate: ToolResultCachePolicyCandidate,
): ToolResultCachePolicyDecision {
	const toolName = requireNonEmptyString("toolName", candidate.toolName);
	if (candidate.mutates === true || isKnownMutatingToolName(toolName)) {
		return denyToolResultCache("tool.mutating", toolName);
	}

	if (candidate.status !== "success") {
		return denyToolResultCache("result.error", candidate.status);
	}

	if (candidate.secretMarked === true) {
		return denyToolResultCache("result.secret", toolName);
	}

	if (isBashToolName(toolName) && candidate.bashPure !== true) {
		return denyToolResultCache("bash.impure", toolName);
	}

	return { eligible: true, reason: "eligible" };
}

export function canCacheToolResult(candidate: ToolResultCachePolicyCandidate): boolean {
	return classifyToolResultCacheEligibility(candidate).eligible;
}

export function isKnownMutatingToolName(toolName: string): boolean {
	const terms = splitToolName(toolName);
	return MUTATING_TOOL_NAME_TERMS.some((term) => terms.includes(term));
}

export function isBashToolName(toolName: string): boolean {
	return splitToolName(toolName).includes("bash");
}

function canonicalizeObject(value: JsonObject): string {
	return `{${Object.keys(value)
		.sort()
		.map((key) => `${stringifyCanonicalPrimitive(key)}:${canonicalizeJson(value[key])}`)
		.join(",")}}`;
}

function stringifyCanonicalPrimitive(value: JsonPrimitive): string {
	const encoded = JSON.stringify(value);
	if (encoded === undefined) {
		throw new TypeError("Unsupported JSON primitive");
	}
	return encoded;
}

function assertPlainJsonObject(value: object): asserts value is JsonObject {
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError("Canonical JSON only supports plain objects and arrays");
	}
}

function sha256Hex(value: string): string {
	return createHash("sha256").update(value, "utf8").digest("hex");
}

function requireNonEmptyString(name: string, value: string): string {
	if (value.trim().length === 0) {
		throw new TypeError(`${name} must be a non-empty string`);
	}
	return value;
}

function normalizeNullableString(name: string, value: string | null): string | null {
	if (value === null) {
		return null;
	}
	return requireNonEmptyString(name, value);
}

function normalizeContextBudgetCacheAttributes(attributes: ContextBudgetCacheAttributes): ContextBudgetCacheAttributes {
	return {
		policyVersion: requireNonEmptyString("contextBudget.policyVersion", attributes.policyVersion),
		planHash: requireNonEmptyString("contextBudget.planHash", attributes.planHash),
		emergency: attributes.emergency === true,
		omittedHighPriority: attributes.omittedHighPriority === true,
	};
}

function splitToolName(toolName: string): readonly string[] {
	return toolName
		.trim()
		.toLowerCase()
		.split(/[^a-z0-9]+/g)
		.filter((term) => term.length > 0);
}

function denyToolResultCache(
	reason: Exclude<ToolResultCachePolicyReason, "eligible">,
	detail: string,
): ToolResultCachePolicyDecision {
	return { eligible: false, reason, detail };
}
