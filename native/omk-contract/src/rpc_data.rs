use super::command::{QueueMode, ThinkingLevel};
use super::status::SessionTermination;
use super::{Nullable, Optional};
use crate::session::ExtraFields;
use crate::session_message::SessionMessage;
use serde::{Deserialize, Serialize};
use serde_json::{Number, Value};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Modality {
    Text,
    Image,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Model {
    pub id: String,
    pub name: String,
    pub api: String,
    pub provider: String,
    pub base_url: String,
    pub reasoning: bool,
    pub input: Vec<Modality>,
    pub cost: ModelCost,
    pub context_window: Number,
    pub max_tokens: Number,
    #[serde(default, skip_serializing_if = "Optional::is_absent")]
    pub thinking_level_map: Optional<BTreeMap<ThinkingLevel, Option<String>>>,
    #[serde(default, skip_serializing_if = "Optional::is_absent")]
    pub headers: Optional<BTreeMap<String, String>>,
    // Provider-specific compat schemas belong to the provider contract; retain their object here.
    #[serde(default, skip_serializing_if = "Optional::is_absent")]
    pub compat: Optional<ExtraFields>,
    #[serde(flatten)]
    pub extra: ExtraFields,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelCost {
    pub input: Number,
    pub output: Number,
    pub cache_read: Number,
    pub cache_write: Number,
    #[serde(flatten)]
    pub extra: ExtraFields,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RpcSessionState {
    #[serde(default, skip_serializing_if = "Optional::is_absent")]
    pub model: Optional<Model>,
    pub thinking_level: ThinkingLevel,
    pub is_streaming: bool,
    pub is_compacting: bool,
    pub steering_mode: QueueMode,
    pub follow_up_mode: QueueMode,
    #[serde(default, skip_serializing_if = "Optional::is_absent")]
    pub session_file: Optional<String>,
    pub session_id: String,
    #[serde(default, skip_serializing_if = "Optional::is_absent")]
    pub session_name: Optional<String>,
    pub auto_compaction_enabled: bool,
    pub message_count: Number,
    pub pending_message_count: Number,
    #[serde(default, skip_serializing_if = "Optional::is_absent")]
    pub last_termination: Optional<SessionTermination>,
    #[serde(flatten)]
    pub extra: ExtraFields,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactionResult {
    pub summary: String,
    pub first_kept_entry_id: String,
    pub tokens_before: Number,
    #[serde(default, skip_serializing_if = "Optional::is_absent")]
    pub details: Optional<Value>,
    #[serde(flatten)]
    pub extra: ExtraFields,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BashResult {
    pub output: String,
    pub cancelled: bool,
    pub truncated: bool,
    #[serde(default, skip_serializing_if = "Optional::is_absent")]
    pub exit_code: Optional<Number>,
    #[serde(default, skip_serializing_if = "Optional::is_absent")]
    pub full_output_path: Optional<String>,
    #[serde(flatten)]
    pub extra: ExtraFields,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStats {
    #[serde(default, skip_serializing_if = "Optional::is_absent")]
    pub session_file: Optional<String>,
    pub session_id: String,
    pub user_messages: Number,
    pub assistant_messages: Number,
    pub tool_calls: Number,
    pub tool_results: Number,
    pub total_messages: Number,
    pub tokens: TokenTotals,
    pub prompt_cache: PromptCache,
    pub cost: Number,
    #[serde(default, skip_serializing_if = "Optional::is_absent")]
    pub context_usage: Optional<ContextUsage>,
    #[serde(flatten)]
    pub extra: ExtraFields,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenTotals {
    pub input: Number,
    pub output: Number,
    pub cache_read: Number,
    pub cache_write: Number,
    pub total: Number,
    #[serde(flatten)]
    pub extra: ExtraFields,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptCache {
    pub provider_eligible_input_tokens: Number,
    pub provider_hit_rate: Number,
    pub key_changes: Number,
    pub boundary_bypasses: Number,
    pub stable_prefix_characters: Number,
    #[serde(default, skip_serializing_if = "Optional::is_absent")]
    pub last_break_reason: Optional<String>,
    #[serde(flatten)]
    pub extra: ExtraFields,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextUsage {
    pub tokens: Nullable<Number>,
    pub context_window: Number,
    pub percent: Nullable<Number>,
    #[serde(flatten)]
    pub extra: ExtraFields,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceInfo {
    pub path: String,
    pub source: String,
    pub scope: SourceScope,
    pub origin: SourceOrigin,
    #[serde(default, skip_serializing_if = "Optional::is_absent")]
    pub base_dir: Optional<String>,
    #[serde(flatten)]
    pub extra: ExtraFields,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SourceScope {
    User,
    Project,
    Temporary,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SourceOrigin {
    #[serde(rename = "package")]
    Package,
    #[serde(rename = "top-level")]
    TopLevel,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CommandSource {
    Extension,
    Prompt,
    Skill,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RpcSlashCommand {
    pub name: String,
    pub source: CommandSource,
    pub source_info: SourceInfo,
    #[serde(default, skip_serializing_if = "Optional::is_absent")]
    pub description: Optional<String>,
    #[serde(flatten)]
    pub extra: ExtraFields,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelCycle {
    pub model: Model,
    pub thinking_level: ThinkingLevel,
    pub is_scoped: bool,
    #[serde(flatten)]
    pub extra: ExtraFields,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Level {
    pub level: ThinkingLevel,
    #[serde(flatten)]
    pub extra: ExtraFields,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Cancelled {
    pub cancelled: bool,
    #[serde(flatten)]
    pub extra: ExtraFields,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Fork {
    pub text: String,
    pub cancelled: bool,
    #[serde(flatten)]
    pub extra: ExtraFields,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExportPath {
    pub path: String,
    #[serde(flatten)]
    pub extra: ExtraFields,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LastText {
    pub text: Nullable<String>,
    #[serde(flatten)]
    pub extra: ExtraFields,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForkMessage {
    pub entry_id: String,
    pub text: String,
    #[serde(flatten)]
    pub extra: ExtraFields,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ForkMessages {
    pub messages: Vec<ForkMessage>,
    #[serde(flatten)]
    pub extra: ExtraFields,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Messages {
    pub messages: Vec<SessionMessage>,
    #[serde(flatten)]
    pub extra: ExtraFields,
}
