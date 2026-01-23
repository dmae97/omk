import { describe, expect, test } from "bun:test";
import { buildSystemPrompt } from "$c/system-prompt";

describe("buildSystemPrompt", () => {
	describe("empty tools", () => {
		test("shows (none) for empty tools list", async () => {
			const prompt = await buildSystemPrompt({
				toolNames: [],
				contextFiles: [],
				skills: [],
			});

			// System prompt uses <tools> XML tag format
			expect(prompt).toContain("<tools>\n(none)\n</tools>");
		});

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

	describe("default tools", () => {
		test("includes all default tools", async () => {
			const prompt = await buildSystemPrompt({
				contextFiles: [],
				skills: [],
			});

			expect(prompt).toContain("- read:");
			expect(prompt).toContain("- bash:");
			expect(prompt).toContain("- edit:");
			expect(prompt).toContain("- write:");
		});
	});
});
