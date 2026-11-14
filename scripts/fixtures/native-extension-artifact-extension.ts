import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { Agent } from "omk-agent-core";
import * as agentNode from "omk-agent-core/node";
import { createAssistantMessageEventStream, Type } from "omk-ai";
import * as oauth from "omk-ai/oauth";
import { systemHash } from "omk-ai/prompt-hash";
import * as tui from "omk-tui";
import { DefaultResourceLoader, defineTool, type ExtensionAPI, SettingsManager } from "open-multi-agent-kit";
import { identity, lateIdentity } from "./route.mjs";

const receipt = process.env.NATIVE_ARTIFACT_RECEIPT;
assert(receipt, "explicit artifact receipt path required");
const record = (event: object) => appendFileSync(receipt, `${JSON.stringify(event)}\n`);
let networkAttempts = 0;
const deny = () => { networkAttempts++; throw new Error("artifact fixture network denied"); };
globalThis.fetch = deny;
net.Socket.prototype.connect = deny;
tls.connect = deny;
http.request = deny;
http.get = deny;
https.request = deny;
https.get = deny;
process.on("exit", () => record({ event: "network", attempts: networkAttempts }));

export default function artifactExtension(api: ExtensionAPI) {
	assert.equal(typeof DefaultResourceLoader, "function");
	assert.equal(typeof defineTool, "function");
	assert.equal(typeof Agent, "function");
	assert(Object.keys(agentNode).length > 0 && Object.keys(oauth).length > 0 && Object.keys(tui).length > 0);
	assert.equal(systemHash({ systemPrompt: "" }), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
	record({ event: "factory", identity, namespace: true, subpaths: ["omk-ai/prompt-hash", "omk-ai/oauth", "omk-agent-core/node"], owner: import.meta.url });
	record({ event: "environment", HOME: process.env.HOME, agentDir: process.env.OMK_CODING_AGENT_DIR, cwd: process.cwd(), NODE_PATH: process.env.NODE_PATH ?? null, NODE_OPTIONS: process.env.NODE_OPTIONS ?? null });
	api.registerTool(defineTool({ name: "artifact_increment", label: "Artifact increment", description: "Increment the offline fixture input",
		parameters: Type.Object({ value: Type.Number() }),
		execute: async (_id, args, _signal, _update, ctx) => {
			assert.equal(args.value, 41);
			const result = { event: "tool", input: args.value, result: args.value + 1, identity, lateIdentity: lateIdentity(), provider: ctx.model?.provider, cwd: ctx.cwd, mode: ctx.mode,
				runtime: { executable: process.execPath, bun: process.versions.bun ?? null, main: (globalThis as { Bun?: { main?: string } }).Bun?.main ?? null } };
			record(result);
			return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
		} }));
	api.registerProvider("native-artifact-fixture", {
		api: "native-artifact-fixture", baseUrl: "https://example.invalid", apiKey: "offline-fixture-not-a-credential",
		models: [{ id: "offline", name: "Offline artifact fixture", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 1024 }],
		streamSimple(model, context) {
			const request = context.messages.findLastIndex((message) => {
				if (message.role !== "user") return false;
				const text = typeof message.content === "string" ? message.content : message.content.filter((part) => part.type === "text").map((part) => part.text).join("");
				return ["run the offline fixture", "run the offline artifact fixture", "run the offline artifact fixture after reload"].includes(text);
			});
			const completed = context.messages.slice(request).some((message) => message.role === "toolResult" && message.toolName === "artifact_increment");
			record({ event: "provider", provider: model.provider, model: model.id, completed });
			const message = { role: "assistant" as const, api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(),
				content: completed ? [{ type: "text" as const, text: "offline artifact complete" }] : [{ type: "toolCall" as const, id: `artifact-call-${request}`, name: "artifact_increment", arguments: { value: 41 } }],
				stopReason: completed ? "stop" as const : "toolUse" as const,
				usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
			const stream = createAssistantMessageEventStream();
			stream.push({ type: "done", reason: message.stopReason, message });
			stream.end(message);
			return stream;
		},
	});
	api.on("session_start", async (event, ctx) => {
		for (const dialect of ["omk", "omk+pi", "omk", "omk+pi", "omk"] as const) {
			const loader = new DefaultResourceLoader({ cwd: ctx.cwd, agentDir: process.env.OMK_CODING_AGENT_DIR, settingsManager: SettingsManager.inMemory({ packages: [] }),
				packageManifestDialect: dialect, additionalExtensionPaths: [`${ctx.cwd}/cache-control.ts`], noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
			await loader.reload();
			const loaded = loader.getExtensions();
			assert.equal(loaded.errors.some((error) => error.path.endsWith("/cache-control.ts")), dialect === "omk");
			assert.equal(loaded.extensions.some((extension) => extension.path.endsWith("/cache-control.ts")), dialect === "omk+pi");
		}
		record({ event: "cache-order", order: ["omk", "omk+pi", "omk", "omk+pi", "omk"] });
		record({ event: "start", reason: event.reason, trusted: ctx.isProjectTrusted(), cwd: ctx.cwd });
	});
	api.on("session_shutdown", (event) => record({ event: "shutdown", reason: event.reason }));
}
