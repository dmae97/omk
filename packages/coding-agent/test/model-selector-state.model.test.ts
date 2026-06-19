import { fuzzyFilter } from "@earendil-works/omk-tui";
import { describe, expect, it } from "vitest";
import {
	ALL_PROVIDER_TAB,
	createInitialModelSelectorState,
	KNOWN_PROVIDER_ORDER,
	type ModelScope,
	type ModelSelectorAction,
	type ModelSelectorModel,
	type ModelSelectorState,
	modelSelectorReducer,
} from "../src/modes/interactive/components/model-selector-state.ts";
import { checkProperty, listShrink, type Rng } from "./helpers/property.ts";

function key(model: ModelSelectorModel): string {
	return `${model.provider}/${model.id}`;
}

const FULL_MODELS: readonly ModelSelectorModel[] = [
	{ provider: "anthropic", id: "claude-opus", name: "Claude Opus" },
	{ provider: "anthropic", id: "claude-haiku", name: "Claude Haiku" },
	{ provider: "openai", id: "gpt-5", name: "GPT-5" },
	{ provider: "openai", id: "gpt-4o-mini", name: "GPT-4o mini" },
	{ provider: "google", id: "gemini-pro", name: "Gemini Pro" },
	{ provider: "kimi", id: "kimi-k2", name: "Kimi K2" },
	{ provider: "zeta-labs", id: "zeta-one", name: "Zeta One" },
	{ provider: "acme", id: "acme-fast", name: "Acme Fast" },
];

const FULL_SCOPED: readonly ModelSelectorModel[] = [
	{ provider: "anthropic", id: "claude-opus", name: "Claude Opus" },
	{ provider: "kimi", id: "kimi-k2", name: "Kimi K2" },
	{ provider: "acme", id: "acme-fast", name: "Acme Fast" },
];

// Distinct corpora that REFRESH_MODELS can swap in, exercising provider-tab
// rebuilds and the invalid-provider -> "all" fallback path.
const CORPUS_VARIANTS: ReadonlyArray<{
	readonly allModels: readonly ModelSelectorModel[];
	readonly scopedModels: readonly ModelSelectorModel[];
}> = [
	{ allModels: FULL_MODELS, scopedModels: FULL_SCOPED },
	{
		allModels: FULL_MODELS.filter((m) => m.provider !== "kimi"),
		scopedModels: FULL_SCOPED.filter((m) => m.provider !== "kimi"),
	},
	{ allModels: FULL_MODELS.filter((m) => m.provider !== "anthropic"), scopedModels: [] },
	{ allModels: FULL_MODELS.filter((m) => m.provider === "acme" || m.provider === "zeta-labs"), scopedModels: [] },
];

const SEARCH_QUERIES = ["", "claude", "gpt", "kimi", "zeta", "acme", "5", "mini", "no-match-xyz"];

function searchText({ id, provider }: ModelSelectorModel): string {
	return `${id} ${provider} ${provider}/${id} ${provider} ${id}`;
}

// ---------------------------------------------------------------------------
// Independent reference oracle. It computes the structural selector semantics
// from scratch (provider tab ring, provider filter, scope corpus, fuzzy search)
// using plain array operations written differently from the reducer, so an
// agreement between the two is meaningful and not a copy of the same code.
// ---------------------------------------------------------------------------

interface OracleProjection {
	readonly scope: ModelScope;
	readonly activeProvider: string;
	readonly providerIds: readonly string[];
	readonly query: string;
	readonly visibleModelKeys: readonly string[];
}

interface Oracle {
	apply(action: ModelSelectorAction): void;
	project(): OracleProjection;
}

function isKnown(provider: string): boolean {
	return (KNOWN_PROVIDER_ORDER as readonly string[]).includes(provider);
}

function oracleProviderIds(models: readonly ModelSelectorModel[]): string[] {
	const present: string[] = [];
	for (const model of models) {
		if (!present.includes(model.provider)) present.push(model.provider);
	}
	const known = present
		.filter(isKnown)
		.sort(
			(a, b) =>
				(KNOWN_PROVIDER_ORDER as readonly string[]).indexOf(a) -
				(KNOWN_PROVIDER_ORDER as readonly string[]).indexOf(b),
		);
	const custom = present.filter((p) => !isKnown(p)).sort((a, b) => a.localeCompare(b));
	return [ALL_PROVIDER_TAB, ...known, ...custom];
}

function createOracle(initial: { scope: ModelScope; activeProvider: string }): Oracle {
	let scope = initial.scope;
	let activeProvider = initial.activeProvider;
	let query = "";
	let allModels: readonly ModelSelectorModel[] = [];
	let scopedModels: readonly ModelSelectorModel[] = [];

	const corpus = (): readonly ModelSelectorModel[] => (scope === "scoped" ? scopedModels : allModels);
	const providerIds = (): string[] => oracleProviderIds(corpus());
	const ensureProviderValid = (): void => {
		if (!providerIds().includes(activeProvider)) activeProvider = ALL_PROVIDER_TAB;
	};
	const visibleKeys = (): string[] => {
		const filtered =
			activeProvider === ALL_PROVIDER_TAB ? corpus() : corpus().filter((m) => m.provider === activeProvider);
		const searched = query ? fuzzyFilter([...filtered], query, searchText) : filtered;
		return searched.map(key);
	};

	return {
		apply(action) {
			switch (action.type) {
				case "REFRESH_MODELS":
					allModels = action.allModels;
					scopedModels = action.scopedModels;
					ensureProviderValid();
					break;
				case "NEXT_PROVIDER":
				case "PREVIOUS_PROVIDER": {
					const ids = providerIds();
					const direction = action.type === "NEXT_PROVIDER" ? 1 : -1;
					const index = Math.max(0, ids.indexOf(activeProvider));
					activeProvider = ids[(index + direction + ids.length) % ids.length] ?? ALL_PROVIDER_TAB;
					break;
				}
				case "TOGGLE_SCOPE_FORWARD":
				case "TOGGLE_SCOPE_BACKWARD":
					if (scopedModels.length > 0) {
						scope = scope === "all" ? "scoped" : "all";
						ensureProviderValid();
					}
					break;
				case "SEARCH":
					query = action.query;
					break;
				case "MOVE_SELECTION":
					// Selection-only: no effect on the structural projection.
					break;
			}
		},
		project() {
			return { scope, activeProvider, providerIds: providerIds(), query, visibleModelKeys: visibleKeys() };
		},
	};
}

// ---------------------------------------------------------------------------

function refresh(variantIndex: number): ModelSelectorAction {
	const variant = CORPUS_VARIANTS[variantIndex % CORPUS_VARIANTS.length] ?? CORPUS_VARIANTS[0];
	return { type: "REFRESH_MODELS", allModels: variant.allModels, scopedModels: variant.scopedModels };
}

function buildReducerState(): ModelSelectorState {
	return modelSelectorReducer(
		createInitialModelSelectorState({ scope: "all", activeProvider: ALL_PROVIDER_TAB }),
		refresh(0),
	);
}

function buildOracle(): Oracle {
	const oracle = createOracle({ scope: "all", activeProvider: ALL_PROVIDER_TAB });
	oracle.apply(refresh(0));
	return oracle;
}

function structural(state: ModelSelectorState): OracleProjection {
	return {
		scope: state.scope,
		activeProvider: state.activeProvider,
		providerIds: [...state.providerIds],
		query: state.query,
		visibleModelKeys: [...state.visibleModelKeys],
	};
}

function assertReducerInvariants(state: ModelSelectorState, context: string): void {
	expect(state.providerIds[0], `${context}: all first`).toBe(ALL_PROVIDER_TAB);
	expect(new Set(state.providerIds).size, `${context}: unique tabs`).toBe(state.providerIds.length);
	expect(state.providerIds, `${context}: active in tabs`).toContain(state.activeProvider);
	if (state.activeProvider !== ALL_PROVIDER_TAB) {
		for (const visible of state.visibleModelKeys) {
			expect(visible.startsWith(`${state.activeProvider}/`), `${context}: ${visible} scoped`).toBe(true);
		}
	}
	if (state.visibleModelKeys.length === 0) {
		expect(state.selectedIndex, `${context}: empty selection`).toBe(0);
	} else {
		expect(state.selectedIndex, `${context}: index >= 0`).toBeGreaterThanOrEqual(0);
		expect(state.selectedIndex, `${context}: index in range`).toBeLessThan(state.visibleModelKeys.length);
	}
}

function randomAction(rng: Rng): ModelSelectorAction {
	const roll = rng.nextFloat();
	if (roll < 0.2) return { type: "NEXT_PROVIDER" };
	if (roll < 0.36) return { type: "PREVIOUS_PROVIDER" };
	if (roll < 0.48) return { type: "TOGGLE_SCOPE_FORWARD" };
	if (roll < 0.58) return { type: "TOGGLE_SCOPE_BACKWARD" };
	if (roll < 0.68) return { type: "MOVE_SELECTION", delta: 1 };
	if (roll < 0.78) return { type: "MOVE_SELECTION", delta: -1 };
	if (roll < 0.9) return { type: "SEARCH", query: rng.pick(SEARCH_QUERIES) };
	return refresh(rng.nextInt(CORPUS_VARIANTS.length));
}

function describeAction(action: ModelSelectorAction): string {
	if (action.type === "SEARCH") return `SEARCH(${JSON.stringify(action.query)})`;
	if (action.type === "MOVE_SELECTION") return `MOVE(${action.delta})`;
	if (action.type === "REFRESH_MODELS") return `REFRESH(${action.allModels.length}/${action.scopedModels.length})`;
	return action.type;
}

function replay(commands: readonly ModelSelectorAction[]): void {
	let state = buildReducerState();
	const oracle = buildOracle();
	expect(structural(state), "init equivalence").toEqual(oracle.project());
	assertReducerInvariants(state, "init");

	commands.forEach((action, step) => {
		state = modelSelectorReducer(state, action);
		oracle.apply(action);
		const context = `step ${step} ${describeAction(action)}`;
		expect(structural(state), `${context}: equivalence`).toEqual(oracle.project());
		assertReducerInvariants(state, context);
	});
}

describe("modelSelectorReducer — model-based equivalence vs independent oracle", () => {
	it("matches the oracle and holds invariants across long random command sequences", () => {
		checkProperty<ModelSelectorAction[]>({
			seeds: [11, 23, 37, 101, 4242],
			numRuns: 25,
			generate: (rng) => Array.from({ length: 30 }, () => randomAction(rng)),
			predicate: replay,
			shrink: listShrink,
			format: (commands) => `[${commands.map(describeAction).join(", ")}]`,
		});
	});
});
