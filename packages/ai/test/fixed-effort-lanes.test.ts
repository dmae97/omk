import { describe, expect, it } from "vitest";
import { cursorModels } from "../scripts/catalog-cursor.ts";
import { devinModels } from "../scripts/catalog-devin.ts";
import { MODELS } from "../src/models.generated.ts";
import type { Api, Model } from "../src/types.ts";

/**
 * Cursor and Devin publish one wire id per effort tier (`claude-fable-5-1-high`,
 * `gpt-5.3-codex-xhigh`, ...). Their static catalogs already encode the exact tier
 * each id carries, so the family-wide thinking passes in generate-models.ts
 * (Fable → xhigh/max, Opus 5 → full ladder, GPT-5.6 → max, ...) must leave those
 * entries untouched. A full regeneration used to widen them, advertising `max` on
 * a lane whose effort is fixed by its id.
 */
const lanes = [
	{ provider: "cursor", source: cursorModels },
	{ provider: "devin", source: devinModels },
] as const;

function byId(models: readonly Model<Api>[]): Map<string, Model<Api>> {
	return new Map(models.map((model) => [model.id, model]));
}

describe("fixed-effort lanes in the generated catalog", () => {
	it.each(lanes)("keeps every $provider entry identical to its static catalog", ({ provider, source }) => {
		const generated = byId(Object.values((MODELS as Record<string, Record<string, Model<Api>>>)[provider]));
		const expected = byId(source());
		expect([...generated.keys()].sort()).toEqual([...expected.keys()].sort());
		for (const [id, model] of expected) {
			expect(generated.get(id), `${provider}/${id}`).toEqual(model);
		}
	});

	it.each(lanes)("never advertises a second effort tier on a fixed $provider lane", ({ provider }) => {
		for (const model of Object.values((MODELS as Record<string, Record<string, Model<Api>>>)[provider])) {
			const map = model.thinkingLevelMap;
			if (!model.reasoning) {
				expect(map, `${provider}/${model.id}`).toBeUndefined();
				continue;
			}
			// Some Devin logical models legitimately expose more than one tier; a lane whose id
			// names its tier (`-low`, `-high`, `-xhigh`, `-max`, ...) must expose exactly that one.
			const suffix = /-(minimal|low|medium|high|xhigh|max)(?:-fast)?$/.exec(model.id)?.[1];
			if (!suffix || !map) continue;
			const enabled = Object.entries(map).filter(([, value]) => typeof value === "string");
			expect(enabled, `${provider}/${model.id}`).toEqual([[suffix, suffix]]);
		}
	});
});
