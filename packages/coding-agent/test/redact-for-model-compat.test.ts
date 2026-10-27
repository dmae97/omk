import { describe, expect, it } from "vitest";
import { redactForModel } from "../src/index.ts";

describe("redactForModel 1.5.x compat export", () => {
	it("is exported from the package root", () => {
		expect(typeof redactForModel).toBe("function");
	});

	it("masks bearer tokens and secret query params like v1.5.4", () => {
		const out = redactForModel("Authorization: Bearer abcdefgh12345678 url?token=xyz&api_key=k1") as string;
		expect(out).toContain("Bearer [REDACTED]");
		expect(out).toContain("token=[REDACTED]");
		expect(out).toContain("api_key=[REDACTED]");
		expect(out).not.toContain("abcdefgh12345678");
	});

	it("masks non-public keys and recurses into arrays", () => {
		const out = redactForModel([{ HOME: "/home/x", API_KEY: "k" }]) as Array<Record<string, unknown>>;
		expect(out[0].API_KEY).toBe("[REDACTED]");
	});
});
