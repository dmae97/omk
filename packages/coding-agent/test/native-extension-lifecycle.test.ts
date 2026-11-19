import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, registerFauxProvider } from "omk-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyProjectTrustGate } from "../src/cli/project-trust-gate.ts";
import { findGoalCostSink } from "../src/core/extensions/builtin/goal-cost-accounting.ts";
import {
	AuthStorage,
	type CreateAgentSessionRuntimeFactory,
	createAgentSession,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	DefaultResourceLoader,
	type ExtensionAPI,
	type ExtensionContext,
	SessionManager,
	SettingsManager,
} from "../src/index.ts";

const quietResources = { noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true };
const bindings = {
	mode: "print" as const,
	onError: ({ error }: { error: string }) => {
		throw new Error(error);
	},
};

let root: string;
let agentDir: string;
let firstCwd: string;
let secondCwd: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "omk-native-lifecycle-"));
	agentDir = join(root, "agent");
	firstCwd = join(root, "first");
	secondCwd = join(root, "second");
	mkdirSync(agentDir);
	vi.stubEnv("HOME", root);
	for (const cwd of [firstCwd, secondCwd]) {
		mkdirSync(join(cwd, ".git"), { recursive: true });
		mkdirSync(join(cwd, ".omk", "extensions"), { recursive: true });
		writeFileSync(
			join(cwd, ".omk", "extensions", "native.ts"),
			`
			import type { ExtensionAPI } from "open-multi-agent-kit";
			export default function(api: ExtensionAPI) {
				api.registerCommand("native-${cwd === firstCwd ? "first" : "second"}", { handler: async () => {} });
				api.events.on("lifecycle:ping", () => api.events.emit("lifecycle:pong", ${JSON.stringify(cwd)}));
				api.on("session_start", (event, ctx) => api.events.emit("lifecycle:capture", { api, ctx, reason: event.reason }));
				api.on("session_shutdown", event => api.events.emit("lifecycle:shutdown", event.reason));
			}
		`,
		);
		writeFileSync(
			join(cwd, ".omk", "extensions", "legacy.ts"),
			'import { Key } from "@earendil-works/pi-tui"; export default api => { void Key; api.registerCommand("legacy-alias", { handler: async () => {} }); };',
		);
	}
});
afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	rmSync(root, { recursive: true, force: true });
});

type Capture = { api: ExtensionAPI; ctx: ExtensionContext; reason: string };

describe("native extension lifecycle continuity", () => {
	it("retains native selection, metadata, trust and subscription cleanup through reload, with stale guards across new and cwd-changing resume", async () => {
		const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected network request"));
		const faux = registerFauxProvider();
		const captures: Capture[] = [];
		const pongs: unknown[] = [];
		const shutdowns: unknown[] = [];
		for (const cwd of [firstCwd, secondCwd]) {
			const settingsManager = SettingsManager.create(cwd, agentDir);
			expect(
				await applyProjectTrustGate({
					cwd,
					settingsManager,
					mode: "interactive",
					prompt: async () => "trust",
					env: {},
					home: root,
				}),
			).toEqual([]);
		}
		const selected = { packageManifestDialect: "omk" as "omk" | "omk+pi" };
		const dialect = selected.packageManifestDialect;
		const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
			const settingsManager = SettingsManager.create(cwd, agentDir);
			const diagnostics = await applyProjectTrustGate({
				cwd,
				settingsManager,
				mode: "headless",
				env: {},
				home: root,
			});
			const services = await createAgentSessionServices({
				cwd,
				agentDir,
				authStorage: AuthStorage.inMemory(),
				settingsManager,
				resourceLoaderOptions: { ...quietResources, packageManifestDialect: dialect },
			});
			const bus = services.resourceLoader.getEventBus!();
			bus.on("lifecycle:capture", (data) => {
				captures.push(data as Capture);
			});
			bus.on("lifecycle:pong", (data) => {
				pongs.push(data);
			});
			bus.on("lifecycle:shutdown", (data) => {
				shutdowns.push(data);
			});
			return {
				...(await createAgentSessionFromServices({
					services,
					sessionManager,
					sessionStartEvent,
					model: faux.getModel(),
				})),
				services,
				diagnostics: [...diagnostics, ...services.diagnostics],
			};
		};
		const otherManager = SessionManager.create(secondCwd, join(root, "sessions"));
		otherManager.appendMessage({ role: "user", content: "offline resume fixture", timestamp: Date.now() });
		otherManager.appendMessage(fauxAssistantMessage("stored response"));
		const otherFile = otherManager.getSessionFile();
		expect(otherFile).toBeDefined();
		const runtime = await createAgentSessionRuntime(createRuntime, {
			cwd: firstCwd,
			agentDir,
			sessionManager: SessionManager.create(firstCwd, join(root, "sessions")),
		});
		runtime.setRebindSession((session) => session.bindExtensions(bindings));
		try {
			await runtime.session.bindExtensions(bindings);
			const initialLoader = runtime.services.resourceLoader;
			const assertNative = (cwd: string) => {
				expect(runtime.cwd).toBe(cwd);
				expect(runtime.diagnostics).toEqual([]);
				const extensions = runtime.services.resourceLoader.getExtensions();
				const commands = extensions.extensions.flatMap((extension) => [...extension.commands.keys()]);
				expect(commands.filter((name) => name.startsWith("native-"))).toEqual([
					`native-${cwd === firstCwd ? "first" : "second"}`,
				]);
				expect(commands).not.toContain("legacy-alias");
				expect(extensions.errors).toContainEqual({
					path: join(cwd, ".omk", "extensions", "legacy.ts"),
					error: expect.stringContaining("@earendil-works/pi-tui"),
				});
				expect(findGoalCostSink(extensions.extensions)).toBeTypeOf("function");
				expect(captures.at(-1)?.ctx.isProjectTrusted()).toBe(true);
			};
			assertNative(firstCwd);
			selected.packageManifestDialect = "omk+pi";
			await runtime.session.reload();
			assertNative(firstCwd);
			expect(runtime.services.resourceLoader).toBe(initialLoader);
			expect(captures.map(({ reason }) => reason)).toEqual(["startup", "reload"]);
			initialLoader.getEventBus!().emit("lifecycle:ping", {});
			expect(pongs).toEqual([firstCwd]);
			const reloadedCapture = captures.at(-1)!;
			expect(await runtime.newSession()).toEqual({ cancelled: false });
			assertNative(firstCwd);
			expect(runtime.services.resourceLoader).not.toBe(initialLoader);
			expect(() => reloadedCapture.api.getActiveTools()).toThrow(/stale/);
			const beforeSwitch = captures.at(-1)!;
			expect(await runtime.switchSession(otherFile!)).toEqual({ cancelled: false });
			assertNative(secondCwd);
			expect(captures.at(-1)?.reason).toBe("resume");
			expect(() => beforeSwitch.ctx.cwd).toThrow(/stale/);
			expect(() => beforeSwitch.api.registerProvider("stale-provider", { api: "openai-completions" })).toThrow(
				/stale/,
			);
			expect(runtime.services.resourceLoader.getExtensions().runtime.providerOwners.has("stale-provider")).toBe(
				false,
			);
			runtime.services.resourceLoader.getEventBus!().emit("lifecycle:ping", {});
			expect(pongs).toEqual([firstCwd, secondCwd]);
			expect(shutdowns).toEqual(["reload", "new", "resume"]);
			expect(fetch).not.toHaveBeenCalled();
		} finally {
			await runtime.dispose();
			faux.unregister();
		}
	});

	it("rejects captured APIs and contexts after native session reload", async () => {
		const faux = registerFauxProvider();
		const settingsManager = SettingsManager.inMemory({ packages: [] });
		const loader = new DefaultResourceLoader({
			...quietResources,
			cwd: firstCwd,
			agentDir,
			settingsManager,
			packageManifestDialect: "omk",
			additionalExtensionPaths: [join(firstCwd, ".omk", "extensions", "native.ts")],
			noExtensions: true,
		});
		const captures: Capture[] = [];
		loader.getEventBus().on("lifecycle:capture", (data) => {
			captures.push(data as Capture);
		});
		await loader.reload();
		const { session } = await createAgentSession({
			cwd: firstCwd,
			agentDir,
			model: faux.getModel(),
			authStorage: AuthStorage.inMemory(),
			settingsManager,
			resourceLoader: loader,
			sessionManager: SessionManager.inMemory(firstCwd),
		});
		try {
			await session.bindExtensions(bindings);
			const captured = captures.at(-1)!;
			await session.reload();
			expect(captures).toHaveLength(2);
			expect(() => captured.api.getActiveTools()).toThrow(/stale/);
			expect(() => captured.ctx.cwd).toThrow(/stale/);
		} finally {
			await session.close();
			faux.unregister();
		}
	});

	it("does not let native selection grant trust to an unapproved project", async () => {
		const settingsManager = SettingsManager.create(firstCwd, agentDir);
		const diagnostics = await applyProjectTrustGate({
			cwd: firstCwd,
			settingsManager,
			mode: "headless",
			env: {},
			home: root,
		});
		expect(diagnostics).toContainEqual({
			type: "warning",
			message: expect.stringContaining("Project code not loaded"),
		});
		const services = await createAgentSessionServices({
			cwd: firstCwd,
			agentDir,
			settingsManager,
			authStorage: AuthStorage.inMemory(),
			resourceLoaderOptions: { ...quietResources, packageManifestDialect: "omk" },
		});
		expect(
			services.resourceLoader.getExtensions().extensions.flatMap((extension) => [...extension.commands.keys()]),
		).not.toContain("native-first");
	});
});
