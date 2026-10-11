import { describe, expect, it } from "vitest";
import { resolveExtendedSystemPromptCache } from "../src/core/system-prompt-cache-boundary.ts";

// Spec 052: an extension that only appends to the planned system prompt keeps the cache boundary.

const STABLE = "Stable operator instructions.";
const plan = { prompt: `${STABLE}\nCurrent date: 2026-10-11`, cacheBoundary: STABLE.length };
const kept = { cacheBoundary: STABLE.length, bypass: false };
const dropped = { cacheBoundary: undefined, bypass: true };

describe("resolveExtendedSystemPromptCache (spec 052)", () => {
	it("keeps the boundary when the prompt is unchanged", () => {
		expect(resolveExtendedSystemPromptCache(plan, plan.prompt)).toEqual(kept);
	});

	it("keeps the same boundary when text is appended after the whole plan", () => {
		expect(
			resolveExtendedSystemPromptCache(plan, `${plan.prompt}\n\n<finish_discipline>x</finish_discipline>`),
		).toEqual(kept);
	});

	it("drops the boundary for a replacement, an edit, a prepend or a changed dynamic suffix", () => {
		for (const prompt of [
			"Extension-controlled replacement.",
			plan.prompt.replace("operator", "Operator"),
			`Prefix.\n${plan.prompt}`,
			`${STABLE}\nCurrent date: 2026-10-12\n\nappended`,
		]) {
			expect(resolveExtendedSystemPromptCache(plan, prompt)).toEqual(dropped);
		}
	});

	it("never treats an empty plan as a prefix", () => {
		expect(resolveExtendedSystemPromptCache({ prompt: "", cacheBoundary: 0 }, "anything")).toEqual(dropped);
		expect(resolveExtendedSystemPromptCache({ prompt: "", cacheBoundary: undefined }, "")).toEqual({
			cacheBoundary: undefined,
			bypass: false,
		});
	});

	it("drops the boundary on a prefix match without a valid boundary", () => {
		const appended = `${plan.prompt}\nappended`;
		for (const cacheBoundary of [undefined, 0, -1, plan.prompt.length + 1, 1.5, Number.NaN]) {
			expect(resolveExtendedSystemPromptCache({ prompt: plan.prompt, cacheBoundary }, appended)).toEqual(dropped);
		}
	});
});
