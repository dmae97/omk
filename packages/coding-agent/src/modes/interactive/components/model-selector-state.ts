import { fuzzyFilter } from "@earendil-works/omk-tui";

/**
 * Pure, render-free state machine for the `/model` selector.
 *
 * The interactive {@link ModelSelectorComponent} is a thin view/controller that
 * delegates every state transition to {@link modelSelectorReducer}. Keeping the
 * decision logic here makes the `/model` contract testable without a TUI and
 * shrinks the blast radius of theme/rendering refactors: presentation can change
 * freely as long as this reducer keeps its semantic guarantees.
 */

export type ModelScope = "all" | "scoped";

export type ProviderTab = "all" | string;

export const ALL_PROVIDER_TAB = "all" as const;

/**
 * Preferred display order for first-party providers. Anything outside this list
 * is treated as a custom provider and sorted lexicographically after the known
 * providers (see {@link buildProviderTabs}).
 */
export const KNOWN_PROVIDER_ORDER = [
	"anthropic",
	"openai",
	"google",
	"deepseek",
	"kimi",
	"openrouter",
	"mistral",
	"xai",
	"groq",
	"zai",
	"together",
	"fireworks",
] as const;

/**
 * Minimal model projection the reducer needs. The component maps its richer
 * `ModelItem` (with the full `Model` object) down to this shape and keeps a
 * key -> item map for rendering and selection.
 */
export interface ModelSelectorModel {
	readonly provider: string;
	readonly id: string;
	readonly name: string;
}

export interface ModelSelectorState {
	readonly scope: ModelScope;
	readonly activeProvider: ProviderTab;
	readonly providerIds: readonly ProviderTab[];
	readonly query: string;
	readonly selectedIndex: number;
	readonly visibleModelKeys: readonly string[];
	/** Full corpus retained so transitions stay pure functions of (state, action). */
	readonly allModels: readonly ModelSelectorModel[];
	readonly scopedModels: readonly ModelSelectorModel[];
	readonly currentModelKey?: string;
}

export type ModelSelectorAction =
	| { type: "NEXT_PROVIDER" }
	| { type: "PREVIOUS_PROVIDER" }
	| { type: "TOGGLE_SCOPE_FORWARD" }
	| { type: "TOGGLE_SCOPE_BACKWARD" }
	| { type: "SEARCH"; query: string }
	| { type: "MOVE_SELECTION"; delta: 1 | -1 }
	| {
			type: "REFRESH_MODELS";
			allModels: readonly ModelSelectorModel[];
			scopedModels: readonly ModelSelectorModel[];
			currentModelKey?: string;
	  };

export function modelSelectorModelKey(model: { readonly provider: string; readonly id: string }): string {
	return `${model.provider}/${model.id}`;
}

function isKnownProvider(provider: string): boolean {
	return (KNOWN_PROVIDER_ORDER as readonly string[]).includes(provider);
}

/**
 * Build the provider tab ring: `all` first, then known providers in their
 * canonical order, then any custom providers sorted lexicographically.
 */
export function buildProviderTabs(models: readonly ModelSelectorModel[]): ProviderTab[] {
	const providerIds = Array.from(new Set(models.map((model) => model.provider)));
	const ordered = KNOWN_PROVIDER_ORDER.filter((provider) => providerIds.includes(provider));
	const extras = providerIds.filter((provider) => !isKnownProvider(provider)).sort((a, b) => a.localeCompare(b));
	return [ALL_PROVIDER_TAB, ...ordered, ...extras];
}

function filterByProvider(
	models: readonly ModelSelectorModel[],
	activeProvider: ProviderTab,
): readonly ModelSelectorModel[] {
	if (activeProvider === ALL_PROVIDER_TAB) return models;
	return models.filter((model) => model.provider === activeProvider);
}

function applySearch(models: readonly ModelSelectorModel[], query: string): readonly ModelSelectorModel[] {
	if (!query) return models;
	return fuzzyFilter(
		[...models],
		query,
		({ id, provider }) => `${id} ${provider} ${provider}/${id} ${provider} ${id}`,
	);
}

function clampIndex(index: number, length: number): number {
	if (length === 0) return 0;
	return Math.min(Math.max(index, 0), length - 1);
}

export interface CreateInitialOptions {
	readonly scope?: ModelScope;
	readonly activeProvider?: ProviderTab;
	readonly query?: string;
}

export function createInitialModelSelectorState(options: CreateInitialOptions = {}): ModelSelectorState {
	return {
		scope: options.scope ?? "all",
		activeProvider: options.activeProvider ?? ALL_PROVIDER_TAB,
		providerIds: [ALL_PROVIDER_TAB],
		query: options.query ?? "",
		selectedIndex: 0,
		visibleModelKeys: [],
		allModels: [],
		scopedModels: [],
		currentModelKey: undefined,
	};
}

/**
 * Recompute provider tabs, the validated active provider, and the visible model
 * list for the given corpus/scope/query, then resolve the selected index with
 * the supplied strategy. Centralizing this keeps every transition consistent
 * with the contract invariants.
 */
function project(overrides: {
	readonly scope: ModelScope;
	readonly allModels: readonly ModelSelectorModel[];
	readonly scopedModels: readonly ModelSelectorModel[];
	readonly query: string;
	readonly currentModelKey?: string;
	readonly desiredProvider: ProviderTab;
	readonly select: (input: {
		readonly visibleKeys: readonly string[];
		readonly providerFilteredKeys: readonly string[];
	}) => number;
}): ModelSelectorState {
	const corpus = overrides.scope === "scoped" ? overrides.scopedModels : overrides.allModels;
	const providerIds = buildProviderTabs(corpus);
	const activeProvider = providerIds.includes(overrides.desiredProvider)
		? overrides.desiredProvider
		: ALL_PROVIDER_TAB;
	const providerFiltered = filterByProvider(corpus, activeProvider);
	const visible = applySearch(providerFiltered, overrides.query);
	const visibleModelKeys = visible.map(modelSelectorModelKey);
	const selectedIndex = clampIndex(
		overrides.select({
			visibleKeys: visibleModelKeys,
			providerFilteredKeys: providerFiltered.map(modelSelectorModelKey),
		}),
		visibleModelKeys.length,
	);
	return {
		scope: overrides.scope,
		activeProvider,
		providerIds,
		query: overrides.query,
		selectedIndex,
		visibleModelKeys,
		allModels: overrides.allModels,
		scopedModels: overrides.scopedModels,
		currentModelKey: overrides.currentModelKey,
	};
}

export function modelSelectorReducer(state: ModelSelectorState, action: ModelSelectorAction): ModelSelectorState {
	switch (action.type) {
		case "REFRESH_MODELS":
			return project({
				scope: state.scope,
				allModels: action.allModels,
				scopedModels: action.scopedModels,
				query: state.query,
				currentModelKey: action.currentModelKey,
				desiredProvider: state.activeProvider,
				select: ({ visibleKeys }) => {
					const currentIndex = action.currentModelKey ? visibleKeys.indexOf(action.currentModelKey) : -1;
					return currentIndex >= 0
						? currentIndex
						: Math.min(state.selectedIndex, Math.max(0, visibleKeys.length - 1));
				},
			});

		case "NEXT_PROVIDER":
		case "PREVIOUS_PROVIDER": {
			if (state.providerIds.length === 0) return state;
			const direction = action.type === "NEXT_PROVIDER" ? 1 : -1;
			const currentIndex = Math.max(0, state.providerIds.indexOf(state.activeProvider));
			const nextIndex = (currentIndex + direction + state.providerIds.length) % state.providerIds.length;
			const desiredProvider = state.providerIds[nextIndex] ?? ALL_PROVIDER_TAB;
			return project({
				scope: state.scope,
				allModels: state.allModels,
				scopedModels: state.scopedModels,
				query: state.query,
				currentModelKey: state.currentModelKey,
				desiredProvider,
				select: () => 0,
			});
		}

		case "TOGGLE_SCOPE_FORWARD":
		case "TOGGLE_SCOPE_BACKWARD": {
			// Scope is a two-state toggle (all <-> scoped); both directions flip it.
			// Without scoped models there is nothing to toggle into.
			if (state.scopedModels.length === 0) return state;
			const scope: ModelScope = state.scope === "all" ? "scoped" : "all";
			return project({
				scope,
				allModels: state.allModels,
				scopedModels: state.scopedModels,
				query: state.query,
				currentModelKey: state.currentModelKey,
				desiredProvider: state.activeProvider,
				select: ({ providerFilteredKeys }) => {
					const currentIndex = state.currentModelKey ? providerFilteredKeys.indexOf(state.currentModelKey) : -1;
					return currentIndex >= 0 ? currentIndex : 0;
				},
			});
		}

		case "SEARCH":
			return project({
				scope: state.scope,
				allModels: state.allModels,
				scopedModels: state.scopedModels,
				query: action.query,
				currentModelKey: state.currentModelKey,
				desiredProvider: state.activeProvider,
				select: () => state.selectedIndex,
			});

		case "MOVE_SELECTION": {
			const length = state.visibleModelKeys.length;
			if (length === 0) return state;
			const selectedIndex =
				action.delta === -1
					? state.selectedIndex === 0
						? length - 1
						: state.selectedIndex - 1
					: state.selectedIndex === length - 1
						? 0
						: state.selectedIndex + 1;
			return { ...state, selectedIndex };
		}
	}
}

/** Resolve the selected model key, if any, for the current visible list. */
export function selectedModelKey(state: ModelSelectorState): string | undefined {
	return state.visibleModelKeys[state.selectedIndex];
}
