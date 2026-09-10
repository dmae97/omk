import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

test("Codex turn metadata remains browser-bundleable without Node path polyfills", async () => {
	const result = await build({
		entryPoints: ["packages/ai/src/providers/codex-turn-metadata.ts"],
		bundle: true,
		platform: "browser",
		format: "esm",
		write: false,
		logLevel: "silent",
	});
	assert.equal(result.outputFiles.length, 1);
});
