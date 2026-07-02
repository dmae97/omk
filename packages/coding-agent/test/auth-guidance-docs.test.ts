import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("API key auth documentation", () => {
	it("does not make manual shell export the API-key onboarding path", () => {
		const readme = readFileSync(join(import.meta.dirname, "..", "README.md"), "utf8");

		expect(readme).not.toMatch(/export\s+ANTHROPIC_API_KEY=/);
		expect(readme).toContain("/login");
	});
});
