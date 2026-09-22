import { expect, it } from "vitest";
import * as api from "../src/index.ts";
import { atom, input, relation } from "./atomic-commit-fixtures.ts";

it("exposes atomic commit planning through the agent API", () => {
	expect("planAtomicCommits" in api).toBe(true);
});

it("runs dependency planning and ownership refusal through the real public API", () => {
	const value: api.CommitPlannerInput = input(
		[atom("api"), atom("consumer")],
		[relation("depends", "consumer", "api")],
	);
	expect(api.planAtomicCommits(value).validationOrder).toEqual(["g:api", "g:consumer"]);
	const untrusted = { ...value, atoms: [atom("api", { receiptId: null }), atom("consumer")] };
	expect(api.planAtomicCommits(untrusted).validationOrder).toEqual([]);
});
