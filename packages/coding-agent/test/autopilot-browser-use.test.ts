import { describe, expect, it } from "vitest";
import { BrowserUseAgent } from "../src/core/browser-use.ts";

describe("BrowserUseAgent autopilot verification", () => {
	it("does not report a fixed success score when observation fails", async () => {
		const agent = new BrowserUseAgent();

		const result = await agent.execute({
			url: "http://127.0.0.1:9/omk-autopilot-unreachable",
			task: "Verify text that cannot be observed",
			sessionId: "autopilot-red",
		});

		expect(result.success).toBe(false);
		expect(result.overallScore).toBeLessThan(0.6);
	});
});
