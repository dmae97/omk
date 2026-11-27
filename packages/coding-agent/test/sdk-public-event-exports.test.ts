import { describe, expect, it } from "vitest";
import type {
	AfterProviderResponseEvent,
	AgentEndEvent,
	AgentSettledEvent,
	AgentStartEvent,
	BashToolResultEvent,
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	BeforeProviderRequestEvent,
	ContextEvent,
	ContextEventResult,
	CustomToolResultEvent,
	EditToolResultEvent,
	ExtensionAPI,
	ExtensionContext,
	ExtensionHandler,
	FindToolResultEvent,
	GrepToolResultEvent,
	InputEvent,
	InputEventResult,
	LsToolResultEvent,
	MessageEndEvent,
	MessageEndEventResult,
	MessageStartEvent,
	MessageUpdateEvent,
	ModelSelectEvent,
	ModelSelectSource,
	ReadToolResultEvent,
	ReplacedSessionContext,
	ResourcesDiscoverEvent,
	ResourcesDiscoverResult,
	SessionBeforeCompactEvent,
	SessionBeforeCompactResult,
	SessionBeforeForkEvent,
	SessionBeforeForkResult,
	SessionBeforeSwitchEvent,
	SessionBeforeSwitchResult,
	SessionBeforeTreeEvent,
	SessionBeforeTreeResult,
	SessionCompactEvent,
	SessionEvent,
	SessionInfoChangedEvent,
	SessionShutdownEvent,
	SessionStartEvent,
	SessionTreeEvent,
	ThinkingLevelSelectEvent,
	ToolCallEvent,
	ToolCallEventResult,
	ToolExecutionEndEvent,
	ToolExecutionStartEvent,
	ToolExecutionUpdateEvent,
	ToolRenderContext,
	ToolResultEvent,
	ToolResultEventResult,
	TreePreparation,
	TurnEndEvent,
	TurnStartEvent,
	UserBashEvent,
	UserBashEventResult,
	WriteToolResultEvent,
} from "../src/index.ts";

// Standalone typed handlers imported exclusively from the package root (strict typecheck).
const onMessageStart: ExtensionHandler<MessageStartEvent> = (_event, _ctx) => {};
const onMessageUpdate: ExtensionHandler<MessageUpdateEvent> = (_event, _ctx) => {};
const onMessageEnd: ExtensionHandler<MessageEndEvent, MessageEndEventResult> = (_event, _ctx) => undefined;
const onToolExecStart: ExtensionHandler<ToolExecutionStartEvent> = (_event, _ctx) => {};
const onToolExecUpdate: ExtensionHandler<ToolExecutionUpdateEvent> = (_event, _ctx) => {};
const onToolExecEnd: ExtensionHandler<ToolExecutionEndEvent> = (_event, _ctx) => {};
const onModelSelect: ExtensionHandler<ModelSelectEvent> = (event, _ctx) => {
	const _source: ModelSelectSource = event.source;
	void _source;
};
const onThinkingSelect: ExtensionHandler<ThinkingLevelSelectEvent> = (_event, _ctx) => {};
const onAfterProvider: ExtensionHandler<AfterProviderResponseEvent> = (_event, _ctx) => {};
const onAgentSettled: ExtensionHandler<AgentSettledEvent> = (_event, _ctx) => {};
const onResourcesDiscover: ExtensionHandler<ResourcesDiscoverEvent, ResourcesDiscoverResult> = () => undefined;
const onContext: ExtensionHandler<ContextEvent, ContextEventResult> = (event) => ({ messages: event.messages });
const onToolResult: ExtensionHandler<ToolResultEvent, ToolResultEventResult> = (event) => {
	const _narrow:
		| BashToolResultEvent
		| ReadToolResultEvent
		| EditToolResultEvent
		| WriteToolResultEvent
		| GrepToolResultEvent
		| FindToolResultEvent
		| LsToolResultEvent
		| CustomToolResultEvent = event;
	void _narrow;
	return undefined;
};
const onBeforeCompact: ExtensionHandler<SessionBeforeCompactEvent, SessionBeforeCompactResult> = () => ({
	cancel: false,
});
const onBeforeSwitch: ExtensionHandler<SessionBeforeSwitchEvent, SessionBeforeSwitchResult> = () => ({ cancel: false });
const onBeforeFork: ExtensionHandler<SessionBeforeForkEvent, SessionBeforeForkResult> = () => ({ cancel: false });
const onBeforeTree: ExtensionHandler<SessionBeforeTreeEvent, SessionBeforeTreeResult> = (event) => {
	const _prep: TreePreparation = event.preparation;
	void _prep;
	return { cancel: false };
};

function wireStandaloneHandlers(omk: ExtensionAPI): void {
	omk.on("message_start", onMessageStart);
	omk.on("message_update", onMessageUpdate);
	omk.on("message_end", onMessageEnd);
	omk.on("tool_execution_start", onToolExecStart);
	omk.on("tool_execution_update", onToolExecUpdate);
	omk.on("tool_execution_end", onToolExecEnd);
	omk.on("model_select", onModelSelect);
	omk.on("thinking_level_select", onThinkingSelect);
	omk.on("after_provider_response", onAfterProvider);
	omk.on("agent_settled", onAgentSettled);
	omk.on("resources_discover", onResourcesDiscover);
	omk.on("context", onContext);
	omk.on("tool_result", onToolResult);
	omk.on("session_before_compact", onBeforeCompact);
	omk.on("session_before_switch", onBeforeSwitch);
	omk.on("session_before_fork", onBeforeFork);
	omk.on("session_before_tree", onBeforeTree);
}

describe("P1-04 public SDK event exports from package root", () => {
	it("supports standalone strict-typed event handlers without deep imports", () => {
		const registered: string[] = [];
		const fakeApi = {
			on: (event: string) => {
				registered.push(event);
			},
		} as unknown as ExtensionAPI;

		wireStandaloneHandlers(fakeApi);

		// Reference remaining imported event/context types to enforce strict compilation
		const _typeWitness = null as unknown as
			| AgentStartEvent
			| AgentEndEvent
			| BeforeAgentStartEvent
			| BeforeAgentStartEventResult
			| BeforeProviderRequestEvent
			| ExtensionContext
			| InputEvent
			| InputEventResult
			| ReplacedSessionContext
			| SessionCompactEvent
			| SessionEvent
			| SessionInfoChangedEvent
			| SessionShutdownEvent
			| SessionStartEvent
			| SessionTreeEvent
			| ToolCallEvent
			| ToolCallEventResult
			| ToolRenderContext
			| TurnStartEvent
			| TurnEndEvent
			| UserBashEvent
			| UserBashEventResult;
		void _typeWitness;

		expect(registered).toEqual([
			"message_start",
			"message_update",
			"message_end",
			"tool_execution_start",
			"tool_execution_update",
			"tool_execution_end",
			"model_select",
			"thinking_level_select",
			"after_provider_response",
			"agent_settled",
			"resources_discover",
			"context",
			"tool_result",
			"session_before_compact",
			"session_before_switch",
			"session_before_fork",
			"session_before_tree",
		]);
	});
});
