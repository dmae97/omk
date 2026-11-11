use super::Optional;
use crate::session::ExtraFields;
use crate::session_message::{KnownMessage, ToolCall};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Number;
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(transparent)]
pub struct Assistant(pub Box<KnownMessage>);
impl<'de> Deserialize<'de> for Assistant {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let message = KnownMessage::deserialize(d)?;
        if matches!(message, KnownMessage::Assistant { .. }) {
            Ok(Self(Box::new(message)))
        } else {
            Err(serde::de::Error::custom("expected assistant role"))
        }
    }
}
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(transparent)]
pub struct ToolResult(pub Box<KnownMessage>);
impl<'de> Deserialize<'de> for ToolResult {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let message = KnownMessage::deserialize(d)?;
        if matches!(message, KnownMessage::ToolResult { .. }) {
            Ok(Self(Box::new(message)))
        } else {
            Err(serde::de::Error::custom("expected toolResult role"))
        }
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DoneReason {
    Stop,
    Length,
    ToolUse,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ErrorReason {
    Error,
    Aborted,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ToolCallBlock {
    #[serde(rename = "toolCall")]
    ToolCall(ToolCall),
}
pub type AssistantEvent = super::Open<AssistantEventBody>;
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum AssistantEventBody {
    Start {
        partial: Assistant,
    },
    TextStart {
        content_index: Number,
        partial: Assistant,
    },
    TextDelta {
        content_index: Number,
        delta: String,
        partial: Assistant,
    },
    TextEnd {
        content_index: Number,
        content: String,
        partial: Assistant,
    },
    ThinkingStart {
        content_index: Number,
        partial: Assistant,
    },
    ThinkingDelta {
        content_index: Number,
        delta: String,
        partial: Assistant,
    },
    ThinkingEnd {
        content_index: Number,
        content: String,
        partial: Assistant,
    },
    ToolcallStart {
        content_index: Number,
        partial: Assistant,
    },
    ToolcallDelta {
        content_index: Number,
        delta: String,
        partial: Assistant,
    },
    ToolcallEnd {
        content_index: Number,
        tool_call: ToolCallBlock,
        partial: Assistant,
    },
    Done {
        reason: DoneReason,
        message: Assistant,
    },
    Error {
        reason: ErrorReason,
        error: Assistant,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Count {
    Number(Number),
    Unknown(Unknown),
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Unknown {
    Unknown,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FactSource {
    HostReceipt,
    ModelText,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FactStatus {
    Passed,
    Failed,
    Insufficient,
    CancelPending,
    Cancelled,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InsufficientReason {
    Partial,
    Missing,
    Stale,
    ZeroTests,
    Skipped,
    Unavailable,
    GateClosed,
    Aborted,
    NotRun,
    UnverifiedCounts,
    CompletionRefused,
    RequiredCapabilityMissing,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CheckKind {
    TestRunner,
    Typecheck,
    Shell,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckAttempt {
    pub attempt: Number,
    pub status: FactStatus,
    #[serde(default, skip_serializing_if = "Optional::is_absent")]
    pub reason: Optional<InsufficientReason>,
    #[serde(default, skip_serializing_if = "Optional::is_absent")]
    pub receipt_id: Optional<String>,
    #[serde(flatten)]
    pub extra: ExtraFields,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TestCounts {
    pub executed: Count,
    pub matched: Count,
    pub skipped: Count,
    #[serde(flatten)]
    pub extra: ExtraFields,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckFact {
    pub id: String,
    pub source: FactSource,
    pub status: FactStatus,
    pub required: bool,
    #[serde(default, skip_serializing_if = "Optional::is_absent")]
    pub reason: Optional<InsufficientReason>,
    #[serde(default, skip_serializing_if = "Optional::is_absent")]
    pub receipt_id: Optional<String>,
    #[serde(default, skip_serializing_if = "Optional::is_absent")]
    pub check_id: Optional<String>,
    #[serde(default, skip_serializing_if = "Optional::is_absent")]
    pub check_revision: Optional<Number>,
    #[serde(default, skip_serializing_if = "Optional::is_absent")]
    pub attempt: Optional<Number>,
    #[serde(default, skip_serializing_if = "Optional::is_absent")]
    pub check_kind: Optional<CheckKind>,
    #[serde(default, skip_serializing_if = "Optional::is_absent")]
    pub tests: Optional<TestCounts>,
    #[serde(default, skip_serializing_if = "Optional::is_absent")]
    pub detail: Optional<String>,
    #[serde(default, skip_serializing_if = "Optional::is_absent")]
    pub attempts: Optional<Vec<CheckAttempt>>,
    #[serde(flatten)]
    pub extra: ExtraFields,
}
