import type { ImageContent } from "omk-ai";
import type { CustomMessage } from "../messages.ts";

export type BeforeAgentStartTrigger =
	| { messageType: "user"; prompt: string; images?: ImageContent[] }
	| { messageType: "custom"; message: CustomMessage };

export type BeforeAgentStartEvent<TOptions> = BeforeAgentStartTrigger & {
	type: "before_agent_start";
	systemPrompt: string;
	systemPromptOptions: TOptions;
};
