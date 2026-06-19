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

function key(model: ModelSelectorModel): string {
	return `${model.provider}/${model.id}`;
}

// Corpus mixes four known providers (anthropic, openai, google, kimi) with two
// custom providers (acme, zeta-labs) so we can assert the
// "custom-after-known-lexicographic" ordering rule.
const ALL_MODELS: readonly ModelSelectorModel[] = [
	{ provider: "anthropic", id: "claude-opus", name: "Claude Opus" },
	{ provider: "anthropic", id: "claude-haiku", name: "Claude Haiku" },
	{ provider: "openai", id: "gpt-5", name: "GPT-5" },
	{ provider: "openai", id: "gpt-4o-mini", name: "GPT-4o mini" },
	{ provider: "google", id: "gemini-pro", name: "Gemini Pro" },
	{ provider: "kimi", id: "kimi-k2", name: "Kimi K2" },
	{ provider: "zeta-labs", id: "zeta-one", name: "Zeta One" },
	{ provider: "acme", id: "acme-fast", name: "Acme Fast" },
];

const SCOPED_MODELS: readonly ModelSelectorModel[] = [
	{ provider: "anthropic", id: "claude-opus", name: "Claude Opus" },
	{ provider: "kimi", id: "kimi-k2", name: "Kimi K2" },
	{ provider: "acme", id: "acme-fast", name: "Acme Fast" },
];

function refreshAction(
	allModels: readonly ModelSelectorModel[] = ALL_MODELS,
	scopedModels: readonly ModelSelectorModel[] = SCOPED_MODELS,
	currentModelKey?: string,
): ModelSelectorAction {
	return { type: "REFRESH_MODELS", allModels, scopedModels, currentModelKey };
}

function loadedState(options?: {
	scope?: ModelScope;
	activeProvider?: string;
	currentModelKey?: string;
}): ModelSelectorState {
	const initial = createInitialModelSelectorState({
		scope: options?.scope ?? "all",
		activeProvider: options?.activeProvider ?? ALL_PROVIDER_TAB,
	});
	return modelSelectorReducer(initial, refreshAction(ALL_MODELS, SCOPED_MODELS, options?.currentModelKey));
}

function corpusFor(state: ModelSelectorState): readonly ModelSelectorModel[] {
	return state.scope === "scoped" ? state.scopedModels : state.allModels;
}

/**
 * The seven contract invariants every reducer state must satisfy after any
 * action. These are independent of the reducer's own implementation so they
 * catch regressions instead of restating the code.
 */
function assertInvariants(state: ModelSelectorState, context: string): void {
	// 1. "all" is always the first provider tab.
	expect(state.providerIds[0], `${context}: providerIds[0]`).toBe(ALL_PROVIDER_TAB);

	// 2. providerIds has no duplicates.
	expect(new Set(state.providerIds).size, `${context}: provider uniqueness`).toBe(state.providerIds.length);

	// 3. activeProvider is always a member of providerIds.
	expect(state.providerIds, `${context}: activeProvider membership`).toContain(state.activeProvider);

	// 4. A concrete provider restricts every visible model to that provider.
	if (state.activeProvider !== ALL_PROVIDER_TAB) {
		for (const visibleKey of state.visibleModelKeys) {
			expect(visibleKey.startsWith(`${state.activeProvider}/`), `${context}: ${visibleKey} provider scope`).toBe(
				true,
			);
		}
	}

	// 5. selectedIndex is in range, or 0 for an empty visible list.
	if (state.visibleModelKeys.length === 0) {
		expect(state.selectedIndex, `${context}: empty selection`).toBe(0);
	} else {
		expect(state.selectedIndex, `${context}: selectedIndex lower bound`).toBeGreaterThanOrEqual(0);
		expect(state.selectedIndex, `${context}: selectedIndex upper bound`).toBeLessThan(state.visibleModelKeys.length);
	}

	// 6. Visible models are always a subset of the active corpus.
	const corpusKeys = new Set(corpusFor(state).map(key));
	for (const visibleKey of state.visibleModelKeys) {
		expect(corpusKeys.has(visibleKey), `${context}: ${visibleKey} in corpus`).toBe(true);
	}

	// 7. Known providers precede custom providers, and customs are lexicographic.
	const providerTabs = state.providerIds.filter((p) => p !== ALL_PROVIDER_TAB);
	const customTabs = providerTabs.filter((p) => !KNOWN_PROVIDER_ORDER.includes(p as never));
	const knownTabs = providerTabs.filter((p) => KNOWN_PROVIDER_ORDER.includes(p as never));
	if (knownTabs.length > 0 && customTabs.length > 0) {
		const lastKnownIndex = providerTabs.indexOf(knownTabs[knownTabs.length - 1]);
		const firstCustomIndex = providerTabs.indexOf(customTabs[0]);
		expect(firstCustomIndex, `${context}: custom-after-known`).toBeGreaterThan(lastKnownIndex);
	}
	expect([...customTabs], `${context}: custom lexicographic`).toEqual(
		[...customTabs].sort((a, b) => a.localeCompare(b)),
	);
}

describe("modelSelectorReducer — initial state", () => {
	it("starts empty with the all tab", () => {
		const state = createInitialModelSelectorState();
		expect(state.scope).toBe("all");
		expect(state.activeProvider).toBe(ALL_PROVIDER_TAB);
		expect(state.providerIds).toEqual([ALL_PROVIDER_TAB]);
		expect(state.visibleModelKeys).toEqual([]);
		expect(state.selectedIndex).toBe(0);
		assertInvariants(state, "initial");
	});
});

describe("modelSelectorReducer — REFRESH_MODELS", () => {
	it("orders known providers first then custom providers lexicographically", () => {
		const state = loadedState();
		expect(state.providerIds).toEqual([
			ALL_PROVIDER_TAB,
			"anthropic",
			"openai",
			"google",
			"kimi",
			"acme",
			"zeta-labs",
		]);
		assertInvariants(state, "refresh");
	});

	it("selects the current model when its key is present", () => {
		const state = loadedState({ currentModelKey: "kimi/kimi-k2" });
		expect(state.visibleModelKeys[state.selectedIndex]).toBe("kimi/kimi-k2");
	});

	it("falls back to the all tab when the restored provider disappears", () => {
		const initial = createInitialModelSelectorState({ activeProvider: "kimi" });
		const present = modelSelectorReducer(initial, refreshAction());
		expect(present.activeProvider).toBe("kimi");

		const withoutKimi = ALL_MODELS.filter((model) => model.provider !== "kimi");
		const gone = modelSelectorReducer(present, refreshAction(withoutKimi, []));
		expect(gone.activeProvider).toBe(ALL_PROVIDER_TAB);
		assertInvariants(gone, "refresh-fallback");
	});
});

describe("modelSelectorReducer — provider cycling", () => {
	it("NEXT then PREVIOUS returns to the original provider", () => {
		const start = loadedState();
		const forward = modelSelectorReducer(start, { type: "NEXT_PROVIDER" });
		expect(forward.activeProvider).toBe("anthropic");
		const back = modelSelectorReducer(forward, { type: "PREVIOUS_PROVIDER" });
		expect(back.activeProvider).toBe(start.activeProvider);
		expect(back.providerIds).toEqual(start.providerIds);
	});

	it("wraps around the provider ring", () => {
		let state = loadedState();
		const ringLength = state.providerIds.length;
		for (let i = 0; i < ringLength; i++) {
			state = modelSelectorReducer(state, { type: "NEXT_PROVIDER" });
			assertInvariants(state, `cycle-${i}`);
		}
		expect(state.activeProvider).toBe(ALL_PROVIDER_TAB);
	});

	it("resets selection to the top of the new provider list", () => {
		let state = loadedState();
		state = modelSelectorReducer(state, { type: "MOVE_SELECTION", delta: 1 });
		state = modelSelectorReducer(state, { type: "NEXT_PROVIDER" });
		expect(state.selectedIndex).toBe(0);
		expect(state.visibleModelKeys.every((k) => k.startsWith("anthropic/"))).toBe(true);
	});
});

describe("modelSelectorReducer — SEARCH", () => {
	it("never changes the provider tabs", () => {
		const base = modelSelectorReducer(loadedState(), { type: "NEXT_PROVIDER" });
		const searched = modelSelectorReducer(base, { type: "SEARCH", query: "gpt" });
		expect(searched.providerIds).toEqual(base.providerIds);
		expect(searched.activeProvider).toBe(base.activeProvider);
	});

	it("searches only inside the active provider", () => {
		const anthropic = modelSelectorReducer(loadedState(), { type: "NEXT_PROVIDER" });
		expect(anthropic.activeProvider).toBe("anthropic");
		const searched = modelSelectorReducer(anthropic, { type: "SEARCH", query: "gpt" });
		expect(searched.query).toBe("gpt");
		expect(searched.visibleModelKeys).toHaveLength(0);
		expect(searched.visibleModelKeys).not.toContain("openai/gpt-5");
	});

	it("clamps selection when the result list shrinks", () => {
		let state = loadedState();
		state = modelSelectorReducer(state, { type: "MOVE_SELECTION", delta: 1 });
		state = modelSelectorReducer(state, { type: "MOVE_SELECTION", delta: 1 });
		const searched = modelSelectorReducer(state, { type: "SEARCH", query: "claude-opus" });
		assertInvariants(searched, "search-clamp");
		expect(searched.visibleModelKeys).toEqual(["anthropic/claude-opus"]);
		expect(searched.selectedIndex).toBe(0);
	});
});

describe("modelSelectorReducer — scope toggle", () => {
	it("flips between all and scoped and back", () => {
		const scoped = loadedState({ scope: "scoped" });
		expect(scoped.scope).toBe("scoped");
		expect(scoped.providerIds).toEqual([ALL_PROVIDER_TAB, "anthropic", "kimi", "acme"]);

		const toAll = modelSelectorReducer(scoped, { type: "TOGGLE_SCOPE_FORWARD" });
		expect(toAll.scope).toBe("all");
		assertInvariants(toAll, "scope-all");

		const backToScoped = modelSelectorReducer(toAll, { type: "TOGGLE_SCOPE_BACKWARD" });
		expect(backToScoped.scope).toBe("scoped");
		expect(backToScoped.providerIds).toEqual([ALL_PROVIDER_TAB, "anthropic", "kimi", "acme"]);
	});

	it("is a no-op when there are no scoped models", () => {
		const initial = createInitialModelSelectorState();
		const loaded = modelSelectorReducer(initial, refreshAction(ALL_MODELS, []));
		const toggled = modelSelectorReducer(loaded, { type: "TOGGLE_SCOPE_FORWARD" });
		expect(toggled.scope).toBe("all");
		expect(toggled).toBe(loaded);
	});
});

describe("modelSelectorReducer — MOVE_SELECTION", () => {
	it("wraps from top to bottom and bottom to top", () => {
		const state = loadedState();
		const len = state.visibleModelKeys.length;
		const up = modelSelectorReducer(state, { type: "MOVE_SELECTION", delta: -1 });
		expect(up.selectedIndex).toBe(len - 1);
		const downFromTop = modelSelectorReducer(
			{ ...state, selectedIndex: len - 1 },
			{ type: "MOVE_SELECTION", delta: 1 },
		);
		expect(downFromTop.selectedIndex).toBe(0);
	});

	it("is a no-op on an empty visible list", () => {
		const empty = modelSelectorReducer(loadedState(), { type: "SEARCH", query: "no-such-model-xyz" });
		expect(empty.visibleModelKeys).toHaveLength(0);
		const moved = modelSelectorReducer(empty, { type: "MOVE_SELECTION", delta: 1 });
		expect(moved.selectedIndex).toBe(0);
	});
});

describe("modelSelectorReducer — seeded property fuzz", () => {
	function mulberry32(seed: number): () => number {
		let a = seed >>> 0;
		return () => {
			a |= 0;
			a = (a + 0x6d2b79f5) | 0;
			let t = Math.imul(a ^ (a >>> 15), 1 | a);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}

	const QUERIES = ["", "gpt", "claude", "kimi", "zeta", "acme", "5", "mini", "no-match-xyz"];

	function randomAction(rng: () => number): ModelSelectorAction {
		const roll = rng();
		if (roll < 0.22) return { type: "NEXT_PROVIDER" };
		if (roll < 0.4) return { type: "PREVIOUS_PROVIDER" };
		if (roll < 0.52) return { type: "TOGGLE_SCOPE_FORWARD" };
		if (roll < 0.62) return { type: "TOGGLE_SCOPE_BACKWARD" };
		if (roll < 0.72) return { type: "MOVE_SELECTION", delta: 1 };
		if (roll < 0.82) return { type: "MOVE_SELECTION", delta: -1 };
		if (roll < 0.94) return { type: "SEARCH", query: QUERIES[Math.floor(rng() * QUERIES.length)] ?? "" };
		// Occasionally refresh with a randomly reduced corpus to exercise fallback.
		const drop = ALL_MODELS[Math.floor(rng() * ALL_MODELS.length)];
		const reduced = ALL_MODELS.filter((model) => model.provider !== drop.provider);
		const reducedScope = SCOPED_MODELS.filter((model) => model.provider !== drop.provider);
		return refreshAction(reduced, reducedScope);
	}

	for (const seed of [1, 7, 42, 1337, 90210]) {
		it(`holds invariants across 200 actions (seed ${seed})`, () => {
			const rng = mulberry32(seed);
			let state = loadedState({ currentModelKey: "anthropic/claude-opus" });
			assertInvariants(state, `seed-${seed}-init`);
			for (let step = 0; step < 200; step++) {
				const action = randomAction(rng);
				state = modelSelectorReducer(state, action);
				assertInvariants(state, `seed-${seed}-step-${step}-${action.type}`);
			}
		});
	}
});
