use super::Optional;
use crate::session_message::ImageContent;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ThinkingLevel {
    Off,
    Minimal,
    Low,
    Medium,
    High,
    Xhigh,
    Max,
    Ultra,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum QueueMode {
    #[serde(rename = "all")]
    All,
    #[serde(rename = "one-at-a-time")]
    OneAtATime,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StreamingBehavior {
    Steer,
    FollowUp,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum RpcImage {
    Image(ImageContent),
}

pub type RpcCommand = super::Open<CommandFields>;
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CommandFields {
    #[serde(default, skip_serializing_if = "Optional::is_absent")]
    pub id: Optional<String>,
    #[serde(flatten)]
    pub body: CommandBody,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum CommandBody {
    Prompt {
        message: String,
        #[serde(default, skip_serializing_if = "Optional::is_absent")]
        images: Optional<Vec<RpcImage>>,
        #[serde(default, skip_serializing_if = "Optional::is_absent")]
        streaming_behavior: Optional<StreamingBehavior>,
    },
    Steer {
        message: String,
        #[serde(default, skip_serializing_if = "Optional::is_absent")]
        images: Optional<Vec<RpcImage>>,
    },
    FollowUp {
        message: String,
        #[serde(default, skip_serializing_if = "Optional::is_absent")]
        images: Optional<Vec<RpcImage>>,
    },
    Abort,
    NewSession {
        #[serde(default, skip_serializing_if = "Optional::is_absent")]
        parent_session: Optional<String>,
    },
    GetState,
    SetModel {
        provider: String,
        model_id: String,
    },
    CycleModel,
    GetAvailableModels,
    SetThinkingLevel {
        level: ThinkingLevel,
    },
    CycleThinkingLevel,
    SetSteeringMode {
        mode: QueueMode,
    },
    SetFollowUpMode {
        mode: QueueMode,
    },
    Compact {
        #[serde(default, skip_serializing_if = "Optional::is_absent")]
        custom_instructions: Optional<String>,
    },
    SetAutoCompaction {
        enabled: bool,
    },
    SetAutoRetry {
        enabled: bool,
    },
    AbortRetry,
    Bash {
        command: String,
        #[serde(default, skip_serializing_if = "Optional::is_absent")]
        exclude_from_context: Optional<bool>,
    },
    AbortBash,
    GetSessionStats,
    ExportHtml {
        #[serde(default, skip_serializing_if = "Optional::is_absent")]
        output_path: Optional<String>,
    },
    SwitchSession {
        session_path: String,
    },
    Fork {
        entry_id: String,
    },
    Clone,
    GetForkMessages,
    GetLastAssistantText,
    SetSessionName {
        name: String,
    },
    GetMessages,
    GetCommands,
}
