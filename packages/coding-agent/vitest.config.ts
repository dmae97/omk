import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const aiSrcIndex = fileURLToPath(new URL("../ai/src/index.ts", import.meta.url));
const aiSrcOAuth = fileURLToPath(new URL("../ai/src/oauth.ts", import.meta.url));
const agentSrcIndex = fileURLToPath(new URL("../agent/src/index.ts", import.meta.url));

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
			{ find: /^@earendil-works\/omk-agent-core$/, replacement: agentSrcIndex },
			{ find: /^@mariozechner\/omk-ai$/, replacement: aiSrcIndex },
			{ find: /^@mariozechner\/omk-ai\/oauth$/, replacement: aiSrcOAuth },
			{ find: /^@mariozechner\/omk-agent-core$/, replacement: agentSrcIndex },
		],
	},
});
