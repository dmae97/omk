import type { AgentToolContext, ToolCallContext } from "@oh-my-pi/pi-agent-core";
import type { CustomToolContext } from "../custom-tools/types";
import type { ExtensionUIContext } from "../extensions/types";

declare module "@oh-my-pi/pi-agent-core" {
	interface AgentToolContext extends CustomToolContext {
		ui?: ExtensionUIContext;
		hasUI?: boolean;
		toolNames?: string[];
		toolCall?: ToolCallContext;
	}
}

export interface ToolContextStore {
	getContext(toolCall?: ToolCallContext): AgentToolContext;
	setUIContext(uiContext: ExtensionUIContext, hasUI: boolean): void;
	setToolNames(names: string[]): void;
}

export function createToolContextStore(getBaseContext: () => CustomToolContext): ToolContextStore {
	let uiContext: ExtensionUIContext | undefined;
	let hasUI = false;
	let toolNames: string[] = [];

	return {
		getContext: (toolCall) => ({
			...getBaseContext(),
			ui: uiContext,
			hasUI,
			toolNames,
			toolCall,
		}),
		setUIContext: (context, uiAvailable) => {
			uiContext = context;
			hasUI = uiAvailable;
		},
		setToolNames: (names) => {
			toolNames = names;
		},
	};
}
