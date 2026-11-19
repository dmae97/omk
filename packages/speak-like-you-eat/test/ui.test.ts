// Source: https://github.com/wtfzambo/speak-like-you-eat (MIT), adapted for OMK.
import type { ModelRegistry, Theme } from "open-multi-agent-kit";
import { describe, expect, it } from "vitest";
import { buildTabbedCard } from "../src/cards.ts";
import { filterModelCandidates, formatModelCandidate, selectModelCandidates } from "../src/model-picker.ts";

type OmkModel = NonNullable<ReturnType<ModelRegistry["find"]>>;
const model = (provider: string, id: string, reasoning = false) =>
	({ provider, id, name: `${id} name`, reasoning }) as OmkModel;

describe("SLYE model and card UI", () => {
	it("selects authenticated usable models once in stable order", () => {
		const candidates = selectModelCandidates(
			[model("z", "last"), model("a", "first"), model("a", "first"), model("skip", "unauthenticated")],
			(candidate) => candidate.provider !== "skip",
		);
		expect(candidates.map((candidate) => `${candidate.provider}/${candidate.id}`)).toEqual(["a/first", "z/last"]);
		expect(filterModelCandidates(candidates, "z last").map((candidate) => candidate.id)).toEqual(["last"]);
		expect(formatModelCandidate(candidates[0]!)).toBe("a/first, thinking: off");
	});
	it("renders the selected ELI5 or Light card with its model label", () => {
		let active: "rewrite" | "simple" = "rewrite";
		const theme = {
			bg: (_name: string, text: string) => text,
			fg: (_name: string, text: string) => text,
			bold: (text: string) => text,
		} as Theme;
		const card = buildTabbedCard(theme, "Light body", "ELI5 body", () => active, "Plain model");
		expect(card.render(100).join("\n")).toContain("ELI5 body");
		expect(card.render(100).join("\n")).toContain("Plain model");
		active = "simple";
		const rendered = card.render(100).join("\n");
		expect(rendered).toContain("Light body");
		expect(rendered).not.toContain("ELI5 body");
	});
});
