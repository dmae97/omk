import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as path from "node:path";
import { Agent } from "@oh-my-pi/pi-agent-core";
import {
	getBundledModel,
	getBundledModels,
	getBundledProviders,
	supportsXhigh,
	type ThinkingLevel,
} from "@oh-my-pi/pi-ai";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { TempDir } from "@oh-my-pi/pi-utils";

describe("AgentSession role model thinking behavior", () => {
	let tempDir: TempDir;
	let session: AgentSession;
	let sessionSettings: Settings;

	beforeEach(() => {
		tempDir = TempDir.createSync("@pi-role-thinking-");
	});

	afterEach(async () => {
		if (session) {
			await session.dispose();
		}
		tempDir.removeSync();
	});

	function getAnthropicModelOrThrow(id: string) {
		const model = getBundledModel("anthropic", id);
		if (!model) throw new Error(`Expected anthropic model ${id} to exist`);
		return model;
	}

	function getReasoningModelWithoutXhighOrThrow() {
		for (const provider of getBundledProviders()) {
			for (const model of getBundledModels(provider as Parameters<typeof getBundledModels>[0])) {
				if (model.reasoning && !supportsXhigh(model)) return model;
			}
		}
		throw new Error("Expected at least one bundled reasoning model without xhigh support");
	}

	async function createSession(options: {
		initialModelId: string;
		initialThinkingLevel: ThinkingLevel;
		modelRoles: Record<string, string>;
	}) {
		const model = getAnthropicModelOrThrow(options.initialModelId);
		const agent = new Agent({
			initialState: {
				model,
				systemPrompt: "Test",
				tools: [],
				messages: [],
				thinkingLevel: options.initialThinkingLevel,
			},
		});
		const authStorage = await AuthStorage.create(path.join(tempDir.path(), "testauth.db"));
		authStorage.setRuntimeApiKey("anthropic", "test-key");
		const modelRegistry = new ModelRegistry(authStorage, path.join(tempDir.path(), "models.yml"));

		sessionSettings = Settings.isolated();
		for (const [role, modelRoleValue] of Object.entries(options.modelRoles)) {
			sessionSettings.setModelRole(role, modelRoleValue);
		}
		session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(),
			settings: sessionSettings,
			modelRegistry,
		});
	}

	it("re-applies explicit role thinking each time that role is selected", async () => {
		const defaultModel = getAnthropicModelOrThrow("claude-sonnet-4-5");
		const slowModel = getAnthropicModelOrThrow("claude-sonnet-4-6");

		await createSession({
			initialModelId: defaultModel.id,
			initialThinkingLevel: "high",
			modelRoles: {
				default: `${defaultModel.provider}/${defaultModel.id}`,
				slow: `${slowModel.provider}/${slowModel.id}:off`,
			},
		});

		const firstSwitch = await session.cycleRoleModels(["default", "slow"]);
		expect(firstSwitch?.role).toBe("slow");
		expect(firstSwitch?.model.id).toBe(slowModel.id);
		expect(firstSwitch?.thinkingLevel).toBe("off");
		expect(session.thinkingLevel).toBe("off");

		session.setThinkingLevel("high");
		expect(session.thinkingLevel).toBe("high");

		const secondSwitch = await session.cycleRoleModels(["default", "slow"]);
		expect(secondSwitch?.role).toBe("default");
		expect(secondSwitch?.model.id).toBe(defaultModel.id);
		expect(session.thinkingLevel).toBe("high");

		const thirdSwitch = await session.cycleRoleModels(["default", "slow"]);
		expect(thirdSwitch?.role).toBe("slow");
		expect(thirdSwitch?.model.id).toBe(slowModel.id);
		expect(thirdSwitch?.thinkingLevel).toBe("off");
		expect(session.thinkingLevel).toBe("off");
	});

	it("preserves current thinking when switching into default/no-suffix role", async () => {
		const defaultModel = getAnthropicModelOrThrow("claude-sonnet-4-5");
		const slowModel = getAnthropicModelOrThrow("claude-sonnet-4-6");

		await createSession({
			initialModelId: defaultModel.id,
			initialThinkingLevel: "low",
			modelRoles: {
				default: `${defaultModel.provider}/${defaultModel.id}`,
				slow: `${slowModel.provider}/${slowModel.id}:high`,
			},
		});

		const toSlow = await session.cycleRoleModels(["default", "slow"]);
		expect(toSlow?.role).toBe("slow");
		expect(toSlow?.thinkingLevel).toBe("high");
		expect(session.thinkingLevel).toBe("high");

		session.setThinkingLevel("minimal");
		expect(session.thinkingLevel).toBe("minimal");

		const toDefault = await session.cycleRoleModels(["default", "slow"]);
		expect(toDefault?.role).toBe("default");
		expect(toDefault?.model.id).toBe(defaultModel.id);
		expect(toDefault?.thinkingLevel).toBe("minimal");
		expect(session.thinkingLevel).toBe("minimal");
	});

	it("applies slow role thinking even when plan shares the same model", async () => {
		const defaultModel = getAnthropicModelOrThrow("claude-sonnet-4-5");
		const smolModel = getAnthropicModelOrThrow("claude-sonnet-4-6");
		const slowPlanModel = getAnthropicModelOrThrow("claude-opus-4-5");

		await createSession({
			initialModelId: defaultModel.id,
			initialThinkingLevel: "medium",
			modelRoles: {
				default: `${defaultModel.provider}/${defaultModel.id}`,
				smol: `${smolModel.provider}/${smolModel.id}:low`,
				slow: `${slowPlanModel.provider}/${slowPlanModel.id}:high`,
				plan: `${slowPlanModel.provider}/${slowPlanModel.id}:off`,
			},
		});

		const toSmol = await session.cycleRoleModels(["slow", "default", "smol"]);
		expect(toSmol?.role).toBe("smol");
		expect(toSmol?.thinkingLevel).toBe("low");
		expect(session.thinkingLevel).toBe("low");

		const toSlow = await session.cycleRoleModels(["slow", "default", "smol"]);
		expect(toSlow?.role).toBe("slow");
		expect(toSlow?.model.id).toBe(slowPlanModel.id);
		expect(toSlow?.thinkingLevel).toBe("high");
		expect(session.thinkingLevel).toBe("high");
	});

	it("preserves explicit role thinking when updating default model despite unresolved previous model", async () => {
		const defaultModel = getAnthropicModelOrThrow("claude-sonnet-4-5");
		const slowModel = getAnthropicModelOrThrow("claude-sonnet-4-6");

		await createSession({
			initialModelId: defaultModel.id,
			initialThinkingLevel: "high",
			modelRoles: {
				default: "anthropic/nonexistent-model:off",
			},
		});

		await session.setModel(slowModel);

		expect(sessionSettings.getModelRole("default")).toBe(`${slowModel.provider}/${slowModel.id}:off`);
	});

	it("clamps unsupported xhigh to highest supported level instead of off", async () => {
		const model = getReasoningModelWithoutXhighOrThrow();
		const agent = new Agent({
			initialState: {
				model,
				systemPrompt: "Test",
				tools: [],
				messages: [],
				thinkingLevel: "off",
			},
		});
		const authStorage = await AuthStorage.create(path.join(tempDir.path(), "testauth-non-xhigh.db"));
		authStorage.setRuntimeApiKey("anthropic", "test-key");
		const modelRegistry = new ModelRegistry(authStorage, path.join(tempDir.path(), "models-non-xhigh.yml"));

		sessionSettings = Settings.isolated();
		session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(),
			settings: sessionSettings,
			modelRegistry,
		});

		session.setThinkingLevel("xhigh");
		expect(session.thinkingLevel).toBe("high");
	});
});
