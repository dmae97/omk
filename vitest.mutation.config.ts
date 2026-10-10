import { fileURLToPath } from "node:url";
import { mergeConfig } from "vitest/config";
import base from "./packages/coding-agent/vitest.config.ts";

export default mergeConfig(base, {
	root: fileURLToPath(new URL("./packages/coding-agent", import.meta.url)),
	test: {
		include: ["test/prompt-settlement.test.ts", "test/session-prompt-lifecycle.test.ts"],
		setupFiles: [fileURLToPath(new URL("./packages/coding-agent/test/setup-env.ts", import.meta.url))],
	},
});
