/**
 * Kimi Wire Protocol Types — aligned with official spec v1.7
 *
 * Source: https://www.kimi.com/code/docs/en/kimi-code-cli/customization/wire-protocol.html
 * Protocol: JSON-RPC 2.0 based, bidirectional via stdin/stdout
 */

// ───────────────────────────────────────────────────────────────
// JSON-RPC 2.0 Base Types
// ───────────────────────────────────────────────────────────────

export interface JSONRPCRequest<Method extends string, Params> {
  jsonrpc: "2.0";
  method: Method;
  id: string;
  params: Params;
}

export interface JSONRPCNotification<Method extends string, Params> {
  jsonrpc: "2.0";
  method: Method;
  params: Params;
}

export interface JSONRPCSuccessResponse<Result> {
  jsonrpc: "2.0";
  id: string;
  result: Result;
}

export interface JSONRPCErrorResponse {
  jsonrpc: "2.0";
  id: string;
  error: JSONRPCError;
}

export type JSONRPCResponse<Result = unknown> = JSONRPCSuccessResponse<Result> | JSONRPCErrorResponse;

export interface JSONRPCError {
  code: number;
  message: string;
  data?: unknown;
}

/** @deprecated Use JSONRPCRequest instead */
export interface JsonRpcRequest<TParams = unknown> {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params?: TParams;
}

/** @deprecated Use JSONRPCSuccessResponse instead */
export interface JsonRpcResponse<TResult = unknown> {
  jsonrpc: "2.0";
  id: string;
  result?: TResult;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

// ───────────────────────────────────────────────────────────────
// Standard Error Codes
// ───────────────────────────────────────────────────────────────

export const JSONRPC_PARSE_ERROR = -32700;
export const JSONRPC_INVALID_REQUEST = -32600;
export const JSONRPC_METHOD_NOT_FOUND = -32601;
export const JSONRPC_INVALID_PARAMS = -32602;
export const JSONRPC_INTERNAL_ERROR = -32603;

export const WIRE_TURN_IN_PROGRESS = -32000;
export const WIRE_LLM_NOT_SET = -32001;
export const WIRE_LLM_NOT_SUPPORTED = -32002;
export const WIRE_LLM_SERVICE_ERROR = -32003;

// ───────────────────────────────────────────────────────────────
// Client / Server Metadata
// ───────────────────────────────────────────────────────────────

export interface ClientInfo {
  name: string;
  version?: string;
}

export interface ServerInfo {
  name: string;
  version: string;
}

export interface ClientCapabilities {
  /** Whether the client can handle QuestionRequest messages */
  supports_question?: boolean;
  /** Whether the client supports plan mode */
  supports_plan_mode?: boolean;
}

export interface ServerCapabilities {
  /** Whether the server supports sending QuestionRequest messages */
  supports_question?: boolean;
}

export interface ExternalTool {
  /** Tool name, must not conflict with built-in tools */
  name: string;
  /** Tool description */
  description: string;
  /** Parameter definition in JSON Schema format */
  parameters: Record<string, unknown>;
}

export interface ExternalToolsResult {
  /** Successfully registered tool names */
  accepted: string[];
  /** Failed tool registrations with reasons */
  rejected: Array<{ name: string; reason: string }>;
}

export interface SlashCommandInfo {
  name: string;
  description: string;
  aliases: string[];
}

export interface WireHookSubscription {
  /** Subscription ID, referenced in HookRequest */
  id: string;
  /** Event type to subscribe to, e.g. 'PreToolUse', 'Stop' */
  event: string;
  /** Regex filter, empty string matches all */
  matcher?: string;
  /** Timeout for client response in seconds, default 30 */
  timeout?: number;
}

export interface HooksInfo {
  /** List of all hook event types supported by the server */
  supported_events: string[];
  /** Currently configured hooks statistics */
  configured: Record<string, number>;
}

// ───────────────────────────────────────────────────────────────
// Method Parameters & Results
// ───────────────────────────────────────────────────────────────

export interface InitializeParams {
  /** Protocol version */
  protocol_version: string;
  /** Client info, optional */
  client?: ClientInfo;
  /** External tool definitions, optional */
  external_tools?: ExternalTool[];
  /** Client capabilities, optional */
  capabilities?: ClientCapabilities;
  /** Hook subscriptions, optional */
  hooks?: WireHookSubscription[];
}

export interface InitializeResult {
  /** Protocol version */
  protocol_version: string;
  /** Server info */
  server: ServerInfo;
  /** Available slash commands */
  slash_commands: SlashCommandInfo[];
  /** External tool registration result */
  external_tools?: ExternalToolsResult;
  /** Server capabilities */
  capabilities?: ServerCapabilities;
  /** Hook system info, optional */
  hooks?: HooksInfo;
}

export type PromptParams = {
  /** User input, can be plain text or array of content parts */
  user_input: string | ContentPart[];
};

export interface PromptResult {
  /** Turn end status */
  status: "finished" | "cancelled" | "max_steps_reached";
  /** Number of steps executed when status is max_steps_reached */
  steps?: number;
}

export interface SteerParams {
  /** User input, can be plain text or array of content parts */
  user_input: string | ContentPart[];
}

export interface SteerResult {
  /** Fixed as "steered" */
  status: "steered";
}

export interface SetPlanModeParams {
  /** Whether to enable plan mode */
  enabled: boolean;
}

export interface SetPlanModeResult {
  /** Fixed as "ok" */
  status: "ok";
  /** Plan mode state after the call */
  plan_mode: boolean;
}

export type CancelParams = Record<string, never>;
export type CancelResult = Record<string, never>;

export type ReplayParams = Record<string, never>;

export interface ReplayResult {
  /** Replay end status */
  status: "finished" | "cancelled";
  /** Number of replayed events */
  events: number;
  /** Number of replayed requests */
  requests: number;
}

// ───────────────────────────────────────────────────────────────
// Content Parts
// ───────────────────────────────────────────────────────────────

export type ContentPart =
  | TextPart
  | ThinkPart
  | ImageURLPart
  | AudioURLPart
  | VideoURLPart;

export interface TextPart {
  type: "text";
  /** Text content */
  text: string;
}

export interface ThinkPart {
  type: "think";
  /** Thinking content */
  think: string;
  /** Encrypted thinking content or signature, may be absent */
  encrypted?: string | null;
}

export interface ImageURLPart {
  type: "image_url";
  image_url: {
    /** Image URL, can be data URI */
    url: string;
    /** Image ID for distinguishing different images */
    id?: string | null;
  };
}

export interface AudioURLPart {
  type: "audio_url";
  audio_url: {
    /** Audio URL, can be data URI */
    url: string;
    /** Audio ID for distinguishing different audio */
    id?: string | null;
  };
}

export interface VideoURLPart {
  type: "video_url";
  video_url: {
    /** Video URL, can be data URI */
    url: string;
    /** Video ID for distinguishing different video */
    id?: string | null;
  };
}

// ───────────────────────────────────────────────────────────────
// Token Usage
// ───────────────────────────────────────────────────────────────

export interface TokenUsage {
  /** Input tokens excluding input_cache_read and input_cache_creation */
  input_other: number;
  /** Total output tokens */
  output: number;
  /** Cached input tokens */
  input_cache_read: number;
  /** Input tokens used for cache creation */
  input_cache_creation: number;
}

// ───────────────────────────────────────────────────────────────
// Events (Agent → Client, no response needed)
// ───────────────────────────────────────────────────────────────

export interface TurnBegin {
  /** User input, can be plain text or array of content parts */
  user_input: string | ContentPart[];
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface TurnEnd {
  // No additional fields
}

export interface StepBegin {
  /** Step number, starting from 1 */
  n: number;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface StepInterrupted {
  // No additional fields
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface CompactionBegin {
  // No additional fields
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface CompactionEnd {
  // No additional fields
}

export interface StatusUpdate {
  /** Context usage ratio, float between 0-1 */
  context_usage?: number | null;
  /** Number of tokens currently in the context */
  context_tokens?: number | null;
  /** Maximum number of tokens the context can hold */
  max_context_tokens?: number | null;
  /** Token usage stats for current step */
  token_usage?: TokenUsage | null;
  /** Message ID for current step */
  message_id?: string | null;
  /** Whether plan mode is active, null means no change */
  plan_mode?: boolean | null;
}

export interface ToolCallEvent {
  /** Fixed as "function" */
  type: "function";
  /** Tool call ID */
  id: string;
  function: {
    /** Tool name */
    name: string;
    /** JSON-format argument string, may be absent */
    arguments?: string | null;
  };
  /** Extra info, may be absent */
  extras?: object | null;
}

export interface ToolCallPart {
  /** Argument fragment for streaming tool call arguments */
  arguments_part?: string | null;
}

export interface ToolResultEvent {
  /** Corresponding tool call ID */
  tool_call_id: string;
  return_value: ToolReturnValue;
}

export interface ToolReturnValue {
  /** Whether this is an error */
  is_error: boolean;
  /** Output content returned to model */
  output: string | ContentPart[];
  /** Explanatory message for model */
  message: string;
  /** Display blocks shown to user */
  display: DisplayBlock[];
  /** Extra debug info, may be absent */
  extras?: object | null;
}

export interface ApprovalResponseEvent {
  /** Approval request ID */
  request_id: string;
  /** Approval result */
  response: "approve" | "approve_for_session" | "reject";
  /** Optional feedback text when rejecting */
  feedback?: string;
}

export interface SubagentEvent {
  /** Associated parent Agent tool call ID */
  parent_tool_call_id?: string | null;
  /** Subagent instance ID */
  agent_id?: string | null;
  /** Built-in subagent type used by this instance */
  subagent_type?: string | null;
  /** Event from subagent, nested Wire message format */
  event: { type: string; payload: object };
}

export interface SteerInput {
  /** User input, can be plain text or array of content parts */
  user_input: string | ContentPart[];
}

export interface PlanDisplay {
  /** Full markdown content of the plan */
  content: string;
  /** Path to the plan file */
  file_path: string;
}

export interface HookTriggered {
  /** Hook event type */
  event: string;
  /** Target of the hook */
  target: string;
  /** Number of matched hooks running in parallel */
  hook_count: number;
}

export interface HookResolved {
  /** Hook event type */
  event: string;
  /** Same as HookTriggered.target */
  target: string;
  /** Aggregate decision */
  action: "allow" | "block";
  /** Reason for blocking, empty if allowed */
  reason: string;
  /** Wall-clock time for the entire batch in milliseconds */
  duration_ms: number;
}

/** Union of all event payloads */
export type WireEventPayload =
  | TurnBegin
  | TurnEnd
  | StepBegin
  | StepInterrupted
  | CompactionBegin
  | CompactionEnd
  | StatusUpdate
  | TextPart
  | ThinkPart
  | ImageURLPart
  | AudioURLPart
  | VideoURLPart
  | ToolCallEvent
  | ToolCallPart
  | ToolResultEvent
  | ApprovalResponseEvent
  | SubagentEvent
  | SteerInput
  | PlanDisplay
  | HookTriggered
  | HookResolved;

/** Strongly-typed wire event emitted by the client */
export type WireEvent =
  | { type: "TurnBegin"; payload: TurnBegin }
  | { type: "TurnEnd" }
  | { type: "StepBegin"; payload: StepBegin }
  | { type: "StepInterrupted" }
  | { type: "CompactionBegin" }
  | { type: "CompactionEnd" }
  | { type: "StatusUpdate"; payload: StatusUpdate }
  | { type: "ContentPart"; payload: ContentPart }
  | { type: "ToolCall"; payload: ToolCallEvent }
  | { type: "ToolCallPart"; payload: ToolCallPart }
  | { type: "ToolResult"; payload: ToolResultEvent }
  | { type: "ApprovalResponse"; payload: ApprovalResponseEvent }
  | { type: "SubagentEvent"; payload: SubagentEvent }
  | { type: "SteerInput"; payload: SteerInput }
  | { type: "PlanDisplay"; payload: PlanDisplay }
  | { type: "HookTriggered"; payload: HookTriggered }
  | { type: "HookResolved"; payload: HookResolved };

// ───────────────────────────────────────────────────────────────
// Requests (Agent → Client, require response)
// ───────────────────────────────────────────────────────────────

export interface ApprovalRequest {
  /** Request ID */
  id: string;
  /** Associated tool call ID */
  tool_call_id: string;
  /** Sender (tool name) */
  sender: string;
  /** Action description */
  action: string;
  /** Detailed description */
  description: string;
  /** Display blocks shown to user */
  display?: DisplayBlock[];
  /** Where the request originated */
  source_kind?: "foreground_turn" | "background_agent" | null;
  /** Source identifier */
  source_id?: string | null;
  /** Subagent instance ID if from a subagent */
  agent_id?: string | null;
  /** Subagent type if from a subagent */
  subagent_type?: string | null;
  /** Human-readable source description */
  source_description?: string | null;
}

export interface ToolCallRequest {
  /** Tool call ID */
  id: string;
  /** Tool name */
  name: string;
  /** JSON-format argument string */
  arguments?: string | null;
}

export interface QuestionRequest {
  /** Request ID */
  id: string;
  /** Associated tool call ID */
  tool_call_id: string;
  /** Questions list (1–4 questions) */
  questions: QuestionItem[];
}

export interface QuestionItem {
  /** Question text */
  question: string;
  /** Short label, max 12 characters */
  header?: string;
  /** Available options (2–4) */
  options: QuestionOption[];
  /** Whether multiple options can be selected */
  multi_select?: boolean;
}

export interface QuestionOption {
  /** Option label */
  label: string;
  /** Option description */
  description?: string;
}

export interface QuestionResponse {
  /** Corresponding request ID */
  request_id: string;
  /** Answer mapping */
  answers: Record<string, string>;
}

export interface HookRequest {
  /** Request ID */
  id: string;
  /** Subscription ID */
  subscription_id: string;
  /** Hook event type */
  event: string;
  /** Target that triggered the hook */
  target: string;
  /** Complete event payload */
  input_data: object;
}

export interface HookResponse {
  /** Corresponding request ID */
  request_id: string;
  /** Decision */
  action: "allow" | "block";
  /** Reason for blocking */
  reason: string;
}

/** Union of all request payloads */
export type WireRequestPayload =
  | ApprovalRequest
  | ToolCallRequest
  | QuestionRequest
  | HookRequest;

/** Strongly-typed wire request received from the agent */
export type WireRequest =
  | { type: "ApprovalRequest"; payload: ApprovalRequest }
  | { type: "ToolCallRequest"; payload: ToolCallRequest }
  | { type: "QuestionRequest"; payload: QuestionRequest }
  | { type: "HookRequest"; payload: HookRequest };

// ───────────────────────────────────────────────────────────────
// Display Blocks
// ───────────────────────────────────────────────────────────────

export type DisplayBlock =
  | UnknownDisplayBlock
  | BriefDisplayBlock
  | DiffDisplayBlock
  | TodoDisplayBlock
  | ShellDisplayBlock;

export interface UnknownDisplayBlock {
  type: string;
  data: object;
}

export interface BriefDisplayBlock {
  type: "brief";
  text: string;
}

export interface DiffDisplayBlock {
  type: "diff";
  path: string;
  old_text: string;
  new_text: string;
}

export interface TodoDisplayBlock {
  type: "todo";
  items: TodoDisplayItem[];
}

export interface TodoDisplayItem {
  title: string;
  status: "pending" | "in_progress" | "done";
}

export interface ShellDisplayBlock {
  type: "shell";
  language: string;
  command: string;
}

// ───────────────────────────────────────────────────────────────
// Type Guards
// ───────────────────────────────────────────────────────────────

export function isTextPart(part: ContentPart): part is TextPart {
  return part.type === "text";
}

export function isThinkPart(part: ContentPart): part is ThinkPart {
  return part.type === "think";
}

export function isImageURLPart(part: ContentPart): part is ImageURLPart {
  return part.type === "image_url";
}

export function isAudioURLPart(part: ContentPart): part is AudioURLPart {
  return part.type === "audio_url";
}

export function isVideoURLPart(part: ContentPart): part is VideoURLPart {
  return part.type === "video_url";
}

export function isWireEventMessage(msg: unknown): msg is { type: string; payload: object } {
  return (
    typeof msg === "object" &&
    msg !== null &&
    "type" in msg &&
    typeof (msg as Record<string, unknown>).type === "string" &&
    "payload" in msg &&
    typeof (msg as Record<string, unknown>).payload === "object"
  );
}

export function isDisplayBlock(value: unknown): value is DisplayBlock {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof (value as Record<string, unknown>).type === "string"
  );
}

// Wrapper types for event/request method params
export interface EventParams {
  type: string;
  payload: object;
}

export interface RequestParams {
  type: "ApprovalRequest" | "ToolCallRequest" | "QuestionRequest" | "HookRequest";
  payload: object;
}

/** Union of all wire messages (events + requests) */
export type WireMessage = WireEvent | WireRequest;

/** Type guard for wire request messages */
export function isWireRequestMessage(msg: unknown): msg is { type: string; payload: object } {
  return (
    typeof msg === "object" &&
    msg !== null &&
    "type" in msg &&
    typeof (msg as Record<string, unknown>).type === "string" &&
    "payload" in msg &&
    typeof (msg as Record<string, unknown>).payload === "object"
  );
}
