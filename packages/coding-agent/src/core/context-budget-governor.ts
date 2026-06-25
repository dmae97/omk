import { createHash } from "node:crypto";
import { createFallbackTokenCounter, type TokenCounterAdapter } from "./context-budget-token-counter.ts";

export type ContextBudgetItemKind =
	| "system"
	| "context-pointer"
	| "context-full"
	| "skill-header"
	| "skill"
	| "mcp"
	| "history"
	| "tool-result"
	| "subagent-evidence"
	| "budget-note";

export type ContextBudgetPriority = "hard" | "high" | "medium" | "low";
export type ContextBudgetDiagnosticReason = "hard_pin_over_capacity" | "item_omitted" | "invalid_budget";

export interface ContextBudgetItem {
	readonly id: string;
	readonly kind: ContextBudgetItemKind;
	readonly text: string;
	readonly priority: ContextBudgetPriority;
	readonly tokenEstimate?: number;
	readonly relevance?: number;
	readonly recency?: number;
	readonly evidenceValue?: number;
	readonly redundancyKey?: string;
}

export interface ContextBudgetGovernorInput {
	readonly maxTokens: number;
	readonly responseReserveTokens?: number;
	readonly modelId?: string;
	readonly policyVersion?: string;
	readonly items: readonly ContextBudgetItem[];
	readonly tokenCounter?: TokenCounterAdapter;
}

export interface ContextBudgetPlannedItem extends ContextBudgetItem {
	readonly estimatedTokens: number;
	readonly score: number;
}

export interface ContextBudgetDiagnostic {
	readonly reason: ContextBudgetDiagnosticReason;
	readonly itemId?: string;
	readonly detail: string;
}

export interface ContextBudgetPlan {
	readonly policyVersion: string;
	readonly maxTokens: number;
	readonly responseReserveTokens: number;
	readonly availableTokens: number;
	readonly usedTokens: number;
	readonly omittedTokens: number;
	readonly emergency: boolean;
	readonly omittedHighPriority: boolean;
	readonly includedItems: readonly ContextBudgetPlannedItem[];
	readonly omittedItems: readonly ContextBudgetPlannedItem[];
	readonly diagnostics: readonly ContextBudgetDiagnostic[];
	readonly planHash: string;
}

export const CONTEXT_BUDGET_POLICY_VERSION = "context-budget-v1";

export function planContextBudget(input: ContextBudgetGovernorInput): ContextBudgetPlan {
	const tokenCounter = input.tokenCounter ?? createFallbackTokenCounter();
	const modelId = input.modelId ?? "unknown";
	const maxTokens = Math.floor(input.maxTokens);
	const responseReserveTokens = Math.max(0, Math.floor(input.responseReserveTokens ?? 0));
	const diagnostics: ContextBudgetDiagnostic[] = [];
	if (!Number.isFinite(maxTokens) || maxTokens < 0) {
		diagnostics.push({ reason: "invalid_budget", detail: `maxTokens must be non-negative, got ${input.maxTokens}` });
	}
	const availableTokens = Math.max(0, maxTokens - responseReserveTokens);
	const plannedItems = input.items.map((item) => planItem(item, tokenCounter, modelId));
	const includedIds = new Set<string>();
	let usedTokens = 0;

	for (const item of plannedItems) {
		if (item.priority !== "hard") {
			continue;
		}
		includedIds.add(item.id);
		usedTokens += item.estimatedTokens;
	}

	if (usedTokens > availableTokens) {
		diagnostics.push({
			reason: "hard_pin_over_capacity",
			detail: `hard-pinned context uses ${usedTokens} tokens against ${availableTokens} available tokens`,
		});
	}

	const selectedRedundancyKeys = new Set<string>();
	const optionalItems = plannedItems
		.filter((item) => item.priority !== "hard")
		.map((item) => applyRedundancyPenalty(item, selectedRedundancyKeys))
		.sort(comparePlannedItemsForSelection);

	for (const item of optionalItems) {
		if (usedTokens + item.estimatedTokens <= availableTokens) {
			includedIds.add(item.id);
			usedTokens += item.estimatedTokens;
			if (item.redundancyKey) {
				selectedRedundancyKeys.add(item.redundancyKey);
			}
		}
	}

	const includedItems = plannedItems.filter((item) => includedIds.has(item.id));
	const omittedItems = plannedItems.filter((item) => !includedIds.has(item.id));
	for (const item of omittedItems) {
		diagnostics.push({ reason: "item_omitted", itemId: item.id, detail: `${item.kind} omitted from context budget` });
	}
	const omittedTokens = omittedItems.reduce((sum, item) => sum + item.estimatedTokens, 0);
	const omittedHighPriority = omittedItems.some((item) => item.priority === "high");
	const emergency =
		usedTokens > availableTokens || diagnostics.some((diagnostic) => diagnostic.reason === "invalid_budget");
	const policyVersion = input.policyVersion ?? CONTEXT_BUDGET_POLICY_VERSION;

	const planWithoutHash = {
		policyVersion,
		maxTokens: Number.isFinite(maxTokens) ? maxTokens : 0,
		responseReserveTokens,
		availableTokens,
		usedTokens,
		omittedTokens,
		emergency,
		omittedHighPriority,
		included: includedItems.map((item) => [item.id, item.estimatedTokens, item.score]),
		omitted: omittedItems.map((item) => [item.id, item.estimatedTokens, item.score]),
	};
	const planHash = createHash("sha256").update(JSON.stringify(planWithoutHash), "utf8").digest("hex");

	return {
		policyVersion,
		maxTokens: Number.isFinite(maxTokens) ? maxTokens : 0,
		responseReserveTokens,
		availableTokens,
		usedTokens,
		omittedTokens,
		emergency,
		omittedHighPriority,
		includedItems,
		omittedItems,
		diagnostics,
		planHash,
	};
}

export function scoreContextBudgetItem(item: ContextBudgetItem, estimatedTokens: number): number {
	const priorityScore = priorityWeight(item.priority);
	const relevance = clampScore(item.relevance) * 20;
	const recency = clampScore(item.recency) * 10;
	const evidence = clampScore(item.evidenceValue) * 15;
	const costPenalty = Math.log2(Math.max(estimatedTokens, 1)) * 2;
	return priorityScore + relevance + recency + evidence - costPenalty;
}

function planItem(
	item: ContextBudgetItem,
	tokenCounter: TokenCounterAdapter,
	modelId: string,
): ContextBudgetPlannedItem {
	const estimatedTokens = Math.max(
		0,
		Math.ceil(item.tokenEstimate ?? tokenCounter.countText(item.text, modelId).tokens),
	);
	return {
		...item,
		estimatedTokens,
		score: item.priority === "hard" ? Number.POSITIVE_INFINITY : scoreContextBudgetItem(item, estimatedTokens),
	};
}

function applyRedundancyPenalty(
	item: ContextBudgetPlannedItem,
	selectedRedundancyKeys: Set<string>,
): ContextBudgetPlannedItem {
	if (!item.redundancyKey || !selectedRedundancyKeys.has(item.redundancyKey)) {
		return item;
	}
	return { ...item, score: item.score - 20 };
}

function comparePlannedItemsForSelection(a: ContextBudgetPlannedItem, b: ContextBudgetPlannedItem): number {
	if (b.score !== a.score) {
		return b.score - a.score;
	}
	if (a.estimatedTokens !== b.estimatedTokens) {
		return a.estimatedTokens - b.estimatedTokens;
	}
	return a.id.localeCompare(b.id);
}

function priorityWeight(priority: ContextBudgetPriority): number {
	switch (priority) {
		case "hard":
			return 1_000_000;
		case "high":
			return 100;
		case "medium":
			return 50;
		case "low":
			return 10;
	}
}

function clampScore(value: number | undefined): number {
	if (value === undefined || !Number.isFinite(value)) {
		return 0;
	}
	return Math.max(0, Math.min(1, value));
}
