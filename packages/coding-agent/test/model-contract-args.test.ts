import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/cli/args.ts";

describe("explicit model contract CLI flag", () => {
	it.each([["--model-contract", "policy.json"], ["--model-contract=policy.json"]].map((args) => ({ args })))(
		"parses %j as a built-in flag",
		({ args }) => {
			const parsed = parseArgs(args);
			expect(parsed).toMatchObject({ modelContractFile: "policy.json", diagnostics: [] });
			expect(parsed.unknownFlags.size).toBe(0);
		},
	);

	it.each(
		[
			["--model-contract"],
			["--model-contract", "--print"],
			["--model-contract="],
			["--model-contract", "a.json", "--model-contract", "b.json"],
		].map((args) => ({ args })),
	)("refuses malformed or duplicate flags %j", ({ args }) => {
		const parsed = parseArgs(args);
		expect(parsed.diagnostics.some((diagnostic) => diagnostic.type === "error")).toBe(true);
	});
});
