//! Provider and coding-agent message shapes persisted by SessionMessageEntry.
use crate::session::{ExtraFields, Usage, present};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Number, Value};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum UserContent {
    Text(String),
    Blocks(Vec<UserBlock>),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum UserBlock {
    Text(TextContent),
    Image(ImageContent),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AssistantBlock {
    Text(TextContent),
    Thinking(ThinkingContent),
    ToolCall(ToolCall),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextContent {
    pub text: String,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "present"
    )]
    pub text_signature: Option<String>,
    #[serde(flatten)]
    pub extra: ExtraFields,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageContent {
    pub data: String,
    pub mime_type: String,
    #[serde(flatten)]
    pub extra: ExtraFields,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThinkingContent {
    pub thinking: String,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "present"
    )]
    pub thinking_signature: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "present"
    )]
    pub redacted: Option<bool>,
    #[serde(flatten)]
    pub extra: ExtraFields,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: ExtraFields,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "present"
    )]
    pub thought_signature: Option<String>,
    #[serde(flatten)]
    pub extra: ExtraFields,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StopReason {
    Stop,
    Length,
    ToolUse,
    Error,
    Aborted,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "role", rename_all = "camelCase")]
pub enum KnownMessage {
    User {
        content: UserContent,
        timestamp: Number,
        #[serde(flatten)]
        extra: ExtraFields,
    },
    Assistant {
        content: Vec<AssistantBlock>,
        api: String,
        provider: String,
        model: String,
        usage: Box<Usage>,
        #[serde(rename = "stopReason")]
        stop_reason: StopReason,
        timestamp: Number,
        #[serde(
            default,
            rename = "responseModel",
            skip_serializing_if = "Option::is_none",
            deserialize_with = "present"
        )]
        response_model: Option<String>,
        #[serde(
            default,
            rename = "responseId",
            skip_serializing_if = "Option::is_none",
            deserialize_with = "present"
        )]
        response_id: Option<String>,
        #[serde(
            default,
            rename = "errorMessage",
            skip_serializing_if = "Option::is_none",
            deserialize_with = "present"
        )]
        error_message: Option<String>,
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            deserialize_with = "present"
        )]
        diagnostics: Option<Vec<Value>>,
        #[serde(flatten)]
        extra: ExtraFields,
    },
    ToolResult {
        #[serde(rename = "toolCallId")]
        tool_call_id: String,
        #[serde(rename = "toolName")]
        tool_name: String,
        content: Vec<UserBlock>,
        #[serde(rename = "isError")]
        is_error: bool,
        timestamp: Number,
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            deserialize_with = "present"
        )]
        details: Option<Value>,
        #[serde(flatten)]
        extra: ExtraFields,
    },
    BashExecution {
        command: String,
        output: String,
        cancelled: bool,
        truncated: bool,
        timestamp: Number,
        #[serde(
            default,
            rename = "exitCode",
            skip_serializing_if = "Option::is_none",
            deserialize_with = "present"
        )]
        exit_code: Option<Number>,
        #[serde(
            default,
            rename = "fullOutputPath",
            skip_serializing_if = "Option::is_none",
            deserialize_with = "present"
        )]
        full_output_path: Option<String>,
        #[serde(
            default,
            rename = "excludeFromContext",
            skip_serializing_if = "Option::is_none",
            deserialize_with = "present"
        )]
        exclude_from_context: Option<bool>,
        #[serde(flatten)]
        extra: ExtraFields,
    },
    Custom {
        #[serde(rename = "customType")]
        custom_type: String,
        content: UserContent,
        display: bool,
        timestamp: Number,
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            deserialize_with = "present"
        )]
        details: Option<Value>,
        #[serde(flatten)]
        extra: ExtraFields,
    },
    BranchSummary {
        summary: String,
        #[serde(rename = "fromId")]
        from_id: String,
        timestamp: Number,
        #[serde(flatten)]
        extra: ExtraFields,
    },
    CompactionSummary {
        summary: String,
        #[serde(rename = "tokensBefore")]
        tokens_before: Number,
        timestamp: Number,
        #[serde(flatten)]
        extra: ExtraFields,
    },
}

/// Declaration-merged extension roles are opaque. A malformed known role never
/// falls through to Extension, so it cannot bypass its typed field checks.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(untagged)]
pub enum SessionMessage {
    Known(Box<KnownMessage>),
    Extension(ExtraFields),
}

impl<'de> Deserialize<'de> for SessionMessage {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = Value::deserialize(deserializer)?;
        let role = value
            .get("role")
            .and_then(Value::as_str)
            .ok_or_else(|| serde::de::Error::custom("message role must be a string"))?;
        match role {
            "user" | "assistant" | "toolResult" | "bashExecution" | "custom" | "branchSummary"
            | "compactionSummary" => serde_json::from_value(value)
                .map(|message| Self::Known(Box::new(message)))
                .map_err(serde::de::Error::custom),
            _ => match value {
                Value::Object(fields) => Ok(Self::Extension(fields)),
                _ => Err(serde::de::Error::custom("message must be an object")),
            },
        }
    }
}
