import { describe, expect, test } from "bun:test";
import { buildSystemPrompt } from "$c/system-prompt";

describe("buildSystemPrompt", () => {
	describe("empty tools", () => {
		test("includes core principles even with no tools", async () => {
			const prompt = await buildSystemPrompt({
				toolNames: [],
				contextFiles: [],
				skills: [],
			});

			// Core <field> principles are always present regardless of tools
			expect(prompt).toContain("Code is frozen thought");
		});
	});

	describe("tools available", () => {
		test("mentions specialized tools when available", async () => {
			const prompt = await buildSystemPrompt({
				contextFiles: [],
				skills: [],
			});

			expect(prompt).toContain("`read`");
			expect(prompt).toContain("`edit`");
		});
	});
});
