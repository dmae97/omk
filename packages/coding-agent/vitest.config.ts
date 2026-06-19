import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const aiSrcIndex = fileURLToPath(new URL("../ai/src/index.ts", import.meta.url));
const aiSrcOAuth = fileURLToPath(new URL("../ai/src/oauth.ts", import.meta.url));
const agentSrcIndex = fileURLToPath(new URL("../agent/src/index.ts", import.meta.url));
// Self-reference: resolve the package's own public entry to src in tests so
// example extensions importing "open-multi-agent-kit" see current source
// (matching tsconfig paths) instead of a stale prebuilt dist.
const selfSrcIndex = fileURLToPath(new URL("./src/index.ts", import.meta.url));
const selfHooksIndex = fileURLToPath(new URL("./src/core/hooks/index.ts", import.meta.url));

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		testTimeout: 30000,
		server: {
			deps: {
				external: [/@silvia-odwyer\/photon-node/],
			},
		},
	},
	resolve: {
		alias: [
			{ find: /^@earendil-works\/omk-ai$/, replacement: aiSrcIndex },
			{ find: /^@earendil-works\/omk-ai\/oauth$/, replacement: aiSrcOAuth },
			{ find: /^@earendil-works\/pi-agent-core$/, replacement: agentSrcIndex },
			{ find: /^@mariozechner\/omk-ai$/, replacement: aiSrcIndex },
			{ find: /^@mariozechner\/omk-ai\/oauth$/, replacement: aiSrcOAuth },
			{ find: /^@mariozechner\/pi-agent-core$/, replacement: agentSrcIndex },
			{ find: /^open-multi-agent-kit$/, replacement: selfSrcIndex },
			{ find: /^open-multi-agent-kit\/hooks$/, replacement: selfHooksIndex },
		],
	},
});
