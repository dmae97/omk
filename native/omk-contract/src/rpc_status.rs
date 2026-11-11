use super::events::{CheckObservation, CheckSource, Outcome};
use super::stream::{CheckFact, Count};
use super::{Optional, Version};
use crate::session::ExtraFields;
use serde::{Deserialize, Serialize};
use serde_json::Number;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TerminationKind {
    Completed,
    UserAbort,
    ProviderAbort,
    ProviderAuth,
    ProviderRateLimit,
    ProviderNetwork,
    ProviderProtocol,
    ProviderRefusal,
    ContextOverflow,
    TranscriptInvalid,
    ToolTimeout,
    ToolFatal,
    Compaction,
    Persistence,
    ProcessSignal,
    ProcessCrash,
    Configuration,
    InternalError,
    ResourcePressure,
    BudgetExhausted,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TerminationPhase {
    Completed,
    Control,
    Preflight,
    Provider,
    Tool,
    Compaction,
    Persistence,
    Process,
    Resume,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TerminationSource {
    Observed,
    InferredOnResume,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SideEffects {
    None,
    Possible,
    Confirmed,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProcessSignal {
    SIGINT,
    SIGTERM,
    SIGHUP,
    SIGQUIT,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct CauseCode(String);
impl TryFrom<String> for CauseCode {
    type Error = &'static str;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        let valid = match value.split_once('.') {
            Some(("session", s)) => matches!(s, "completed" | "user_abort"),
            Some(("provider", s)) => matches!(
                s,
                "abort"
                    | "auth"
                    | "rate_limit"
                    | "network"
                    | "protocol"
                    | "refusal"
                    | "context_overflow"
            ),
            Some(("tool", s)) => matches!(s, "timeout" | "fatal"),
            Some(("compaction", s)) => {
                matches!(s, "aborted" | "failed" | "stale" | "quota_exhausted")
            }
            Some(("persistence", s)) => matches!(
                s,
                "read_failed" | "append_failed" | "replace_failed" | "fsync_failed" | "lock_failed"
            ),
            Some(("process", s)) => matches!(s, "signal" | "crash"),
            Some(("transcript", s)) => matches!(
                s,
                "missing_result"
                    | "duplicate_result"
                    | "orphan_result"
                    | "duplicate_call_id"
                    | "interleaved_non_result"
                    | "invalid_jsonl"
                    | "invalid_tree"
                    | "unsupported_version"
                    | "trailing_fragment"
            ),
            Some(("configuration", "invalid") | ("internal", "unclassified")) => true,
            Some(("resource", s)) => matches!(
                s,
                "memory" | "disk" | "cpu" | "heap" | "probe_unavailable" | "queue_overflow"
            ),
            Some(("budget", s)) => matches!(s, "deadline" | "requests" | "concurrency" | "closed"),
            _ => false,
        };
        if valid {
            Ok(Self(value))
        } else {
            Err("invalid termination cause code")
        }
    }
}
impl From<CauseCode> for String {
    fn from(value: CauseCode) -> Self {
        value.0
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TranscriptIssue {
    MissingResult,
    DuplicateResult,
    OrphanResult,
    DuplicateCallId,
    InterleavedNonResult,
    InvalidJsonl,
    InvalidTree,
    UnsupportedVersion,
    TrailingFragment,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTermination {
    pub schema_version: Version<1>,
    pub session_id: String,
    pub run_id: String,
    pub kind: TerminationKind,
    pub phase: TerminationPhase,
    pub source: TerminationSource,
    pub message: String,
    pub cause_code: CauseCode,
    pub next_action: String,
    pub retryable: bool,
    pub safe_to_auto_retry: bool,
    pub side_effects: SideEffects,
    pub timestamp: String,
    #[serde(default, skip_serializing_if = "Optional::is_absent")]
    pub retry_after_ms: Optional<Number>,
    #[serde(default, skip_serializing_if = "Optional::is_absent")]
    pub provider: Optional<String>,
    #[serde(default, skip_serializing_if = "Optional::is_absent")]
    pub model: Optional<String>,
    #[serde(default, skip_serializing_if = "Optional::is_absent")]
    pub tool_call_id: Optional<String>,
    #[serde(default, skip_serializing_if = "Optional::is_absent")]
    pub tool_name: Optional<String>,
    #[serde(default, skip_serializing_if = "Optional::is_absent")]
    pub process_signal: Optional<ProcessSignal>,
    #[serde(default, skip_serializing_if = "Optional::is_absent")]
    pub transcript_issue: Optional<TranscriptIssue>,
    #[serde(flatten)]
    pub extra: ExtraFields,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ModelText {
    #[serde(rename = "model_text")]
    ModelText,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Passed {
    Passed,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Claim {
    Passed,
    Failed,
    Unknown,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ModelClaim {
    pub source: ModelText,
    pub says: Claim,
    pub text: String,
    #[serde(flatten)]
    pub extra: ExtraFields,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Coverage {
    pub checks_run: Number,
    pub checks_total: Count,
    pub receipts_observed: Number,
    #[serde(flatten)]
    pub extra: ExtraFields,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskProjection {
    pub version: Version<2>,
    pub prompt_run_id: String,
    pub execution: Outcome,
    pub check: CheckObservation,
    pub check_source: CheckSource,
    pub coverage: Coverage,
    pub facts: Vec<CheckFact>,
    pub model_claims: Vec<ModelClaim>,
    #[serde(flatten)]
    pub extra: ExtraFields,
}
