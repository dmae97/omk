use super::data::*;
use super::status::SessionTermination;
use super::{Bool, Nullable, Optional};
use crate::session::ExtraFields;
use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ResponseTag {
    #[serde(rename = "response")]
    Response,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum RpcResponse {
    Success(Box<SuccessResponse>),
    Error(Box<ErrorResponse>),
}
pub type SuccessResponse = super::Open<SuccessFields>;
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SuccessFields {
    #[serde(rename = "type")]
    pub kind: ResponseTag,
    #[serde(default, skip_serializing_if = "Optional::is_absent")]
    pub id: Optional<String>,
    pub success: Bool<true>,
    #[serde(flatten)]
    pub result: SuccessData,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ErrorResponse {
    #[serde(rename = "type")]
    pub kind: ResponseTag,
    #[serde(default, skip_serializing_if = "Optional::is_absent")]
    pub id: Optional<String>,
    pub command: String,
    pub success: Bool<false>,
    pub error: String,
    #[serde(default, skip_serializing_if = "Optional::is_absent")]
    pub termination: Optional<SessionTermination>,
    #[serde(flatten)]
    pub extra: ExtraFields,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "command", content = "data", rename_all = "snake_case")]
pub enum SuccessData {
    Prompt,
    Steer,
    FollowUp,
    Abort,
    NewSession(Cancelled),
    GetState(Box<RpcSessionState>),
    SetModel(Box<Model>),
    CycleModel(Nullable<Box<ModelCycle>>),
    GetAvailableModels(Models),
    SetThinkingLevel,
    CycleThinkingLevel(Nullable<Level>),
    SetSteeringMode,
    SetFollowUpMode,
    Compact(CompactionResult),
    SetAutoCompaction,
    SetAutoRetry,
    AbortRetry,
    Bash(BashResult),
    AbortBash,
    GetSessionStats(Box<SessionStats>),
    ExportHtml(ExportPath),
    SwitchSession(Cancelled),
    Fork(Fork),
    Clone(Cancelled),
    GetForkMessages(ForkMessages),
    GetLastAssistantText(LastText),
    SetSessionName,
    GetMessages(Messages),
    GetCommands(Commands),
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Models {
    pub models: Vec<Model>,
    #[serde(flatten)]
    pub extra: ExtraFields,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Commands {
    pub commands: Vec<RpcSlashCommand>,
    #[serde(flatten)]
    pub extra: ExtraFields,
}
