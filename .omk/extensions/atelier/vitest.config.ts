import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = new URL("../../../", import.meta.url);
export default defineConfig({
	test: { include: ["test/**/*.test.ts"], testTimeout: 30000, maxWorkers: 1 },
	resolve: {
		alias: {
			"open-multi-agent-kit": fileURLToPath(new URL("packages/coding-agent/src/index.ts", root)),
			"omk-tui": fileURLToPath(new URL("packages/tui/src/index.ts", root)),
			"omk-ai/oauth": fileURLToPath(new URL("packages/ai/src/oauth.ts", root)),
			"omk-ai/prompt-hash": fileURLToPath(new URL("packages/ai/src/prompt-hash.ts", root)),
			"omk-ai": fileURLToPath(new URL("packages/ai/src/index.ts", root)),
			"omk-agent-core/node": fileURLToPath(new URL("packages/agent/src/node.ts", root)),
			"omk-agent-core": fileURLToPath(new URL("packages/agent/src/index.ts", root)),
		},
	},
});
