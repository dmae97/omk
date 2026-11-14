import type { AgentMessage } from "omk-agent-core";
import type { ImageContent } from "omk-ai";
import type { CustomMessage } from "../messages.ts";
import { type BuildSystemPromptOptions, buildSystemPromptPlan } from "../system-prompt.ts";
import { type PrefixBoundaryCauseHolder, resolveExtendedSystemPromptCache } from "../system-prompt-cache-boundary.ts";
import type { BeforeAgentStartTrigger } from "./before-agent-start-types.ts";

type InjectedMessage = Pick<CustomMessage, "customType" | "content" | "display" | "details">;
interface BeforeAgentStartEmitter {
	emitBeforeAgentStart(
		prompt: string,
		images: ImageContent[] | undefined,
		promptText: string,
		options: BuildSystemPromptOptions,
		trigger: BeforeAgentStartTrigger,
	): Promise<{ messages?: InjectedMessage[]; systemPrompt?: string } | undefined>;
}

/** Share run setup without replacing OMK's prompt/cache and lifecycle ownership. */
export async function prepareMessageStart(
	runner: BeforeAgentStartEmitter,
	trigger: BeforeAgentStartTrigger,
	options: BuildSystemPromptOptions,
	causes?: PrefixBoundaryCauseHolder,
) {
	const plan = buildSystemPromptPlan(options);
	const result = await runner.emitBeforeAgentStart(
		trigger.messageType === "user" ? trigger.prompt : "",
		trigger.messageType === "user" ? trigger.images : undefined,
		plan.prompt,
		options,
		trigger,
	);
	const messages: AgentMessage[] = (result?.messages ?? []).map((entry) => ({
		role: "custom",
		customType: entry.customType,
		content: entry.content,
		display: entry.display,
		details: entry.details,
		timestamp: Date.now(),
	}));
	const systemPrompt = result?.systemPrompt ?? plan.prompt;
	const cache = causes ? causes.resolve(plan, systemPrompt) : resolveExtendedSystemPromptCache(plan, systemPrompt);
	return {
		messages,
		promptState: {
			systemPrompt,
			systemPromptCacheBoundary: cache.cacheBoundary,
			systemPromptCacheBoundaryBypass: cache.bypass,
		},
		modified: result?.systemPrompt !== undefined,
	};
}
