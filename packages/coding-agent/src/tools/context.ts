import type { AgentToolContext, ToolCallContext } from "@oh-my-pi/pi-agent-core";
import type { CustomToolContext } from "$c/extensibility/custom-tools/types";
import type { ExtensionUIContext } from "$c/extensibility/extensions/types";

declare module "@oh-my-pi/pi-agent-core" {
	interface AgentToolContext extends CustomToolContext {
		ui?: ExtensionUIContext;
		hasUI?: boolean;
		toolNames?: string[];
		toolCall?: ToolCallContext;
	}
}

export class ToolContextStore {
	private uiContext: ExtensionUIContext | undefined;
	private hasUI = false;
	private toolNames: string[] = [];

	constructor(private readonly getBaseContext: () => CustomToolContext) {}

	getContext(toolCall?: ToolCallContext): AgentToolContext {
		return {
			...this.getBaseContext(),
			ui: this.uiContext,
			hasUI: this.hasUI,
			toolNames: this.toolNames,
			toolCall,
		};
	}

	setUIContext(uiContext: ExtensionUIContext, hasUI: boolean): void {
		this.uiContext = uiContext;
		this.hasUI = hasUI;
	}

	setToolNames(names: string[]): void {
		this.toolNames = names;
	}
}
