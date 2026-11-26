import { describe, expect, it } from "vitest";
import { HARNESS_FACTORIES } from "../src/core/extensions/builtin/harness-factories.ts";
import {
	createMetacogExtension,
	INITIAL_METACOG_STATE,
	reduceMetacogEvent,
	scanResponseMetacogSignals,
} from "../src/core/extensions/builtin/metacog.ts";

describe("<builtin:metacog> native extension", () => {
	it("is registered in HARNESS_FACTORIES with OMK_METACOG opt-out", () => {
		const entry = HARNESS_FACTORIES.find((item) => item.path === "<builtin:metacog>");
		expect(entry).toBeDefined();
		expect(entry?.envVar).toBe("OMK_METACOG");
	});

	it("stays inert when idle, activates Schoenfeld switch advisory after 2 consecutive tool failures, and decays unreinforced overconfidence", () => {
		const commands = new Map<string, { handler: (args: string, ctx: any) => Promise<void> | void }>();
		const handlers = new Map<string, (event: any, ctx?: any) => any>();
		const factory = createMetacogExtension();
		factory({
			on: (name: string, fn: any) => handlers.set(name, fn),
			registerCommand: (name: string, def: any) => commands.set(name, def),
		} as any);

		expect(commands.has("metacog")).toBe(true);
		// Idle before_agent_start must return undefined so KV cache prefix stays untouched.
		expect(handlers.get("before_agent_start")?.({ systemPrompt: "BASE" })).toBeUndefined();

		// Two consecutive tool errors trigger Schoenfeld strategy-switch advisory.
		handlers.get("tool_execution_end")?.({ toolName: "bash", isError: true });
		handlers.get("tool_execution_end")?.({ toolName: "bash", isError: true });
		const injected = handlers.get("before_agent_start")?.({ systemPrompt: "BASE" });
		expect(injected?.systemPrompt).toContain("Metacog Monitor");
		expect(injected?.systemPrompt).toContain("consecutive tool failures");

		// Unreinforced overconfident response lowers calibrated confidence.
		const sig = scanResponseMetacogSignals("이 알고리즘은 항상 45% 성능을 반드시 개선합니다.");
		expect(sig.unreinforcedClaims).toBeGreaterThanOrEqual(2);
		const decayed = reduceMetacogEvent(INITIAL_METACOG_STATE, { type: "turn_assessed", signals: sig });
		expect(decayed.confidence).toBeLessThan(INITIAL_METACOG_STATE.confidence);
	});
});
