/**
 * Unit tests for vision-route compaction behavior.
 *
 * When a synthetic text-only session model serves a turn whose
 * transcript carries image blocks, the agent loop auto-routes the request to
 * the vision model (openai-codex/gpt-5.6-luna, 1M window). Two failures used
 * to follow:
 *
 * 1. Threshold compaction was computed against the session model's window
 *    (deepseek 1M -> ~700K), so an undersized vision-route window could overflow before
 *    compaction could fire.
 * 2. A context_overflow error surfaced from the auto-routed vision model was
 *    ignored by `_checkCompaction` because the message model differs from the
 *    session model, so the raw error reached the user instead of compacting.
 */
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent, VISION_ROUTE_MODEL } from "omk-agent-core";
import { getModel, type Model } from "omk-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentSession } from "../src/core/agent-session.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createCodingTools } from "../src/index.ts";
import { createTestResourceLoader } from "./utilities.ts";

describe("AgentSession vision-route compaction", () => {
	let session: AgentSession;
	let tempDir: string;
	let sessionManager: SessionManager;
	let settingsManager: SettingsManager;

	const deepseekModel: Model<"openai-completions"> = {
		id: "text-only-fixture",
		name: "Text-only fixture",
		provider: "deepseek",
		api: "openai-completions",
		baseUrl: "https://example.invalid",
		reasoning: false,
		input: ["text"],
		contextWindow: 1_000_000,
		maxTokens: 384_000,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	};

	function textMessage(text: string) {
		return { type: "text" as const, text };
	}
	function imageMessage() {
		return { type: "image" as const, mimeType: "image/png" as const, data: "AAAA" };
	}
	/**
	 * A complete UserMessage. The turn must carry `timestamp` to satisfy the
	 * type; a bare `{ role, content }` literal only type-checked while it shared
	 * a line with the `@ts-expect-error` covering the private-method call.
	 */
	function imageTurn() {
		return { role: "user" as const, content: [imageMessage()], timestamp: Date.now() };
	}

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-vision-compaction-test-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		if (session) session.dispose();
		if (tempDir) rmSync(tempDir, { recursive: true });
	});

	function createSession() {
		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: {
				model: deepseekModel,
				systemPrompt: "You are a helpful assistant. Be concise.",
				tools: createCodingTools(process.cwd()),
			},
		});
		sessionManager = SessionManager.inMemory();
		settingsManager = SettingsManager.create(tempDir, tempDir);
		settingsManager.applyOverrides({
			compaction: { enabled: true, reserveTokens: 1024, maxUsageRatio: 0.7 },
		});
		const authStorage = AuthStorage.create(join(tempDir, "auth.json"));
		const modelRegistry = ModelRegistry.create(authStorage);
		session = new AgentSession({
			agent,
			sessionManager,
			settingsManager,
			cwd: tempDir,
			modelRegistry,
			resourceLoader: createTestResourceLoader(),
		});
		return session;
	}

	// A fixture window equal to VISION_ROUTE_MODEL.contextWindow makes every
	// branch return the same number, so the assertions cannot tell the clamp from
	// its absence. Each case below puts the session window on a known side of the
	// vision route's and asserts the direction of the clamp, not only its value.
	const ABOVE_VISION = 3_500_000; // catalogued session windows do reach this
	const BELOW_VISION = 200_000; // the catalogue median sits nearer this end

	it("clamps an image-bearing turn down to the vision-route window", async () => {
		createSession();
		// @ts-expect-error private method under test
		const effective = session._effectiveTurnContextWindow([imageTurn()], ABOVE_VISION);
		expect(effective).toBe(VISION_ROUTE_MODEL.contextWindow);
		// Without the clamp the threshold is computed against the session window
		// and the vision request overflows before compaction can fire.
		expect(effective).toBeLessThan(ABOVE_VISION);
	});

	it("keeps a session window smaller than the vision route's", async () => {
		createSession();
		// @ts-expect-error private method under test
		const effective = session._effectiveTurnContextWindow([imageTurn()], BELOW_VISION);
		// Routing to a 1M model does not grant a 200K session more room; the
		// binding limit stays the smaller of the two.
		expect(effective).toBe(BELOW_VISION);
		expect(effective).toBeLessThan(VISION_ROUTE_MODEL.contextWindow);
	});

	it("keeps the session-model window for text-only turns", async () => {
		createSession();
		// @ts-expect-error private method under test
		const effective = session._effectiveTurnContextWindow(
			[{ role: "user", content: [textMessage("hi")], timestamp: Date.now() }],
			ABOVE_VISION,
		);
		expect(effective).toBe(ABOVE_VISION);
		expect(effective).toBeGreaterThan(VISION_ROUTE_MODEL.contextWindow);
	});

	it("keeps the session-model window when the model can see images itself", async () => {
		createSession();
		session.agent.state.model = getModel("anthropic", "claude-sonnet-5");
		// @ts-expect-error private method under test
		const effective = session._effectiveTurnContextWindow([imageTurn()], ABOVE_VISION);
		// No vision route is taken, so nothing clamps this turn.
		expect(effective).toBe(ABOVE_VISION);
		expect(effective).toBeGreaterThan(VISION_ROUTE_MODEL.contextWindow);
	});

	it("does not treat a vision-route overflow as a foreign-model overflow", async () => {
		createSession();
		// @ts-expect-error private method under test
		session._overflowRecoveryAttempts = 0;
		// @ts-expect-error private method under test
		const overflowMessage = session._checkCompaction({
			role: "assistant",
			provider: "openai-codex",
			model: "gpt-5.6-luna",
			stopReason: "error",
			errorMessage:
				"Codex error: Your input exceeds the context window of this model. Please adjust your input and try again. (context_length_exceeded)",
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
			timestamp: Date.now(),
			content: [],
		} as never);
		// Compaction path (not `false` from the same-model guard) — overflow is
		// recognized as session-owned and recovery proceeds.
		await expect(overflowMessage).resolves.not.toBeNull();
		// @ts-expect-error private method under test
		expect(session._overflowRecoveryAttempts).toBe(1);
	});
});
