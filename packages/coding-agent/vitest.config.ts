import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const tuiSrcIndex = fileURLToPath(new URL("../tui/src/index.ts", import.meta.url));
const aiSrcIndex = fileURLToPath(new URL("../ai/src/index.ts", import.meta.url));
const aiSrcOAuth = fileURLToPath(new URL("../ai/src/oauth.ts", import.meta.url));
const agentSrcIndex = fileURLToPath(new URL("../agent/src/index.ts", import.meta.url));
const protocolSrcIndex = fileURLToPath(new URL("../protocol/src/index.ts", import.meta.url));
const adaptorchWplSrcIndex = fileURLToPath(new URL("../adaptorch-wpl/src/index.ts", import.meta.url));

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		testTimeout: 30000,
		setupFiles: ["./test/setup-env.ts"],
		server: {
			deps: {
				external: [/@silvia-odwyer\/photon-node/],
			},
		},
	},
	resolve: {
		alias: [
			{ find: /^omk-tui$/, replacement: tuiSrcIndex },
			{ find: /^omk-protocol$/, replacement: protocolSrcIndex },
			{ find: /^omk-adaptorch-wpl$/, replacement: adaptorchWplSrcIndex },
			{ find: /^@earendil-works\/omk-ai$/, replacement: aiSrcIndex },
			{ find: /^@earendil-works\/omk-ai\/oauth$/, replacement: aiSrcOAuth },
			// Legacy compatibility bridges for pre-OMK pi-agent-core imports.
			{ find: /^@earendil-works\/pi-agent-core$/, replacement: agentSrcIndex },
			{ find: /^@mariozechner\/omk-ai$/, replacement: aiSrcIndex },
			{ find: /^@mariozechner\/omk-ai\/oauth$/, replacement: aiSrcOAuth },
			{ find: /^omk-agent-core$/, replacement: agentSrcIndex },
			{ find: /^@mariozechner\/pi-agent-core$/, replacement: agentSrcIndex },
		],
	},
});
