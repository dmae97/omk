import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModel } from "omk-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

describe("AgentSession project trust context", () => {
	let directory: string;

	beforeEach(() => {
		directory = mkdtempSync(join(tmpdir(), "omk-trust-context-"));
	});

	afterEach(() => {
		rmSync(directory, { recursive: true, force: true });
	});

	it.each([false, true])("follows the session gate when withheld=%s", async (withheld) => {
		const settingsManager = SettingsManager.create(directory, directory);
		if (withheld) settingsManager.withholdProjectCode();
		let readTrust: (() => boolean) | undefined;
		const resourceLoader = new DefaultResourceLoader({
			cwd: directory,
			agentDir: directory,
			settingsManager,
			extensionFactories: [
				(pi) => {
					pi.on("session_start", (_event, ctx) => {
						readTrust = () => ctx.isProjectTrusted();
					});
				},
			],
		});
		await resourceLoader.reload();
		const model = getModel("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("Missing test model");
		const { session } = await createAgentSession({
			cwd: directory,
			agentDir: directory,
			model,
			settingsManager,
			sessionManager: SessionManager.inMemory(),
			resourceLoader,
		});
		try {
			await session.bindExtensions({});
			expect(readTrust?.()).toBe(!withheld);
			settingsManager.withholdProjectCode();
			expect(readTrust?.()).toBe(false);
		} finally {
			session.dispose();
		}
	});
});
