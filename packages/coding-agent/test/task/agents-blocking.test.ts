import { describe, expect, it } from "bun:test";
import { clearBundledAgentsCache, getBundledAgent } from "../../src/task/agents";

describe("bundled agent frontmatter parsing", () => {
	it("marks reviewer as blocking", () => {
		clearBundledAgentsCache();
		const reviewer = getBundledAgent("reviewer");
		expect(reviewer).toBeDefined();
		expect(reviewer?.blocking).toBe(true);
	});
});
