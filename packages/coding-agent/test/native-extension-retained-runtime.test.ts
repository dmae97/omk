import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerFauxProvider } from "omk-ai";
import { expect, it, vi } from "vitest";
import {
	AuthStorage,
	createAgentSession,
	type ExtensionAPI,
	type ExtensionContext,
	SessionManager,
	SettingsManager,
} from "../src/index.ts";
import { createTestExtensionsResult, createTestResourceLoader } from "./utilities.ts";

it("retires old contexts without disabling a custom loader's retained runtime after repeated reload", async () => {
	const root = mkdtempSync(join(tmpdir(), "omk-retained-runtime-"));
	const agentDir = join(root, "agent");
	mkdirSync(agentDir);
	vi.stubEnv("HOME", root);
	vi.stubEnv("OMK_CODING_AGENT_DIR", agentDir);
	const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected network request"));
	const faux = registerFauxProvider();
	const captures: { api: ExtensionAPI; ctx: ExtensionContext; reason: string }[] = [];
	const errors: string[] = [];
	const extensionsResult = await createTestExtensionsResult(
		[
			(api) => {
				api.on("session_start", (event, ctx) => {
					api.getActiveTools();
					captures.push({ api, ctx, reason: event.reason });
				});
			},
		],
		root,
	);
	const resourceLoader = createTestResourceLoader({ extensionsResult });
	const { session } = await createAgentSession({
		cwd: root,
		agentDir,
		model: faux.getModel(),
		authStorage: AuthStorage.inMemory(),
		settingsManager: SettingsManager.inMemory(),
		sessionManager: SessionManager.inMemory(root),
		resourceLoader,
		noTools: "all",
	});
	try {
		await session.bindExtensions({ mode: "print", onError: ({ error }) => errors.push(error) });
		for (let index = 0; index < 2; index++) {
			const previous = captures.at(-1);
			if (!previous) throw new Error("Missing actual session-start capture");
			await session.reload();
			expect(errors).toEqual([]);
			expect(captures).toHaveLength(index + 2);
			expect(() => previous.ctx.cwd).toThrow(/stale/);
			expect(captures.at(-1)?.ctx.cwd).toBe(root);
			expect(captures.at(-1)?.api.getActiveTools()).toEqual([]);
			expect(resourceLoader.getExtensions().runtime).toBe(extensionsResult.runtime);
		}
		expect(captures.map(({ reason }) => reason)).toEqual(["startup", "reload", "reload"]);
		expect(fetch).not.toHaveBeenCalled();
	} finally {
		await session.close();
		session.dispose();
		faux.unregister();
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		rmSync(root, { recursive: true, force: true });
	}
});
