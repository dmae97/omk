import { describe, expect, it } from "bun:test";
import { buildSystemPrompt } from "@oh-my-pi/pi-coding-agent/system-prompt";

describe("buildSystemPrompt", () => {
	it("includes python tool details when enabled", async () => {
		const prompt = await buildSystemPrompt({
			cwd: "/tmp",
			toolNames: ["python"],
			contextFiles: [],
			skills: [],
			rules: [],
		});

		expect(prompt).toContain("The Python prelude has helpers for file I/O");
		expect(prompt).toContain("Do not run bash then read output then run more bash. Just use Python.");
	});
});
