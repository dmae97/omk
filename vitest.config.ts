import { defineConfig } from "vitest/config";

// Preserve each package's source aliases and test environment from the repository root.
export default defineConfig({
	test: {
		projects: ["packages/*/vitest.config.ts"],
	},
});
