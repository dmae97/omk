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

export interface ProviderStripLayout {
	/** Tab indices to render, in ascending order. Always includes 0 and the active index. */
	readonly indices: readonly number[];
	/** Render an ellipsis between the first tab ("all") and the rest (hidden middle). */
	readonly ellipsisAfterFirst: boolean;
	/** Render a trailing ellipsis (tabs hidden after the last shown). */
	readonly trailingEllipsis: boolean;
}

function providerStripWidth(
	indices: readonly number[],
	tabWidths: readonly number[],
	separatorWidth: number,
	ellipsisWidth: number,
): number {
	if (indices.length === 0) return 0;
	let total = 0;
	let gaps = 0;
	for (let k = 0; k < indices.length; k++) {
		const current = indices[k] ?? 0;
		total += tabWidths[current] ?? 0;
		if (k > 0) {
			total += separatorWidth;
			if (current - (indices[k - 1] ?? 0) > 1) gaps += 1;
		}
	}
	const last = indices[indices.length - 1] ?? 0;
	const trailing = last < tabWidths.length - 1 ? 1 : 0;
	return total + ellipsisWidth * (gaps + trailing);
}

/**
 * Window a provider tab strip into a visible-column budget so the row never
 * overflows the terminal while always keeping the "all" anchor (index 0) and the
 * active tab visible. When the full strip fits, every tab is shown. Otherwise a
 * contiguous window is grown around the active tab (right-biased, then left),
 * with a single leading ellipsis for a hidden middle and a trailing ellipsis for
 * hidden tail tabs.
 *
 * Pure and presentation-agnostic: callers pass the visible width of each themed
 * tab label (via omk-tui `visibleWidth`) plus the separator/ellipsis widths.
 * If the budget cannot even hold the mandatory {all, active} tabs, those are
 * still returned (the caller may then hard-truncate).
 */
export function fitProviderStrip(
	tabWidths: readonly number[],
	activeIndex: number,
	budget: number,
	separatorWidth: number,
	ellipsisWidth: number,
): ProviderStripLayout {
	const n = tabWidths.length;
	if (n === 0) return { indices: [], ellipsisAfterFirst: false, trailingEllipsis: false };

	const allIndices = Array.from({ length: n }, (_, i) => i);
	if (providerStripWidth(allIndices, tabWidths, separatorWidth, ellipsisWidth) <= budget) {
		return { indices: allIndices, ellipsisAfterFirst: false, trailingEllipsis: false };
	}

	const active = Math.max(0, Math.min(activeIndex, n - 1));
	const shown = new Set<number>([0, active]);
	const sortedShown = (): number[] => [...shown].sort((a, b) => a - b);

	let low = active;
	let high = active;
	let progressed = true;
	while (progressed) {
		progressed = false;
		if (high + 1 < n && !shown.has(high + 1)) {
			shown.add(high + 1);
			if (providerStripWidth(sortedShown(), tabWidths, separatorWidth, ellipsisWidth) <= budget) {
				high += 1;
				progressed = true;
			} else {
				shown.delete(high + 1);
			}
		}
		if (low - 1 > 0 && !shown.has(low - 1)) {
			shown.add(low - 1);
			if (providerStripWidth(sortedShown(), tabWidths, separatorWidth, ellipsisWidth) <= budget) {
				low -= 1;
				progressed = true;
			} else {
				shown.delete(low - 1);
			}
		}
	}

	const indices = sortedShown();
	const first = indices[0] ?? 0;
	const second = indices[1] ?? first;
	const last = indices[indices.length - 1] ?? 0;
	return {
		indices,
		ellipsisAfterFirst: indices.length > 1 && second - first > 1,
		trailingEllipsis: last < n - 1,
	};
}
