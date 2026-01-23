import { describe, expect, it } from "bun:test";
import { buildSystemPrompt } from "../../src/core/system-prompt";

describe("buildSystemPrompt", () => {
	it("includes python tool details when enabled", async () => {
		const prompt = await buildSystemPrompt({
			cwd: "/tmp",
			toolNames: ["python"],
			contextFiles: [],
			skills: [],
			rules: [],
		});

		expect(prompt).toContain("**python:** stateful scripting and REPL work");
		expect(prompt).toContain("What python IS for");
	});
});
