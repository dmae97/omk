use super::command::ThinkingLevel;
use super::data::CompactionResult;
use super::status::{Passed, SessionTermination, TaskProjection};
use super::stream::{AssistantEvent, CheckFact, ToolResult};
use super::{Optional, Version};
use crate::session::ExtraFields;
use crate::session_message::SessionMessage;
use serde::{Deserialize, Serialize};
use serde_json::{Number, Value};
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Outcome {
    Completed,
    Failed,
    Aborted,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderOutcome {
    Completed,
    Error,
    Aborted,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CompactionReason {
    Manual,
    Threshold,
    Overflow,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Boundary {
    #[serde(rename = "stream-dispatch")]
    StreamDispatch,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DeniedReason {
    #[serde(rename = "contract-violation")]
    ContractViolation,
    #[serde(rename = "aborted")]
    Aborted,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LateOutcome {
    Resolved,
    Rejected,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Disposition {
    Timeout,
    Aborted,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MutationSource {
    #[serde(rename = "tool_late_settlement")]
    ToolLateSettlement,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MutationScope {
    pub root: String,
    pub paths: Vec<String>,
    #[serde(flatten)]
    pub extra: ExtraFields,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "source", rename_all = "camelCase")]
pub enum SummarySource {
    BranchSummary,
    Compaction { reason: CompactionReason },
}
pub type RpcEvent = super::Open<EventBody>;
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum EventBody {
    AgentStart,
    AgentEnd {
        messages: Vec<SessionMessage>,
        will_retry: bool,
    },
    TurnStart,
    TurnEnd {
        message: SessionMessage,
        tool_results: Vec<ToolResult>,
    },
    MessageStart {
        message: SessionMessage,
    },
    MessageEnd {
        message: SessionMessage,
    },
    MessageUpdate {
        message: SessionMessage,
        assistant_message_event: Box<AssistantEvent>,
    },
    ToolExecutionStart {
        tool_call_id: String,
        tool_name: String,
        args: Value,
    },
    ToolExecutionUpdate {
        tool_call_id: String,
        tool_name: String,
        args: Value,
        partial_result: Value,
    },
    ToolExecutionEnd {
        tool_call_id: String,
        tool_name: String,
        result: Value,
        is_error: bool,
    },
    ToolExecutionLateSettlement {
        tool_call_id: String,
        tool_name: String,
        disposition: Disposition,
        outcome: LateOutcome,
    },
    ProviderDenied {
        request_id: String,
        denied_reason: DeniedReason,
    },
    ProviderRequest {
        request_id: String,
        provider: String,
        model: String,
        max_output_tokens: Number,
        #[serde(default, skip_serializing_if = "Optional::is_absent")]
        omitted_tool_images: Optional<Number>,
        boundary: Boundary,
    },
    ProviderRequestEnd {
        request_id: String,
        outcome: ProviderOutcome,
        boundary: Boundary,
    },
    PromptSettled {
        prompt_run_id: String,
        outcome: Outcome,
        duration_ms: Number,
        #[serde(default, skip_serializing_if = "Optional::is_absent")]
        termination_kind: Optional<String>,
    },
    QueueUpdate {
        steering: Vec<String>,
        follow_up: Vec<String>,
    },
    CompactionStart {
        reason: CompactionReason,
    },
    CompactionEnd {
        reason: CompactionReason,
        #[serde(default, skip_serializing_if = "Optional::is_absent")]
        result: Optional<CompactionResult>,
        aborted: bool,
        will_retry: bool,
        #[serde(default, skip_serializing_if = "Optional::is_absent")]
        error_message: Optional<String>,
    },
    SessionInfoChanged {
        #[serde(default, skip_serializing_if = "Optional::is_absent")]
        name: Optional<String>,
    },
    ThinkingLevelChanged {
        level: ThinkingLevel,
    },
    AutoRetryStart {
        attempt: Number,
        max_attempts: Number,
        delay_ms: Number,
        error_message: String,
    },
    AutoRetryEnd {
        success: bool,
        attempt: Number,
        #[serde(default, skip_serializing_if = "Optional::is_absent")]
        final_error: Optional<String>,
    },
    PinnedQuotaFailover {
        from: String,
        to: String,
        message: String,
    },
    BashExecutionUpdate {
        #[serde(default, skip_serializing_if = "Optional::is_absent")]
        id: Optional<String>,
        delta: String,
    },
    SummarizationRetryScheduled {
        attempt: Number,
        max_attempts: Number,
        delay_ms: Number,
        error_message: String,
    },
    SummarizationRetryAttemptStart {
        #[serde(flatten)]
        source: SummarySource,
    },
    SummarizationRetryFinished,
    SessionTermination {
        termination: Box<SessionTermination>,
    },
    WorkspaceMutation {
        source: MutationSource,
        tool_call_id: String,
        tool_name: String,
        payload: MutationScope,
    },
    ExtensionError {
        extension_path: String,
        event: String,
        error: String,
    },
    TaskResult {
        version: Version<2>,
        projection: Box<TaskProjection>,
    },
    TaskResultDowngrade {
        version: Version<2>,
        prompt_run_id: String,
        from: Passed,
        fact: Box<CheckFact>,
    },
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CheckObservation {
    None,
    Passed,
    RequiredFailed,
    Insufficient,
    CancelPending,
    Cancelled,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CheckSource {
    HostReceipt,
    ModelText,
    None,
}
