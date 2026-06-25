export const ALLOWED_SEMANTIC_CACHE_TASK_CLASSES = [
	"faq",
	"read_only_analysis",
	"documentation_lookup",
	"code_explanation",
	"conceptual_explanation",
] as const;

export const FORBIDDEN_SEMANTIC_CACHE_TASK_CLASS_TERMS = [
	"mutation",
	"mutating",
	"write",
	"edit",
	"create",
	"update",
	"delete",
	"deploy",
	"deployment",
	"release",
	"publish",
	"auth",
	"authentication",
	"authorization",
	"security",
	"secret",
	"credential",
	"token",
	"time",
	"clock",
	"date",
	"external",
	"network",
	"database",
	"stateful",
] as const;

export const FORBIDDEN_SEMANTIC_CACHE_ACTION_TERMS = [
	"mutation",
	"mutate",
	"write",
	"edit",
	"create",
	"update",
	"delete",
	"patch",
	"modify",
	"commit",
	"merge",
	"rebase",
	"push",
	"deploy",
	"release",
	"publish",
	"login",
	"logout",
	"auth",
	"authorize",
	"token",
	"secret",
	"credential",
	"security",
	"scan",
	"audit",
	"time",
	"now",
	"today",
	"current",
	"latest",
	"fetch",
	"request",
	"web",
	"network",
	"api",
	"database",
	"external",
] as const;

export type SemanticCacheTaskClass = (typeof ALLOWED_SEMANTIC_CACHE_TASK_CLASSES)[number];

export type SemanticCacheResponseKind = "final" | "draft" | "tool_call" | "tool_result";

export interface SemanticCacheContextAttributes {
	branch?: string;
	worktree?: string;
	repoSha?: string;
}

export interface SemanticCacheDependencyFlags {
	mutation?: boolean;
	deploy?: boolean;
	auth?: boolean;
	security?: boolean;
	time?: boolean;
	externalState?: boolean;
}

export interface SemanticCacheContextBudgetFlags {
	emergency?: boolean;
	omittedRequired?: boolean;
	omittedHighPriority?: boolean;
}

export interface SemanticCacheCandidate {
	enabled?: boolean;
	responseKind?: SemanticCacheResponseKind;
	responseReadOnly?: boolean;
	pendingToolCallCount?: number;
	taskClass?: string;
	action?: string;
	actions?: readonly string[];
	dependencies?: SemanticCacheDependencyFlags;
	contextBudget?: SemanticCacheContextBudgetFlags;
	cacheAttributes?: SemanticCacheContextAttributes;
	currentAttributes?: SemanticCacheContextAttributes;
}

export type SemanticCachePolicyReason =
	| "eligible"
	| "disabled"
	| "response.not_final"
	| "response.not_read_only"
	| "tool_calls.unknown"
	| "tool_calls.pending"
	| "dependence.mutation"
	| "dependence.deploy"
	| "dependence.auth"
	| "dependence.security"
	| "dependence.time"
	| "dependence.external_state"
	| "context_budget.incomplete"
	| "task_class.missing"
	| "task_class.forbidden_term"
	| "task_class.not_allowed"
	| "action.forbidden_term"
	| SemanticCacheAttributePolicyReason;

export type SemanticCacheAttributePolicyReason =
	| "attributes.ok"
	| "attributes.missing_branch"
	| "attributes.missing_worktree"
	| "attributes.missing_repo_sha"
	| "attributes.missing_current_branch"
	| "attributes.missing_current_worktree"
	| "attributes.missing_current_repo_sha"
	| "attributes.branch_mismatch"
	| "attributes.worktree_mismatch"
	| "attributes.repo_sha_mismatch";

export interface SemanticCachePolicyDecision {
	eligible: boolean;
	reason: SemanticCachePolicyReason;
	detail?: string;
}

export interface SemanticCacheAttributeValidation {
	valid: boolean;
	reason: SemanticCacheAttributePolicyReason;
	attribute?: keyof SemanticCacheContextAttributes;
}

type RequiredAttribute = keyof SemanticCacheContextAttributes;

const REQUIRED_ATTRIBUTES: readonly RequiredAttribute[] = ["branch", "worktree", "repoSha"];

const MISSING_CACHE_ATTRIBUTE_REASONS: Record<RequiredAttribute, SemanticCacheAttributePolicyReason> = {
	branch: "attributes.missing_branch",
	worktree: "attributes.missing_worktree",
	repoSha: "attributes.missing_repo_sha",
};

const MISSING_CURRENT_ATTRIBUTE_REASONS: Record<RequiredAttribute, SemanticCacheAttributePolicyReason> = {
	branch: "attributes.missing_current_branch",
	worktree: "attributes.missing_current_worktree",
	repoSha: "attributes.missing_current_repo_sha",
};

const ATTRIBUTE_MISMATCH_REASONS: Record<RequiredAttribute, SemanticCacheAttributePolicyReason> = {
	branch: "attributes.branch_mismatch",
	worktree: "attributes.worktree_mismatch",
	repoSha: "attributes.repo_sha_mismatch",
};

export function classifySemanticCacheEligibility(candidate: SemanticCacheCandidate): SemanticCachePolicyDecision {
	if (candidate.enabled !== true) {
		return deny("disabled");
	}

	if (candidate.responseKind !== "final") {
		return deny("response.not_final");
	}

	if (candidate.responseReadOnly !== true) {
		return deny("response.not_read_only");
	}

	if (candidate.pendingToolCallCount === undefined) {
		return deny("tool_calls.unknown");
	}

	if (candidate.pendingToolCallCount !== 0) {
		return deny("tool_calls.pending");
	}

	const dependencyReason = classifyForbiddenDependence(candidate.dependencies);
	if (dependencyReason !== undefined) {
		return deny(dependencyReason);
	}

	if (isContextBudgetIncomplete(candidate.contextBudget)) {
		return deny("context_budget.incomplete");
	}

	if (candidate.taskClass === undefined || candidate.taskClass.trim().length === 0) {
		return deny("task_class.missing");
	}

	if (containsForbiddenTerm(candidate.taskClass, FORBIDDEN_SEMANTIC_CACHE_TASK_CLASS_TERMS)) {
		return deny("task_class.forbidden_term", candidate.taskClass);
	}

	const normalizedTaskClass = normalizeTaskClass(candidate.taskClass);
	if (!isAllowedTaskClass(normalizedTaskClass)) {
		return deny("task_class.not_allowed", candidate.taskClass);
	}

	const actions = collectActions(candidate);
	if (actions.some((action) => containsForbiddenTerm(action, FORBIDDEN_SEMANTIC_CACHE_ACTION_TERMS))) {
		return deny("action.forbidden_term", actions.join(", "));
	}

	const attributeValidation = validateSemanticCacheAttributes(candidate.cacheAttributes, candidate.currentAttributes);
	if (!attributeValidation.valid) {
		return deny(attributeValidation.reason, attributeValidation.attribute);
	}

	return { eligible: true, reason: "eligible" };
}

export function validateSemanticCacheAttributes(
	cacheAttributes: SemanticCacheContextAttributes | undefined,
	currentAttributes: SemanticCacheContextAttributes | undefined,
): SemanticCacheAttributeValidation {
	for (const attribute of REQUIRED_ATTRIBUTES) {
		if (!hasUsableAttribute(cacheAttributes, attribute)) {
			return { valid: false, reason: MISSING_CACHE_ATTRIBUTE_REASONS[attribute], attribute };
		}
	}

	for (const attribute of REQUIRED_ATTRIBUTES) {
		if (!hasUsableAttribute(currentAttributes, attribute)) {
			return { valid: false, reason: MISSING_CURRENT_ATTRIBUTE_REASONS[attribute], attribute };
		}
	}

	for (const attribute of REQUIRED_ATTRIBUTES) {
		const cacheAttribute = cacheAttributes?.[attribute];
		const currentAttribute = currentAttributes?.[attribute];
		if (cacheAttribute !== currentAttribute) {
			return { valid: false, reason: ATTRIBUTE_MISMATCH_REASONS[attribute], attribute };
		}
	}

	return { valid: true, reason: "attributes.ok" };
}

function isContextBudgetIncomplete(contextBudget: SemanticCacheContextBudgetFlags | undefined): boolean {
	return (
		contextBudget?.emergency === true ||
		contextBudget?.omittedRequired === true ||
		contextBudget?.omittedHighPriority === true
	);
}

function classifyForbiddenDependence(
	dependencies: SemanticCacheDependencyFlags | undefined,
): SemanticCachePolicyReason | undefined {
	if (dependencies?.mutation === true) {
		return "dependence.mutation";
	}
	if (dependencies?.deploy === true) {
		return "dependence.deploy";
	}
	if (dependencies?.auth === true) {
		return "dependence.auth";
	}
	if (dependencies?.security === true) {
		return "dependence.security";
	}
	if (dependencies?.time === true) {
		return "dependence.time";
	}
	if (dependencies?.externalState === true) {
		return "dependence.external_state";
	}
	return undefined;
}

function collectActions(candidate: SemanticCacheCandidate): readonly string[] {
	const actions: string[] = [];
	if (candidate.action !== undefined) {
		actions.push(candidate.action);
	}
	if (candidate.actions !== undefined) {
		actions.push(...candidate.actions);
	}
	return actions;
}

function isAllowedTaskClass(taskClass: string): taskClass is SemanticCacheTaskClass {
	return ALLOWED_SEMANTIC_CACHE_TASK_CLASSES.some((allowedTaskClass) => allowedTaskClass === taskClass);
}

function containsForbiddenTerm(text: string, terms: readonly string[]): boolean {
	const textTerms = splitSearchTerms(text);
	const textTermSet = new Set(textTerms);
	const normalizedText = ` ${textTerms.join(" ")} `;

	return terms.some((term) => {
		const normalizedTerm = splitSearchTerms(term).join(" ");
		if (normalizedTerm.length === 0) {
			return false;
		}
		if (normalizedTerm.includes(" ")) {
			return normalizedText.includes(` ${normalizedTerm} `);
		}
		return textTermSet.has(normalizedTerm);
	});
}

function normalizeTaskClass(taskClass: string): string {
	return taskClass
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
}

function splitSearchTerms(text: string): string[] {
	return text
		.trim()
		.toLowerCase()
		.split(/[^a-z0-9]+/g)
		.filter((term) => term.length > 0);
}

function hasUsableAttribute(
	attributes: SemanticCacheContextAttributes | undefined,
	attribute: RequiredAttribute,
): boolean {
	return typeof attributes?.[attribute] === "string" && attributes[attribute].trim().length > 0;
}

function deny(
	reason: SemanticCachePolicyReason,
	detail?: string | keyof SemanticCacheContextAttributes,
): SemanticCachePolicyDecision {
	return detail === undefined ? { eligible: false, reason } : { eligible: false, reason, detail };
}
