import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

const defaultMaxWorkers = process.env.VITEST_MAX_WORKERS || !tmpdir().startsWith("/mnt/") ? undefined : 4;

const tuiSrcIndex = fileURLToPath(new URL("../tui/src/index.ts", import.meta.url));
const aiSrcIndex = fileURLToPath(new URL("../ai/src/index.ts", import.meta.url));
const aiSrcOAuth = fileURLToPath(new URL("../ai/src/oauth.ts", import.meta.url));
const agentSrcIndex = fileURLToPath(new URL("../agent/src/index.ts", import.meta.url));
const protocolSrcIndex = fileURLToPath(new URL("../protocol/src/index.ts", import.meta.url));
const adaptorchWplSrcIndex = fileURLToPath(new URL("../adaptorch-wpl/src/index.ts", import.meta.url));
const selfSrcIndex = fileURLToPath(new URL("./src/index.ts", import.meta.url));
const selfSrcHooks = fileURLToPath(new URL("./src/core/hooks/index.ts", import.meta.url));

export default defineConfig({
	test: {
		// Bundled pstack keeps upstream Bun/Node test suites for opt-in upstream use.
		exclude: [...configDefaults.exclude, "dist/**", "resources/pstack/**"],
		globals: true,
		environment: "node",
		testTimeout: 30000,
		...(defaultMaxWorkers ? { maxWorkers: defaultMaxWorkers } : {}),
		globalSetup: ["./test/global-setup-home.ts"],
		setupFiles: ["./test/setup-env.ts"],
		server: {
			deps: {
				external: [/@silvia-odwyer\/photon-node/],
			},
		},
	},
	resolve: {
		alias: [
			// Examples import this package by name; without these the name resolved through node_modules to
			// dist/, which an unbuilt checkout lacks and a built one holds as a stale, separate module copy.
			{ find: /^open-multi-agent-kit$/, replacement: selfSrcIndex },
			{ find: /^open-multi-agent-kit\/hooks$/, replacement: selfSrcHooks },
			{ find: /^omk-tui$/, replacement: tuiSrcIndex },
			{ find: /^omk-protocol$/, replacement: protocolSrcIndex },
			{ find: /^omk-adaptorch-wpl$/, replacement: adaptorchWplSrcIndex },
			{ find: /^omk-ai$/, replacement: aiSrcIndex },
			{ find: /^omk-ai\/oauth$/, replacement: aiSrcOAuth },
			{ find: /^omk-ai\/prompt-hash$/, replacement: fileURLToPath(new URL("../ai/src/prompt-hash.ts", import.meta.url)) },
			{ find: /^@earendil-works\/omk-ai$/, replacement: aiSrcIndex },
			{ find: /^@earendil-works\/omk-ai\/oauth$/, replacement: aiSrcOAuth },
			// Legacy compatibility bridges for pre-OMK pi-agent-core imports.
			{ find: /^@earendil-works\/pi-agent-core$/, replacement: agentSrcIndex },
			{ find: /^@mariozechner\/omk-ai$/, replacement: aiSrcIndex },
			{ find: /^@mariozechner\/omk-ai\/oauth$/, replacement: aiSrcOAuth },
			{ find: /^omk-agent-core$/, replacement: agentSrcIndex },
			{ find: /^omk-agent-core\/node$/, replacement: fileURLToPath(new URL("../agent/src/node.ts", import.meta.url)) },
			{ find: /^@mariozechner\/pi-agent-core$/, replacement: agentSrcIndex },
		],
	},
});
