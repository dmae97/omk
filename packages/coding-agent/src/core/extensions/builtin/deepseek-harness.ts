import { DEEPSEEK_HARNESS_GUIDELINES, DeepSeekHarnessEngine, isDeepSeekHarnessModel } from "../../deepseek-harness.ts";
import type { ExtensionAPI } from "../types.ts";

export default function deepseekHarness(omk: ExtensionAPI): void {
	const engine = new DeepSeekHarnessEngine();
	omk.on("before_agent_start", (event, ctx) => {
		if (!isDeepSeekHarnessModel(ctx.model)) return undefined;
		return {
			systemPrompt: `${event.systemPrompt}\n\n<model_harness id="deepseek_harness">\n${DEEPSEEK_HARNESS_GUIDELINES.map((line) => `- ${line}`).join("\n")}\n</model_harness>`,
		};
	});
	omk.on(
		"context",
		(event, ctx) => {
			if (!isDeepSeekHarnessModel(ctx.model)) return undefined;
			const messages = engine.projectContext(event.messages, ctx.model, ctx.getContextUsage()?.percent);
			return messages === event.messages ? undefined : { messages };
		},
		{ mutatesMessages: false },
	);
}
