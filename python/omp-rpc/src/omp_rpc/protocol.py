from __future__ import annotations

import base64
import mimetypes
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, NotRequired, TypedDict, TypeAlias, cast

JsonPrimitive: TypeAlias = str | int | float | bool | None
JsonValue: TypeAlias = JsonPrimitive | list["JsonValue"] | dict[str, "JsonValue"]
JsonObject: TypeAlias = dict[str, JsonValue]

Attribution: TypeAlias = Literal["user", "agent"]
ThinkingLevel: TypeAlias = Literal["off", "minimal", "low", "medium", "high", "xhigh"]
StreamingBehavior: TypeAlias = Literal["steer", "followUp"]
SteeringMode: TypeAlias = Literal["all", "one-at-a-time"]
InterruptMode: TypeAlias = Literal["immediate", "wait"]
StopReason: TypeAlias = Literal["stop", "length", "toolUse", "error", "aborted"]
NotifyType: TypeAlias = Literal["info", "warning", "error"]
WidgetPlacement: TypeAlias = Literal["aboveEditor", "belowEditor"]


class TextContent(TypedDict, total=False):
    type: Literal["text"]
    text: str
    textSignature: NotRequired[str]


class ThinkingContent(TypedDict, total=False):
    type: Literal["thinking"]
    thinking: str
    thinkingSignature: NotRequired[str]


class RedactedThinkingContent(TypedDict, total=False):
    type: Literal["redactedThinking"]
    data: str


class ImageContent(TypedDict, total=False):
    type: Literal["image"]
    data: str
    mimeType: str


class ToolCall(TypedDict, total=False):
    type: Literal["toolCall"]
    id: str
    name: str
    arguments: dict[str, Any]
    thoughtSignature: NotRequired[str]
    intent: NotRequired[str]


class UsageCost(TypedDict):
    input: float
    output: float
    cacheRead: float
    cacheWrite: float
    total: float


class Usage(TypedDict, total=False):
    input: int
    output: int
    cacheRead: int
    cacheWrite: int
    totalTokens: int
    premiumRequests: NotRequired[int]
    cost: UsageCost


class UserMessage(TypedDict, total=False):
    role: Literal["user"]
    content: str | list[TextContent | ImageContent]
    synthetic: NotRequired[bool]
    attribution: NotRequired[Attribution]
    providerPayload: NotRequired[JsonObject]
    timestamp: int


class DeveloperMessage(TypedDict, total=False):
    role: Literal["developer"]
    content: str | list[TextContent | ImageContent]
    attribution: NotRequired[Attribution]
    providerPayload: NotRequired[JsonObject]
    timestamp: int


class AssistantMessage(TypedDict, total=False):
    role: Literal["assistant"]
    content: list[TextContent | ThinkingContent | RedactedThinkingContent | ToolCall]
    api: str
    provider: str
    model: str
    responseId: NotRequired[str]
    usage: Usage
    stopReason: StopReason
    errorMessage: NotRequired[str]
    providerPayload: NotRequired[JsonObject]
    timestamp: int
    duration: NotRequired[int]
    ttft: NotRequired[int]


class ToolResultMessage(TypedDict, total=False):
    role: Literal["toolResult"]
    toolCallId: str
    toolName: str
    content: list[TextContent | ImageContent]
    details: NotRequired[JsonValue]
    isError: bool
    attribution: NotRequired[Attribution]
    prunedAt: NotRequired[int]
    timestamp: int


class BashExecutionMessage(TypedDict, total=False):
    role: Literal["bashExecution"]
    command: str
    output: str
    exitCode: int | None
    cancelled: bool
    truncated: bool
    meta: NotRequired[JsonObject]
    timestamp: int
    excludeFromContext: NotRequired[bool]


class PythonExecutionMessage(TypedDict, total=False):
    role: Literal["pythonExecution"]
    code: str
    output: str
    exitCode: int | None
    cancelled: bool
    truncated: bool
    meta: NotRequired[JsonObject]
    timestamp: int
    excludeFromContext: NotRequired[bool]


class CustomMessage(TypedDict, total=False):
    role: Literal["custom"]
    customType: str
    content: str | list[TextContent | ImageContent]
    display: bool
    details: NotRequired[JsonValue]
    attribution: NotRequired[Attribution]
    timestamp: int


class HookMessage(TypedDict, total=False):
    role: Literal["hookMessage"]
    customType: str
    content: str | list[TextContent | ImageContent]
    display: bool
    details: NotRequired[JsonValue]
    attribution: NotRequired[Attribution]
    timestamp: int


class BranchSummaryMessage(TypedDict, total=False):
    role: Literal["branchSummary"]
    summary: str
    fromId: str
    timestamp: int


class CompactionSummaryMessage(TypedDict, total=False):
    role: Literal["compactionSummary"]
    summary: str
    shortSummary: NotRequired[str]
    tokensBefore: int
    providerPayload: NotRequired[JsonObject]
    timestamp: int


class FileMentionItem(TypedDict, total=False):
    path: str
    content: str
    lineCount: NotRequired[int]
    byteSize: NotRequired[int]
    skippedReason: NotRequired[Literal["tooLarge"]]
    image: NotRequired[ImageContent]


class FileMentionMessage(TypedDict, total=False):
    role: Literal["fileMention"]
    files: list[FileMentionItem]
    timestamp: int


AgentMessage: TypeAlias = (
    UserMessage
    | DeveloperMessage
    | AssistantMessage
    | ToolResultMessage
    | BashExecutionMessage
    | PythonExecutionMessage
    | CustomMessage
    | HookMessage
    | BranchSummaryMessage
    | CompactionSummaryMessage
    | FileMentionMessage
)


class AssistantMessageStartEvent(TypedDict):
    type: Literal["start"]
    partial: AssistantMessage


class AssistantTextStartEvent(TypedDict):
    type: Literal["text_start"]
    contentIndex: int
    partial: AssistantMessage


class AssistantTextDeltaEvent(TypedDict):
    type: Literal["text_delta"]
    contentIndex: int
    delta: str
    partial: AssistantMessage


class AssistantTextEndEvent(TypedDict):
    type: Literal["text_end"]
    contentIndex: int
    content: str
    partial: AssistantMessage


class AssistantThinkingStartEvent(TypedDict):
    type: Literal["thinking_start"]
    contentIndex: int
    partial: AssistantMessage


class AssistantThinkingDeltaEvent(TypedDict):
    type: Literal["thinking_delta"]
    contentIndex: int
    delta: str
    partial: AssistantMessage


class AssistantThinkingEndEvent(TypedDict):
    type: Literal["thinking_end"]
    contentIndex: int
    content: str
    partial: AssistantMessage


class AssistantToolCallStartEvent(TypedDict):
    type: Literal["toolcall_start"]
    contentIndex: int
    partial: AssistantMessage


class AssistantToolCallDeltaEvent(TypedDict):
    type: Literal["toolcall_delta"]
    contentIndex: int
    delta: str
    partial: AssistantMessage


class AssistantToolCallEndEvent(TypedDict):
    type: Literal["toolcall_end"]
    contentIndex: int
    toolCall: ToolCall
    partial: AssistantMessage


class AssistantDoneEvent(TypedDict):
    type: Literal["done"]
    reason: Literal["stop", "length", "toolUse"]
    message: AssistantMessage


class AssistantErrorEvent(TypedDict):
    type: Literal["error"]
    reason: Literal["aborted", "error"]
    error: AssistantMessage


AssistantMessageEvent: TypeAlias = (
    AssistantMessageStartEvent
    | AssistantTextStartEvent
    | AssistantTextDeltaEvent
    | AssistantTextEndEvent
    | AssistantThinkingStartEvent
    | AssistantThinkingDeltaEvent
    | AssistantThinkingEndEvent
    | AssistantToolCallStartEvent
    | AssistantToolCallDeltaEvent
    | AssistantToolCallEndEvent
    | AssistantDoneEvent
    | AssistantErrorEvent
)


@dataclass(slots=True, frozen=True)
class ModelCost:
    input: float
    output: float
    cache_read: float
    cache_write: float


@dataclass(slots=True, frozen=True)
class ThinkingConfig:
    min_level: ThinkingLevel
    max_level: ThinkingLevel
    mode: str


@dataclass(slots=True, frozen=True)
class ModelInfo:
    id: str
    name: str
    api: str
    provider: str
    base_url: str
    reasoning: bool
    input_modalities: tuple[str, ...]
    cost: ModelCost
    context_window: int
    max_tokens: int
    headers: dict[str, str] | None = None
    premium_multiplier: float | None = None
    prefer_websockets: bool | None = None
    context_promotion_target: str | None = None
    priority: int | None = None
    thinking: ThinkingConfig | None = None
    compat: JsonObject | None = None


@dataclass(slots=True, frozen=True)
class ToolDescriptor:
    name: str
    description: str
    parameters: JsonValue


@dataclass(slots=True, frozen=True)
class SessionState:
    model: ModelInfo | None
    thinking_level: ThinkingLevel | None
    is_streaming: bool
    is_compacting: bool
    steering_mode: SteeringMode
    follow_up_mode: SteeringMode
    interrupt_mode: InterruptMode
    session_file: str | None
    session_id: str
    session_name: str | None
    auto_compaction_enabled: bool
    message_count: int
    queued_message_count: int
    system_prompt: str | None = None
    dump_tools: tuple[ToolDescriptor, ...] = ()


@dataclass(slots=True, frozen=True)
class BashResult:
    output: str
    exit_code: int | None
    cancelled: bool
    truncated: bool
    total_lines: int
    total_bytes: int
    output_lines: int
    output_bytes: int
    artifact_id: str | None = None


@dataclass(slots=True, frozen=True)
class CompactionResult:
    summary: str
    first_kept_entry_id: str
    tokens_before: int
    short_summary: str | None = None
    details: JsonValue | None = None
    preserve_data: JsonObject | None = None


@dataclass(slots=True, frozen=True)
class ModelCycleResult:
    model: ModelInfo
    thinking_level: ThinkingLevel | None
    is_scoped: bool


@dataclass(slots=True, frozen=True)
class ThinkingLevelCycleResult:
    level: ThinkingLevel


@dataclass(slots=True, frozen=True)
class CancellationResult:
    cancelled: bool


@dataclass(slots=True, frozen=True)
class BranchMessage:
    entry_id: str
    text: str


@dataclass(slots=True, frozen=True)
class BranchResult:
    text: str
    cancelled: bool


@dataclass(slots=True, frozen=True)
class TokenUsage:
    input: int
    output: int
    cache_read: int
    cache_write: int
    total: int


@dataclass(slots=True, frozen=True)
class SessionStats:
    session_file: str | None
    session_id: str
    user_messages: int
    assistant_messages: int
    tool_calls: int
    tool_results: int
    total_messages: int
    tokens: TokenUsage
    premium_requests: int
    cost: float


@dataclass(slots=True, frozen=True)
class ReadyEvent:
    type: Literal["ready"] = "ready"


@dataclass(slots=True, frozen=True)
class ExtensionUiRequest:
    id: str
    method: str
    title: str | None = None
    options: tuple[str, ...] | None = None
    message: str | None = None
    placeholder: str | None = None
    prefill: str | None = None
    timeout: int | None = None
    prompt_style: bool | None = None
    target_id: str | None = None
    notify_type: NotifyType | None = None
    status_key: str | None = None
    status_text: str | None = None
    widget_key: str | None = None
    widget_lines: tuple[str, ...] | None = None
    widget_placement: WidgetPlacement | None = None
    text: str | None = None


@dataclass(slots=True, frozen=True)
class ExtensionError:
    extension_path: str
    event: str
    error: str
    type: Literal["extension_error"] = "extension_error"


@dataclass(slots=True, frozen=True)
class AgentStartEvent:
    type: Literal["agent_start"] = "agent_start"


@dataclass(slots=True, frozen=True)
class AgentEndEvent:
    messages: tuple[AgentMessage, ...]
    type: Literal["agent_end"] = "agent_end"


@dataclass(slots=True, frozen=True)
class TurnStartEvent:
    type: Literal["turn_start"] = "turn_start"


@dataclass(slots=True, frozen=True)
class TurnEndEvent:
    message: AgentMessage
    tool_results: tuple[ToolResultMessage, ...]
    type: Literal["turn_end"] = "turn_end"


@dataclass(slots=True, frozen=True)
class MessageStartEvent:
    message: AgentMessage
    type: Literal["message_start"] = "message_start"


@dataclass(slots=True, frozen=True)
class MessageUpdateEvent:
    message: AgentMessage
    assistant_message_event: AssistantMessageEvent
    type: Literal["message_update"] = "message_update"


@dataclass(slots=True, frozen=True)
class MessageEndEvent:
    message: AgentMessage
    type: Literal["message_end"] = "message_end"


@dataclass(slots=True, frozen=True)
class ToolExecutionStartEvent:
    tool_call_id: str
    tool_name: str
    args: JsonValue
    intent: str | None = None
    type: Literal["tool_execution_start"] = "tool_execution_start"


@dataclass(slots=True, frozen=True)
class ToolExecutionUpdateEvent:
    tool_call_id: str
    tool_name: str
    args: JsonValue
    partial_result: JsonValue
    type: Literal["tool_execution_update"] = "tool_execution_update"


@dataclass(slots=True, frozen=True)
class ToolExecutionEndEvent:
    tool_call_id: str
    tool_name: str
    result: JsonValue
    is_error: bool | None = None
    type: Literal["tool_execution_end"] = "tool_execution_end"


@dataclass(slots=True, frozen=True)
class AutoCompactionStartEvent:
    reason: Literal["threshold", "overflow", "idle"]
    action: Literal["context-full", "handoff"]
    type: Literal["auto_compaction_start"] = "auto_compaction_start"


@dataclass(slots=True, frozen=True)
class AutoCompactionEndEvent:
    action: Literal["context-full", "handoff"]
    result: CompactionResult | None
    aborted: bool
    will_retry: bool
    error_message: str | None = None
    skipped: bool | None = None
    type: Literal["auto_compaction_end"] = "auto_compaction_end"


@dataclass(slots=True, frozen=True)
class AutoRetryStartEvent:
    attempt: int
    max_attempts: int
    delay_ms: int
    error_message: str
    type: Literal["auto_retry_start"] = "auto_retry_start"


@dataclass(slots=True, frozen=True)
class AutoRetryEndEvent:
    success: bool
    attempt: int
    final_error: str | None = None
    type: Literal["auto_retry_end"] = "auto_retry_end"


@dataclass(slots=True, frozen=True)
class RetryFallbackAppliedEvent:
    from_model: str
    to_model: str
    role: str
    type: Literal["retry_fallback_applied"] = "retry_fallback_applied"


@dataclass(slots=True, frozen=True)
class RetryFallbackSucceededEvent:
    model: str
    role: str
    type: Literal["retry_fallback_succeeded"] = "retry_fallback_succeeded"


@dataclass(slots=True, frozen=True)
class TtsrTriggeredEvent:
    rules: tuple[JsonObject, ...]
    type: Literal["ttsr_triggered"] = "ttsr_triggered"


@dataclass(slots=True, frozen=True)
class TodoReminderEvent:
    todos: tuple[JsonObject, ...]
    attempt: int
    max_attempts: int
    type: Literal["todo_reminder"] = "todo_reminder"


@dataclass(slots=True, frozen=True)
class TodoAutoClearEvent:
    type: Literal["todo_auto_clear"] = "todo_auto_clear"


@dataclass(slots=True, frozen=True)
class UnknownNotification:
    payload: JsonObject
    type: Literal["unknown"] = "unknown"


RpcAgentEvent: TypeAlias = (
    AgentStartEvent
    | AgentEndEvent
    | TurnStartEvent
    | TurnEndEvent
    | MessageStartEvent
    | MessageUpdateEvent
    | MessageEndEvent
    | ToolExecutionStartEvent
    | ToolExecutionUpdateEvent
    | ToolExecutionEndEvent
    | AutoCompactionStartEvent
    | AutoCompactionEndEvent
    | AutoRetryStartEvent
    | AutoRetryEndEvent
    | RetryFallbackAppliedEvent
    | RetryFallbackSucceededEvent
    | TtsrTriggeredEvent
    | TodoReminderEvent
    | TodoAutoClearEvent
)

RpcNotification: TypeAlias = ReadyEvent | ExtensionUiRequest | ExtensionError | RpcAgentEvent | UnknownNotification


def image_from_path(path: str | Path, mime_type: str | None = None) -> ImageContent:
    file_path = Path(path)
    resolved_mime_type = mime_type or mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
    return {
        "type": "image",
        "mimeType": resolved_mime_type,
        "data": base64.b64encode(file_path.read_bytes()).decode("ascii"),
    }


def message_text(message: AgentMessage) -> str | None:
    role = message.get("role")
    if role not in {"user", "developer", "assistant", "toolResult", "custom", "hookMessage"}:
        return None

    content = message.get("content")
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return None

    fragments: list[str] = []
    for block in content:
        if not isinstance(block, dict):
            continue
        block_type = block.get("type")
        if block_type == "text" and isinstance(block.get("text"), str):
            fragments.append(cast(str, block["text"]))
        elif block_type == "thinking" and isinstance(block.get("thinking"), str):
            fragments.append(cast(str, block["thinking"]))
    return "".join(fragments) or None


def assistant_text(message: AgentMessage) -> str | None:
    if message.get("role") != "assistant":
        return None
    return message_text(message)


def parse_model_info(payload: JsonObject | None) -> ModelInfo | None:
    if payload is None:
        return None
    cost_payload = cast(dict[str, Any], payload.get("cost") or {})
    thinking_payload = payload.get("thinking")
    headers_payload = payload.get("headers")
    compat_payload = payload.get("compat")
    return ModelInfo(
        id=str(payload["id"]),
        name=str(payload["name"]),
        api=str(payload["api"]),
        provider=str(payload["provider"]),
        base_url=str(payload["baseUrl"]),
        reasoning=bool(payload.get("reasoning", False)),
        input_modalities=tuple(str(item) for item in cast(list[Any], payload.get("input") or [])),
        cost=ModelCost(
            input=float(cost_payload.get("input", 0.0)),
            output=float(cost_payload.get("output", 0.0)),
            cache_read=float(cost_payload.get("cacheRead", 0.0)),
            cache_write=float(cost_payload.get("cacheWrite", 0.0)),
        ),
        context_window=int(payload.get("contextWindow", 0)),
        max_tokens=int(payload.get("maxTokens", 0)),
        headers=dict(cast(dict[str, str], headers_payload)) if isinstance(headers_payload, dict) else None,
        premium_multiplier=float(payload["premiumMultiplier"]) if "premiumMultiplier" in payload else None,
        prefer_websockets=bool(payload["preferWebsockets"]) if "preferWebsockets" in payload else None,
        context_promotion_target=(
            str(payload["contextPromotionTarget"]) if "contextPromotionTarget" in payload else None
        ),
        priority=int(payload["priority"]) if "priority" in payload else None,
        thinking=(
            ThinkingConfig(
                min_level=cast(ThinkingLevel, thinking_payload["minLevel"]),
                max_level=cast(ThinkingLevel, thinking_payload["maxLevel"]),
                mode=str(thinking_payload["mode"]),
            )
            if isinstance(thinking_payload, dict)
            else None
        ),
        compat=dict(cast(dict[str, JsonValue], compat_payload)) if isinstance(compat_payload, dict) else None,
    )


def parse_tool_descriptor(payload: JsonObject) -> ToolDescriptor:
    return ToolDescriptor(
        name=str(payload["name"]),
        description=str(payload["description"]),
        parameters=cast(JsonValue, payload.get("parameters")),
    )


def parse_session_state(payload: JsonObject) -> SessionState:
    dump_tools = tuple(
        parse_tool_descriptor(cast(JsonObject, item)) for item in cast(list[Any], payload.get("dumpTools") or [])
    )
    return SessionState(
        model=parse_model_info(cast(JsonObject | None, payload.get("model"))),
        thinking_level=cast(ThinkingLevel | None, payload.get("thinkingLevel")),
        is_streaming=bool(payload.get("isStreaming", False)),
        is_compacting=bool(payload.get("isCompacting", False)),
        steering_mode=cast(SteeringMode, payload.get("steeringMode", "one-at-a-time")),
        follow_up_mode=cast(SteeringMode, payload.get("followUpMode", "one-at-a-time")),
        interrupt_mode=cast(InterruptMode, payload.get("interruptMode", "immediate")),
        session_file=str(payload["sessionFile"]) if payload.get("sessionFile") is not None else None,
        session_id=str(payload["sessionId"]),
        session_name=str(payload["sessionName"]) if payload.get("sessionName") is not None else None,
        auto_compaction_enabled=bool(payload.get("autoCompactionEnabled", False)),
        message_count=int(payload.get("messageCount", 0)),
        queued_message_count=int(payload.get("queuedMessageCount", 0)),
        system_prompt=str(payload["systemPrompt"]) if payload.get("systemPrompt") is not None else None,
        dump_tools=dump_tools,
    )


def parse_bash_result(payload: JsonObject) -> BashResult:
    return BashResult(
        output=str(payload.get("output", "")),
        exit_code=int(payload["exitCode"]) if payload.get("exitCode") is not None else None,
        cancelled=bool(payload.get("cancelled", False)),
        truncated=bool(payload.get("truncated", False)),
        total_lines=int(payload.get("totalLines", 0)),
        total_bytes=int(payload.get("totalBytes", 0)),
        output_lines=int(payload.get("outputLines", 0)),
        output_bytes=int(payload.get("outputBytes", 0)),
        artifact_id=str(payload["artifactId"]) if payload.get("artifactId") is not None else None,
    )


def parse_compaction_result(payload: JsonObject) -> CompactionResult:
    return CompactionResult(
        summary=str(payload.get("summary", "")),
        short_summary=str(payload["shortSummary"]) if payload.get("shortSummary") is not None else None,
        first_kept_entry_id=str(payload.get("firstKeptEntryId", "")),
        tokens_before=int(payload.get("tokensBefore", 0)),
        details=cast(JsonValue | None, payload.get("details")),
        preserve_data=cast(JsonObject | None, payload.get("preserveData")),
    )


def parse_model_cycle_result(payload: JsonObject | None) -> ModelCycleResult | None:
    if payload is None:
        return None
    model = parse_model_info(cast(JsonObject, payload.get("model")))
    if model is None:
        raise ValueError("cycle_model response did not include a model")
    return ModelCycleResult(
        model=model,
        thinking_level=cast(ThinkingLevel | None, payload.get("thinkingLevel")),
        is_scoped=bool(payload.get("isScoped", False)),
    )


def parse_thinking_level_cycle_result(payload: JsonObject | None) -> ThinkingLevelCycleResult | None:
    if payload is None or payload.get("level") is None:
        return None
    return ThinkingLevelCycleResult(level=cast(ThinkingLevel, payload["level"]))


def parse_cancellation_result(payload: JsonObject | None) -> CancellationResult:
    return CancellationResult(cancelled=bool((payload or {}).get("cancelled", False)))


def parse_branch_result(payload: JsonObject | None) -> BranchResult:
    payload = payload or {}
    return BranchResult(text=str(payload.get("text", "")), cancelled=bool(payload.get("cancelled", False)))


def parse_branch_messages(payload: JsonObject | None) -> tuple[BranchMessage, ...]:
    messages = cast(list[Any], (payload or {}).get("messages") or [])
    return tuple(
        BranchMessage(entry_id=str(item.get("entryId", "")), text=str(item.get("text", ""))) for item in messages
    )


def parse_session_stats(payload: JsonObject) -> SessionStats:
    tokens_payload = cast(dict[str, Any], payload.get("tokens") or {})
    return SessionStats(
        session_file=str(payload["sessionFile"]) if payload.get("sessionFile") is not None else None,
        session_id=str(payload.get("sessionId", "")),
        user_messages=int(payload.get("userMessages", 0)),
        assistant_messages=int(payload.get("assistantMessages", 0)),
        tool_calls=int(payload.get("toolCalls", 0)),
        tool_results=int(payload.get("toolResults", 0)),
        total_messages=int(payload.get("totalMessages", 0)),
        tokens=TokenUsage(
            input=int(tokens_payload.get("input", 0)),
            output=int(tokens_payload.get("output", 0)),
            cache_read=int(tokens_payload.get("cacheRead", 0)),
            cache_write=int(tokens_payload.get("cacheWrite", 0)),
            total=int(tokens_payload.get("total", 0)),
        ),
        premium_requests=int(payload.get("premiumRequests", 0)),
        cost=float(payload.get("cost", 0.0)),
    )


def parse_extension_ui_request(payload: JsonObject) -> ExtensionUiRequest:
    return ExtensionUiRequest(
        id=str(payload["id"]),
        method=str(payload["method"]),
        title=str(payload["title"]) if payload.get("title") is not None else None,
        options=tuple(str(item) for item in cast(list[Any], payload.get("options") or [])) or None,
        message=str(payload["message"]) if payload.get("message") is not None else None,
        placeholder=str(payload["placeholder"]) if payload.get("placeholder") is not None else None,
        prefill=str(payload["prefill"]) if payload.get("prefill") is not None else None,
        timeout=int(payload["timeout"]) if payload.get("timeout") is not None else None,
        prompt_style=bool(payload["promptStyle"]) if "promptStyle" in payload else None,
        target_id=str(payload["targetId"]) if payload.get("targetId") is not None else None,
        notify_type=cast(NotifyType | None, payload.get("notifyType")),
        status_key=str(payload["statusKey"]) if payload.get("statusKey") is not None else None,
        status_text=str(payload["statusText"]) if payload.get("statusText") is not None else None,
        widget_key=str(payload["widgetKey"]) if payload.get("widgetKey") is not None else None,
        widget_lines=tuple(str(item) for item in cast(list[Any], payload.get("widgetLines") or [])) or None,
        widget_placement=cast(WidgetPlacement | None, payload.get("widgetPlacement")),
        text=str(payload["text"]) if payload.get("text") is not None else None,
    )


def parse_extension_error(payload: JsonObject) -> ExtensionError:
    return ExtensionError(
        extension_path=str(payload.get("extensionPath", "")),
        event=str(payload.get("event", "")),
        error=str(payload.get("error", "")),
    )


def parse_notification(payload: JsonObject) -> RpcNotification:
    event_type = payload.get("type")
    if event_type == "ready":
        return ReadyEvent()
    if event_type == "extension_ui_request":
        return parse_extension_ui_request(payload)
    if event_type == "extension_error":
        return parse_extension_error(payload)
    if event_type == "agent_start":
        return AgentStartEvent()
    if event_type == "agent_end":
        return AgentEndEvent(messages=tuple(cast(list[AgentMessage], payload.get("messages") or [])))
    if event_type == "turn_start":
        return TurnStartEvent()
    if event_type == "turn_end":
        return TurnEndEvent(
            message=cast(AgentMessage, payload["message"]),
            tool_results=tuple(cast(list[ToolResultMessage], payload.get("toolResults") or [])),
        )
    if event_type == "message_start":
        return MessageStartEvent(message=cast(AgentMessage, payload["message"]))
    if event_type == "message_update":
        return MessageUpdateEvent(
            message=cast(AgentMessage, payload["message"]),
            assistant_message_event=cast(AssistantMessageEvent, payload["assistantMessageEvent"]),
        )
    if event_type == "message_end":
        return MessageEndEvent(message=cast(AgentMessage, payload["message"]))
    if event_type == "tool_execution_start":
        return ToolExecutionStartEvent(
            tool_call_id=str(payload.get("toolCallId", "")),
            tool_name=str(payload.get("toolName", "")),
            args=cast(JsonValue, payload.get("args")),
            intent=str(payload["intent"]) if payload.get("intent") is not None else None,
        )
    if event_type == "tool_execution_update":
        return ToolExecutionUpdateEvent(
            tool_call_id=str(payload.get("toolCallId", "")),
            tool_name=str(payload.get("toolName", "")),
            args=cast(JsonValue, payload.get("args")),
            partial_result=cast(JsonValue, payload.get("partialResult")),
        )
    if event_type == "tool_execution_end":
        return ToolExecutionEndEvent(
            tool_call_id=str(payload.get("toolCallId", "")),
            tool_name=str(payload.get("toolName", "")),
            result=cast(JsonValue, payload.get("result")),
            is_error=bool(payload["isError"]) if "isError" in payload else None,
        )
    if event_type == "auto_compaction_start":
        return AutoCompactionStartEvent(
            reason=cast(Literal["threshold", "overflow", "idle"], payload.get("reason", "threshold")),
            action=cast(Literal["context-full", "handoff"], payload.get("action", "context-full")),
        )
    if event_type == "auto_compaction_end":
        result_payload = payload.get("result")
        return AutoCompactionEndEvent(
            action=cast(Literal["context-full", "handoff"], payload.get("action", "context-full")),
            result=(
                parse_compaction_result(cast(JsonObject, result_payload)) if isinstance(result_payload, dict) else None
            ),
            aborted=bool(payload.get("aborted", False)),
            will_retry=bool(payload.get("willRetry", False)),
            error_message=str(payload["errorMessage"]) if payload.get("errorMessage") is not None else None,
            skipped=bool(payload["skipped"]) if "skipped" in payload else None,
        )
    if event_type == "auto_retry_start":
        return AutoRetryStartEvent(
            attempt=int(payload.get("attempt", 0)),
            max_attempts=int(payload.get("maxAttempts", 0)),
            delay_ms=int(payload.get("delayMs", 0)),
            error_message=str(payload.get("errorMessage", "")),
        )
    if event_type == "auto_retry_end":
        return AutoRetryEndEvent(
            success=bool(payload.get("success", False)),
            attempt=int(payload.get("attempt", 0)),
            final_error=str(payload["finalError"]) if payload.get("finalError") is not None else None,
        )
    if event_type == "retry_fallback_applied":
        return RetryFallbackAppliedEvent(
            from_model=str(payload.get("from", "")),
            to_model=str(payload.get("to", "")),
            role=str(payload.get("role", "")),
        )
    if event_type == "retry_fallback_succeeded":
        return RetryFallbackSucceededEvent(model=str(payload.get("model", "")), role=str(payload.get("role", "")))
    if event_type == "ttsr_triggered":
        return TtsrTriggeredEvent(rules=tuple(cast(list[JsonObject], payload.get("rules") or [])))
    if event_type == "todo_reminder":
        return TodoReminderEvent(
            todos=tuple(cast(list[JsonObject], payload.get("todos") or [])),
            attempt=int(payload.get("attempt", 0)),
            max_attempts=int(payload.get("maxAttempts", 0)),
        )
    if event_type == "todo_auto_clear":
        return TodoAutoClearEvent()
    return UnknownNotification(payload=dict(payload))
