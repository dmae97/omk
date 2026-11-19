import assert from "node:assert/strict";
import { appendFileSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import * as agent from "omk-agent-core";
import * as agentNode from "omk-agent-core/node";
import * as ai from "omk-ai";
import * as oauth from "omk-ai/oauth";
import { systemHash } from "omk-ai/prompt-hash";
import * as protocol from "omk-protocol";
import * as tui from "omk-tui";
import * as wpl from "omk-adaptorch-wpl";
import * as book from "omk-book-to-skill";
import { AuthStorage, createAgentSession, DefaultResourceLoader, ModelRegistry, SessionManager, SettingsManager } from "open-multi-agent-kit";

const agentDir = process.env.OMK_CODING_AGENT_DIR;
const record = (event) => appendFileSync(process.env.NATIVE_ARTIFACT_RECEIPT, `${JSON.stringify(event)}\n`);
for (const namespace of [agent, agentNode, ai, oauth, protocol, tui, wpl, book]) assert(Object.keys(namespace).length > 0);
assert.equal(systemHash({ systemPrompt: "" }), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
assert.equal(process.env.NODE_PATH, undefined);
assert.equal(process.env.NODE_OPTIONS, undefined);
for (const cwd of [process.cwd(), join(process.cwd(), "replacement")]) {
	if (cwd !== process.cwd()) {
		mkdirSync(join(cwd, ".git"), { recursive: true });
		for (const name of ["extension.ts", "route.mjs", "cache-control.ts"]) copyFileSync(join(process.cwd(), name), join(cwd, name));
	}
	const settingsManager = SettingsManager.inMemory({ packages: [], quietStartup: true, compaction: { enabled: false } });
	const options = { cwd, agentDir, settingsManager, packageManifestDialect: "omk", additionalExtensionPaths: [join(cwd, "extension.ts")],
		noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true };
	const loader = new DefaultResourceLoader(options);
	options.packageManifestDialect = "omk+pi";
	await loader.reload();
	assert.deepEqual(loader.getExtensions().errors, []);
	const authStorage = AuthStorage.inMemory();
	const modelRegistry = ModelRegistry.create(authStorage, join(agentDir, "models.json"));
	const { session, extensionsResult } = await createAgentSession({ cwd, agentDir, authStorage, modelRegistry, settingsManager, resourceLoader: loader, sessionManager: SessionManager.inMemory(cwd), noTools: "builtin" });
	try {
		assert.equal(extensionsResult.runtime.providerOwners.get("native-artifact-fixture"), join(cwd, "extension.ts"));
		assert.deepEqual(extensionsResult.runtime.pendingProviderRegistrations, []);
		record({ event: "owner", path: extensionsResult.runtime.providerOwners.get("native-artifact-fixture") });
		const model = modelRegistry.find("native-artifact-fixture", "offline");
		assert(model, "synthetic model must be registered by the loaded extension");
		await session.setModel(model);
		await session.bindExtensions({ mode: "print", onError: (error) => { throw new Error(error.message); } });
		await session.prompt("run the offline artifact fixture");
		await session.reload();
		assert.equal(loader.getExtensions().runtime.providerOwners.get("native-artifact-fixture"), join(cwd, "extension.ts"));
		await session.prompt("run the offline artifact fixture after reload");
		record({ event: "sdk", injectedLoader: true, reload: true, replacement: cwd !== process.cwd(), owner: join(cwd, "extension.ts"), roots: ["open-multi-agent-kit", "omk-ai", "omk-agent-core", "omk-tui", "omk-protocol", "omk-adaptorch-wpl", "omk-book-to-skill"] });
	} finally { await session.close(); session.dispose(); }
}
