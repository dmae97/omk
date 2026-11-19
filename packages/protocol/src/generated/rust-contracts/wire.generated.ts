// Generated from native/omk-contract/src. Do not edit; import the per-module files instead.
// Run: node scripts/generate-contracts.mjs --write
// JSON wire values, not arbitrary JavaScript values.
export type JsonValue = null | boolean | number | string | Array<JsonValue> | { [key: string]: JsonValue };
export type lib$HOST_WIRE_VERSION = 1;
export type compat$PackageManifestDialect = "omk" | "omk+pi";
export type host_wire$SpecifierAlias = { specifier: string; target: string };
export type host_wire$ExtensionEvent =
	| "resources_discover"
	| "session_start"
	| "session_info_changed"
	| "session_before_fork"
	| "session_compact"
	| "session_shutdown"
	| "session_before_tree"
	| "session_tree"
	| "context"
	| "after_provider_response"
	| "before_agent_start"
	| "agent_start"
	| "agent_end"
	| "agent_settled"
	| "turn_start"
	| "turn_end"
	| "message_start"
	| "message_update"
	| "message_end"
	| "tool_execution_start"
	| "tool_execution_update"
	| "tool_execution_end"
	| "model_select"
	| "thinking_level_select"
	| "tool_call"
	| "tool_result"
	| "user_bash"
	| "input";
export type host_wire$ExtensionApiMethod =
	| "appendEntry"
	| "exec"
	| "getActiveTools"
	| "getAllTools"
	| "getCommands"
	| "getFlag"
	| "getSessionName"
	| "getThinkingLevel"
	| "isMcpToolBound"
	| "on"
	| "registerCommand"
	| "registerFlag"
	| "registerMessageRenderer"
	| "registerProvider"
	| "registerShortcut"
	| "registerTool"
	| "sendMessage"
	| "sendUserMessage"
	| "setActiveTools"
	| "setLabel"
	| "setModel"
	| "setSessionName"
	| "setThinkingLevel"
	| "unregisterProvider";
export type host_wire$ExtensionEntry = { path: string };
export type host_wire$ExtensionLoadError = { path: string; message: string; hint: string };
export type host_wire$CoreFrame =
	| ({ type: "ready" } & { wire_version: number })
	| ({ type: "load_extensions" } & {
			request_id: number;
			cwd: string;
			dialect: compat$PackageManifestDialect;
			specifiers: Array<host_wire$SpecifierAlias>;
			entries: Array<host_wire$ExtensionEntry>;
	  })
	| ({ type: "dispatch_event" } & { request_id: number; event: host_wire$ExtensionEvent; payload: JsonValue })
	| ({ type: "replica_update" } & { revision: number; snapshot: JsonValue })
	| ({ type: "abort" } & { request_id: number })
	| { type: "shutdown" };
export type host_wire$HostFrame =
	| ({ type: "hello" } & { wire_version: number; node_version: string })
	| ({ type: "extensions_loaded" } & {
			request_id: number;
			loaded: Array<string>;
			errors: Array<host_wire$ExtensionLoadError>;
	  })
	| ({ type: "event_result" } & { request_id: number; result: JsonValue })
	| ({ type: "api_call" } & { call_id: number; method: host_wire$ExtensionApiMethod; payload: JsonValue })
	| ({ type: "host_lost" } & { pending_request_ids: Array<number>; reason: string });
export type host_wire$MAX_FRAME_BYTES = 1048576;
export type jsonl$JsonRecord<T> = T;
export type rpc$Optional<T> = T | null;
export type rpc$Bool<B extends boolean> = B;
export type rpc$Version<V extends number> = V;
export type rpc$Nullable<T> = T | null;
export type rpc$Open<T> = T & session$ExtraFields;
export type rpc$RpcInput = rpc$command$RpcCommand | rpc$ui$RpcUiResponse;
export type rpc$RpcOutput = rpc$response$RpcResponse | rpc$ui$RpcUiRequest | rpc$events$RpcEvent;
export type rpc$RpcMessage = rpc$RpcInput | rpc$RpcOutput;
export type rpc$RpcRecord = jsonl$JsonRecord<rpc$RpcMessage>;
export type rpc$CommandBody = rpc$command$CommandBody;
export type rpc$RpcCommand = rpc$command$RpcCommand;
export type rpc$ThinkingLevel = rpc$command$ThinkingLevel;
export type rpc$RpcEvent = rpc$events$RpcEvent;
export type rpc$RpcResponse = rpc$response$RpcResponse;
export type rpc$RpcUiRequest = rpc$ui$RpcUiRequest;
export type rpc$RpcUiResponse = rpc$ui$RpcUiResponse;
export type rpc$command$ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
export type rpc$command$QueueMode = "all" | "one-at-a-time";
export type rpc$command$StreamingBehavior = "steer" | "followUp";
export type rpc$command$RpcImage = { type: "image" } & session_message$ImageContent;
export type rpc$command$RpcCommand = rpc$Open<rpc$command$CommandFields>;
export type rpc$command$CommandFields = { id?: string } & rpc$command$CommandBody;
export type rpc$command$CommandBody =
	| ({ type: "prompt" } & {
			message: string;
			images?: Array<rpc$command$RpcImage>;
			streamingBehavior?: rpc$command$StreamingBehavior;
	  })
	| ({ type: "steer" } & { message: string; images?: Array<rpc$command$RpcImage> })
	| ({ type: "follow_up" } & { message: string; images?: Array<rpc$command$RpcImage> })
	| { type: "abort" }
	| ({ type: "new_session" } & { parentSession?: string })
	| { type: "get_state" }
	| ({ type: "set_model" } & { provider: string; modelId: string })
	| { type: "cycle_model" }
	| { type: "get_available_models" }
	| ({ type: "set_thinking_level" } & { level: rpc$command$ThinkingLevel })
	| { type: "cycle_thinking_level" }
	| ({ type: "set_steering_mode" } & { mode: rpc$command$QueueMode })
	| ({ type: "set_follow_up_mode" } & { mode: rpc$command$QueueMode })
	| ({ type: "compact" } & { customInstructions?: string })
	| ({ type: "set_auto_compaction" } & { enabled: boolean })
	| ({ type: "set_auto_retry" } & { enabled: boolean })
	| { type: "abort_retry" }
	| ({ type: "bash" } & { command: string; excludeFromContext?: boolean })
	| { type: "abort_bash" }
	| { type: "get_session_stats" }
	| ({ type: "export_html" } & { outputPath?: string })
	| ({ type: "switch_session" } & { sessionPath: string })
	| ({ type: "fork" } & { entryId: string })
	| { type: "clone" }
	| { type: "get_fork_messages" }
	| { type: "get_last_assistant_text" }
	| ({ type: "set_session_name" } & { name: string })
	| { type: "get_messages" }
	| { type: "get_commands" };
export type rpc$data$Modality = "text" | "image";
export type rpc$data$Model = {
	id: string;
	name: string;
	api: string;
	provider: string;
	baseUrl: string;
	reasoning: boolean;
	input: Array<rpc$data$Modality>;
	cost: rpc$data$ModelCost;
	contextWindow: number;
	maxTokens: number;
	thinkingLevelMap?: Record<rpc$command$ThinkingLevel, string | null>;
	headers?: Record<string, string>;
	compat?: session$ExtraFields;
} & session$ExtraFields;
export type rpc$data$ModelCost = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
} & session$ExtraFields;
export type rpc$data$RpcSessionState = {
	model?: rpc$data$Model;
	thinkingLevel: rpc$command$ThinkingLevel;
	isStreaming: boolean;
	isCompacting: boolean;
	steeringMode: rpc$command$QueueMode;
	followUpMode: rpc$command$QueueMode;
	sessionFile?: string;
	sessionId: string;
	sessionName?: string;
	autoCompactionEnabled: boolean;
	messageCount: number;
	pendingMessageCount: number;
	lastTermination?: rpc$status$SessionTermination;
} & session$ExtraFields;
export type rpc$data$CompactionResult = {
	summary: string;
	firstKeptEntryId: string;
	tokensBefore: number;
	details?: JsonValue;
} & session$ExtraFields;
export type rpc$data$BashResult = {
	output: string;
	cancelled: boolean;
	truncated: boolean;
	exitCode?: number;
	fullOutputPath?: string;
} & session$ExtraFields;
export type rpc$data$SessionStats = {
	sessionFile?: string;
	sessionId: string;
	userMessages: number;
	assistantMessages: number;
	toolCalls: number;
	toolResults: number;
	totalMessages: number;
	tokens: rpc$data$TokenTotals;
	promptCache: rpc$data$PromptCache;
	cost: number;
	contextUsage?: rpc$data$ContextUsage;
} & session$ExtraFields;
export type rpc$data$TokenTotals = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	total: number;
} & session$ExtraFields;
export type rpc$data$PromptCache = {
	providerEligibleInputTokens: number;
	providerHitRate: number;
	keyChanges: number;
	boundaryBypasses: number;
	stablePrefixCharacters: number;
	lastBreakReason?: string;
} & session$ExtraFields;
export type rpc$data$ContextUsage = {
	tokens: rpc$Nullable<number>;
	contextWindow: number;
	percent: rpc$Nullable<number>;
} & session$ExtraFields;
export type rpc$data$SourceInfo = {
	path: string;
	source: string;
	scope: rpc$data$SourceScope;
	origin: rpc$data$SourceOrigin;
	baseDir?: string;
} & session$ExtraFields;
export type rpc$data$SourceScope = "user" | "project" | "temporary";
export type rpc$data$SourceOrigin = "package" | "top-level";
export type rpc$data$CommandSource = "extension" | "prompt" | "skill";
export type rpc$data$RpcSlashCommand = {
	name: string;
	source: rpc$data$CommandSource;
	sourceInfo: rpc$data$SourceInfo;
	description?: string;
} & session$ExtraFields;
export type rpc$data$ModelCycle = {
	model: rpc$data$Model;
	thinkingLevel: rpc$command$ThinkingLevel;
	isScoped: boolean;
} & session$ExtraFields;
export type rpc$data$Level = { level: rpc$command$ThinkingLevel } & session$ExtraFields;
export type rpc$data$Cancelled = { cancelled: boolean } & session$ExtraFields;
export type rpc$data$Fork = { text: string; cancelled: boolean } & session$ExtraFields;
export type rpc$data$ExportPath = { path: string } & session$ExtraFields;
export type rpc$data$LastText = { text: rpc$Nullable<string> } & session$ExtraFields;
export type rpc$data$ForkMessage = { entryId: string; text: string } & session$ExtraFields;
export type rpc$data$ForkMessages = { messages: Array<rpc$data$ForkMessage> } & session$ExtraFields;
export type rpc$data$Messages = { messages: Array<session_message$SessionMessage> } & session$ExtraFields;
export type rpc$events$Outcome = "completed" | "failed" | "aborted";
export type rpc$events$ProviderOutcome = "completed" | "error" | "aborted";
export type rpc$events$CompactionReason = "manual" | "threshold" | "overflow";
export type rpc$events$Boundary = "stream-dispatch";
export type rpc$events$DeniedReason = "contract-violation" | "aborted";
export type rpc$events$LateOutcome = "resolved" | "rejected";
export type rpc$events$Disposition = "timeout" | "aborted";
export type rpc$events$MutationSource = "tool_late_settlement";
export type rpc$events$MutationScope = { root: string; paths: Array<string> } & session$ExtraFields;
export type rpc$events$SummarySource =
	| { source: "branchSummary" }
	| ({ source: "compaction" } & { reason: rpc$events$CompactionReason });
export type rpc$events$RpcEvent = rpc$Open<rpc$events$EventBody>;
export type rpc$events$EventBody =
	| { type: "agent_start" }
	| ({ type: "agent_end" } & { messages: Array<session_message$SessionMessage>; willRetry: boolean })
	| { type: "turn_start" }
	| ({ type: "turn_end" } & { message: session_message$SessionMessage; toolResults: Array<rpc$stream$ToolResult> })
	| ({ type: "message_start" } & { message: session_message$SessionMessage })
	| ({ type: "message_end" } & { message: session_message$SessionMessage })
	| ({ type: "message_update" } & {
			message: session_message$SessionMessage;
			assistantMessageEvent: rpc$stream$AssistantEvent;
	  })
	| ({ type: "tool_execution_start" } & { toolCallId: string; toolName: string; args: JsonValue })
	| ({ type: "tool_execution_update" } & {
			toolCallId: string;
			toolName: string;
			args: JsonValue;
			partialResult: JsonValue;
	  })
	| ({ type: "tool_execution_end" } & { toolCallId: string; toolName: string; result: JsonValue; isError: boolean })
	| ({ type: "tool_execution_late_settlement" } & {
			toolCallId: string;
			toolName: string;
			disposition: rpc$events$Disposition;
			outcome: rpc$events$LateOutcome;
	  })
	| ({ type: "provider_denied" } & { requestId: string; deniedReason: rpc$events$DeniedReason })
	| ({ type: "provider_request" } & {
			requestId: string;
			provider: string;
			model: string;
			maxOutputTokens: number;
			omittedToolImages?: number;
			boundary: rpc$events$Boundary;
	  })
	| ({ type: "provider_request_end" } & {
			requestId: string;
			outcome: rpc$events$ProviderOutcome;
			boundary: rpc$events$Boundary;
	  })
	| ({ type: "prompt_settled" } & {
			promptRunId: string;
			outcome: rpc$events$Outcome;
			durationMs: number;
			terminationKind?: string;
	  })
	| ({ type: "queue_update" } & { steering: Array<string>; followUp: Array<string> })
	| ({ type: "compaction_start" } & { reason: rpc$events$CompactionReason })
	| ({ type: "compaction_end" } & {
			reason: rpc$events$CompactionReason;
			result?: rpc$data$CompactionResult;
			aborted: boolean;
			willRetry: boolean;
			errorMessage?: string;
	  })
	| ({ type: "session_info_changed" } & { name?: string })
	| ({ type: "thinking_level_changed" } & { level: rpc$command$ThinkingLevel })
	| ({ type: "auto_retry_start" } & { attempt: number; maxAttempts: number; delayMs: number; errorMessage: string })
	| ({ type: "auto_retry_end" } & { success: boolean; attempt: number; finalError?: string })
	| ({ type: "pinned_quota_failover" } & { from: string; to: string; message: string })
	| ({ type: "bash_execution_update" } & { id?: string; delta: string })
	| ({ type: "summarization_retry_scheduled" } & {
			attempt: number;
			maxAttempts: number;
			delayMs: number;
			errorMessage: string;
	  })
	| ({ type: "summarization_retry_attempt_start" } & rpc$events$SummarySource)
	| { type: "summarization_retry_finished" }
	| ({ type: "session_termination" } & { termination: rpc$status$SessionTermination })
	| ({ type: "workspace_mutation" } & {
			source: rpc$events$MutationSource;
			toolCallId: string;
			toolName: string;
			payload: rpc$events$MutationScope;
	  })
	| ({ type: "extension_error" } & { extensionPath: string; event: string; error: string })
	| ({ type: "task_result" } & { version: rpc$Version<2>; projection: rpc$status$TaskProjection })
	| ({ type: "task_result_downgrade" } & {
			version: rpc$Version<2>;
			promptRunId: string;
			from: rpc$status$Passed;
			fact: rpc$stream$CheckFact;
	  });
export type rpc$events$CheckObservation =
	| "none"
	| "passed"
	| "required_failed"
	| "insufficient"
	| "cancel_pending"
	| "cancelled";
export type rpc$events$CheckSource = "host_receipt" | "model_text" | "none";
export type rpc$response$ResponseTag = "response";
export type rpc$response$RpcResponse = rpc$response$SuccessResponse | rpc$response$ErrorResponse;
export type rpc$response$SuccessResponse = rpc$Open<rpc$response$SuccessFields>;
export type rpc$response$SuccessFields = {
	type: rpc$response$ResponseTag;
	id?: string;
	success: rpc$Bool<true>;
} & rpc$response$SuccessData;
export type rpc$response$ErrorResponse = {
	type: rpc$response$ResponseTag;
	id?: string;
	command: string;
	success: rpc$Bool<false>;
	error: string;
	termination?: rpc$status$SessionTermination;
} & session$ExtraFields;
export type rpc$response$SuccessData =
	| { command: "prompt" }
	| { command: "steer" }
	| { command: "follow_up" }
	| { command: "abort" }
	| { command: "new_session"; data: rpc$data$Cancelled }
	| { command: "get_state"; data: rpc$data$RpcSessionState }
	| { command: "set_model"; data: rpc$data$Model }
	| { command: "cycle_model"; data: rpc$Nullable<rpc$data$ModelCycle> }
	| { command: "get_available_models"; data: rpc$response$Models }
	| { command: "set_thinking_level" }
	| { command: "cycle_thinking_level"; data: rpc$Nullable<rpc$data$Level> }
	| { command: "set_steering_mode" }
	| { command: "set_follow_up_mode" }
	| { command: "compact"; data: rpc$data$CompactionResult }
	| { command: "set_auto_compaction" }
	| { command: "set_auto_retry" }
	| { command: "abort_retry" }
	| { command: "bash"; data: rpc$data$BashResult }
	| { command: "abort_bash" }
	| { command: "get_session_stats"; data: rpc$data$SessionStats }
	| { command: "export_html"; data: rpc$data$ExportPath }
	| { command: "switch_session"; data: rpc$data$Cancelled }
	| { command: "fork"; data: rpc$data$Fork }
	| { command: "clone"; data: rpc$data$Cancelled }
	| { command: "get_fork_messages"; data: rpc$data$ForkMessages }
	| { command: "get_last_assistant_text"; data: rpc$data$LastText }
	| { command: "set_session_name" }
	| { command: "get_messages"; data: rpc$data$Messages }
	| { command: "get_commands"; data: rpc$response$Commands };
export type rpc$response$Models = { models: Array<rpc$data$Model> } & session$ExtraFields;
export type rpc$response$Commands = { commands: Array<rpc$data$RpcSlashCommand> } & session$ExtraFields;
export type rpc$status$TerminationKind =
	| "completed"
	| "user_abort"
	| "provider_abort"
	| "provider_auth"
	| "provider_rate_limit"
	| "provider_network"
	| "provider_protocol"
	| "provider_refusal"
	| "context_overflow"
	| "transcript_invalid"
	| "tool_timeout"
	| "tool_fatal"
	| "compaction"
	| "persistence"
	| "process_signal"
	| "process_crash"
	| "configuration"
	| "internal_error"
	| "resource_pressure"
	| "budget_exhausted";
export type rpc$status$TerminationPhase =
	| "completed"
	| "control"
	| "preflight"
	| "provider"
	| "tool"
	| "compaction"
	| "persistence"
	| "process"
	| "resume";
export type rpc$status$TerminationSource = "observed" | "inferred_on_resume";
export type rpc$status$SideEffects = "none" | "possible" | "confirmed";
export type rpc$status$ProcessSignal = "SIGINT" | "SIGTERM" | "SIGHUP" | "SIGQUIT";
export type rpc$status$CauseCode =
	| "session.completed"
	| "session.user_abort"
	| "provider.abort"
	| "provider.auth"
	| "provider.rate_limit"
	| "provider.network"
	| "provider.protocol"
	| "provider.refusal"
	| "provider.context_overflow"
	| "tool.timeout"
	| "tool.fatal"
	| "compaction.aborted"
	| "compaction.failed"
	| "compaction.stale"
	| "compaction.quota_exhausted"
	| "compaction.persistence"
	| "compaction.read_failed"
	| "compaction.append_failed"
	| "compaction.replace_failed"
	| "compaction.fsync_failed"
	| "compaction.lock_failed"
	| "process.signal"
	| "process.crash"
	| "transcript.missing_result"
	| "transcript.duplicate_result"
	| "transcript.orphan_result"
	| "transcript.duplicate_call_id"
	| "transcript.interleaved_non_result"
	| "transcript.invalid_jsonl"
	| "transcript.invalid_tree"
	| "transcript.unsupported_version"
	| "transcript.trailing_fragment"
	| "configuration.invalid"
	| "internal.unclassified"
	| "resource.memory"
	| "resource.disk"
	| "resource.cpu"
	| "resource.heap"
	| "resource.probe_unavailable"
	| "resource.queue_overflow"
	| "budget.deadline"
	| "budget.requests"
	| "budget.concurrency"
	| "budget.closed";
export type rpc$status$TranscriptIssue =
	| "missing_result"
	| "duplicate_result"
	| "orphan_result"
	| "duplicate_call_id"
	| "interleaved_non_result"
	| "invalid_jsonl"
	| "invalid_tree"
	| "unsupported_version"
	| "trailing_fragment";
export type rpc$status$SessionTermination = {
	schemaVersion: rpc$Version<1>;
	sessionId: string;
	runId: string;
	kind: rpc$status$TerminationKind;
	phase: rpc$status$TerminationPhase;
	source: rpc$status$TerminationSource;
	message: string;
	causeCode: rpc$status$CauseCode;
	nextAction: string;
	retryable: boolean;
	safeToAutoRetry: boolean;
	sideEffects: rpc$status$SideEffects;
	timestamp: string;
	retryAfterMs?: number;
	provider?: string;
	model?: string;
	toolCallId?: string;
	toolName?: string;
	processSignal?: rpc$status$ProcessSignal;
	transcriptIssue?: rpc$status$TranscriptIssue;
} & session$ExtraFields;
export type rpc$status$ModelText = "model_text";
export type rpc$status$Passed = "passed";
export type rpc$status$Claim = "passed" | "failed" | "unknown";
export type rpc$status$ModelClaim = {
	source: rpc$status$ModelText;
	says: rpc$status$Claim;
	text: string;
} & session$ExtraFields;
export type rpc$status$Coverage = {
	checksRun: number;
	checksTotal: rpc$stream$Count;
	receiptsObserved: number;
} & session$ExtraFields;
export type rpc$status$TaskProjection = {
	version: rpc$Version<2>;
	promptRunId: string;
	execution: rpc$events$Outcome;
	check: rpc$events$CheckObservation;
	checkSource: rpc$events$CheckSource;
	coverage: rpc$status$Coverage;
	facts: Array<rpc$stream$CheckFact>;
	modelClaims: Array<rpc$status$ModelClaim>;
} & session$ExtraFields;
export type rpc$stream$Assistant = Extract<session_message$KnownMessage, { role: "assistant" }>;
export type rpc$stream$ToolResult = Extract<session_message$KnownMessage, { role: "toolResult" }>;
export type rpc$stream$DoneReason = "stop" | "length" | "toolUse";
export type rpc$stream$ErrorReason = "error" | "aborted";
export type rpc$stream$ToolCallBlock = { type: "toolCall" } & session_message$ToolCall;
export type rpc$stream$AssistantEvent = rpc$Open<rpc$stream$AssistantEventBody>;
export type rpc$stream$AssistantEventBody =
	| ({ type: "start" } & { partial: rpc$stream$Assistant })
	| ({ type: "text_start" } & { contentIndex: number; partial: rpc$stream$Assistant })
	| ({ type: "text_delta" } & { contentIndex: number; delta: string; partial: rpc$stream$Assistant })
	| ({ type: "text_end" } & { contentIndex: number; content: string; partial: rpc$stream$Assistant })
	| ({ type: "thinking_start" } & { contentIndex: number; partial: rpc$stream$Assistant })
	| ({ type: "thinking_delta" } & { contentIndex: number; delta: string; partial: rpc$stream$Assistant })
	| ({ type: "thinking_end" } & { contentIndex: number; content: string; partial: rpc$stream$Assistant })
	| ({ type: "toolcall_start" } & { contentIndex: number; partial: rpc$stream$Assistant })
	| ({ type: "toolcall_delta" } & { contentIndex: number; delta: string; partial: rpc$stream$Assistant })
	| ({ type: "toolcall_end" } & {
			contentIndex: number;
			toolCall: rpc$stream$ToolCallBlock;
			partial: rpc$stream$Assistant;
	  })
	| ({ type: "done" } & { reason: rpc$stream$DoneReason; message: rpc$stream$Assistant })
	| ({ type: "error" } & { reason: rpc$stream$ErrorReason; error: rpc$stream$Assistant });
export type rpc$stream$Count = number | rpc$stream$Unknown;
export type rpc$stream$Unknown = "unknown";
export type rpc$stream$FactSource = "host_receipt" | "model_text";
export type rpc$stream$FactStatus = "passed" | "failed" | "insufficient" | "cancel_pending" | "cancelled";
export type rpc$stream$InsufficientReason =
	| "partial"
	| "missing"
	| "stale"
	| "zero_tests"
	| "skipped"
	| "unavailable"
	| "gate_closed"
	| "aborted"
	| "not_run"
	| "unverified_counts"
	| "completion_refused"
	| "required_capability_missing";
export type rpc$stream$CheckKind = "test_runner" | "typecheck" | "shell";
export type rpc$stream$CheckAttempt = {
	attempt: number;
	status: rpc$stream$FactStatus;
	reason?: rpc$stream$InsufficientReason;
	receiptId?: string;
} & session$ExtraFields;
export type rpc$stream$TestCounts = {
	executed: rpc$stream$Count;
	matched: rpc$stream$Count;
	skipped: rpc$stream$Count;
} & session$ExtraFields;
export type rpc$stream$CheckFact = {
	id: string;
	source: rpc$stream$FactSource;
	status: rpc$stream$FactStatus;
	required: boolean;
	reason?: rpc$stream$InsufficientReason;
	receiptId?: string;
	checkId?: string;
	checkRevision?: number;
	attempt?: number;
	checkKind?: rpc$stream$CheckKind;
	tests?: rpc$stream$TestCounts;
	detail?: string;
	attempts?: Array<rpc$stream$CheckAttempt>;
} & session$ExtraFields;
export type rpc$ui$RequestTag = "extension_ui_request";
export type rpc$ui$ResponseTag = "extension_ui_response";
export type rpc$ui$RpcUiRequest = rpc$Open<rpc$ui$UiRequestFields>;
export type rpc$ui$UiRequestFields = { type: rpc$ui$RequestTag; id: string } & rpc$ui$UiMethod;
export type rpc$ui$NotifyType = "info" | "warning" | "error";
export type rpc$ui$WidgetPlacement = "aboveEditor" | "belowEditor";
export type rpc$ui$UiMethod =
	| ({ method: "select" } & { title: string; options: Array<string>; timeout?: number })
	| ({ method: "confirm" } & { title: string; message: string; timeout?: number })
	| ({ method: "input" } & { title: string; placeholder?: string; timeout?: number })
	| ({ method: "editor" } & { title: string; prefill?: string })
	| ({ method: "notify" } & { message: string; notifyType?: rpc$ui$NotifyType })
	| ({ method: "setStatus" } & { statusKey: string; statusText?: string })
	| ({ method: "setWidget" } & {
			widgetKey: string;
			widgetLines?: Array<string>;
			widgetPlacement?: rpc$ui$WidgetPlacement;
	  })
	| ({ method: "setTitle" } & { title: string })
	| ({ method: "set_editor_text" } & { text: string });
export type rpc$ui$UiResponseFields = {
	type: rpc$ui$ResponseTag;
	id: string;
	value?: string;
	confirmed?: boolean;
	cancelled?: rpc$Bool<true>;
} & session$ExtraFields;
export type rpc$ui$RpcUiResponse = rpc$ui$UiResponseFields &
	({ value: string } | { confirmed: boolean } | { cancelled: rpc$Bool<true> });
export type session$ExtraFields = Record<string, JsonValue>;
export type session$UsageCost = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	total: number;
	billed?: number;
} & session$ExtraFields;
export type session$Usage = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cacheWrite1h?: number;
	cacheWriteUnknown?: true;
	totalTokens: number;
	cost: session$UsageCost;
} & session$ExtraFields;
export type session$SessionEntryBase = { id: string; parentId: string | null; timestamp: string };
export type session$FileEntry =
	| ({ type: "session" } & ({
			id: string;
			timestamp: string;
			cwd: string;
			version?: number;
			parentSession?: string;
	  } & session$ExtraFields))
	| ({ type: "message" } & ({ message: session_message$SessionMessage } & session$SessionEntryBase &
			session$ExtraFields))
	| ({ type: "thinking_level_change" } & ({ thinkingLevel: string } & session$SessionEntryBase & session$ExtraFields))
	| ({ type: "model_change" } & ({ provider: string; modelId: string } & session$SessionEntryBase &
			session$ExtraFields))
	| ({ type: "compaction" } & ({
			summary: string;
			firstKeptEntryId: string;
			tokensBefore: number;
			details?: JsonValue;
			fromHook?: boolean;
	  } & session$SessionEntryBase &
			session$ExtraFields))
	| ({ type: "branch_summary" } & ({
			fromId: string;
			summary: string;
			details?: JsonValue;
			fromHook?: boolean;
	  } & session$SessionEntryBase &
			session$ExtraFields))
	| ({ type: "custom" } & ({ customType: string; data?: JsonValue } & session$SessionEntryBase & session$ExtraFields))
	| ({ type: "custom_message" } & ({
			customType: string;
			content: session_message$UserContent;
			display: boolean;
			details?: JsonValue;
	  } & session$SessionEntryBase &
			session$ExtraFields))
	| ({ type: "label" } & ({ targetId: string; label?: string } & session$SessionEntryBase & session$ExtraFields))
	| ({ type: "session_info" } & ({ name?: string } & session$SessionEntryBase & session$ExtraFields));
export type session$CURRENT_SESSION_VERSION = 3;
export type session_jsonl$SessionRecord = jsonl$JsonRecord<session$FileEntry>;
export type session_message$UserContent = string | Array<session_message$UserBlock>;
export type session_message$UserBlock =
	| ({ type: "text" } & session_message$TextContent)
	| ({ type: "image" } & session_message$ImageContent);
export type session_message$AssistantBlock =
	| ({ type: "text" } & session_message$TextContent)
	| ({ type: "thinking" } & session_message$ThinkingContent)
	| ({ type: "toolCall" } & session_message$ToolCall);
export type session_message$TextContent = { text: string; textSignature?: string } & session$ExtraFields;
export type session_message$ImageContent = { data: string; mimeType: string } & session$ExtraFields;
export type session_message$ThinkingContent = {
	thinking: string;
	thinkingSignature?: string;
	redacted?: boolean;
} & session$ExtraFields;
export type session_message$ToolCall = {
	id: string;
	name: string;
	arguments: session$ExtraFields;
	thoughtSignature?: string;
} & session$ExtraFields;
export type session_message$StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";
export type session_message$KnownMessage =
	| ({ role: "user" } & ({ content: session_message$UserContent; timestamp: number } & session$ExtraFields))
	| ({ role: "assistant" } & ({
			content: Array<session_message$AssistantBlock>;
			api: string;
			provider: string;
			model: string;
			usage: session$Usage;
			stopReason: session_message$StopReason;
			timestamp: number;
			responseModel?: string;
			responseId?: string;
			errorMessage?: string;
			diagnostics?: Array<JsonValue>;
	  } & session$ExtraFields))
	| ({ role: "toolResult" } & ({
			toolCallId: string;
			toolName: string;
			content: Array<session_message$UserBlock>;
			isError: boolean;
			timestamp: number;
			details?: JsonValue;
	  } & session$ExtraFields))
	| ({ role: "bashExecution" } & ({
			command: string;
			output: string;
			cancelled: boolean;
			truncated: boolean;
			timestamp: number;
			exitCode?: number;
			fullOutputPath?: string;
			excludeFromContext?: boolean;
	  } & session$ExtraFields))
	| ({ role: "custom" } & ({
			customType: string;
			content: session_message$UserContent;
			display: boolean;
			timestamp: number;
			details?: JsonValue;
	  } & session$ExtraFields))
	| ({ role: "branchSummary" } & ({ summary: string; fromId: string; timestamp: number } & session$ExtraFields))
	| ({ role: "compactionSummary" } & ({
			summary: string;
			tokensBefore: number;
			timestamp: number;
	  } & session$ExtraFields));
export type session_message$SessionMessage = session_message$KnownMessage | (session$ExtraFields & { role: string });
