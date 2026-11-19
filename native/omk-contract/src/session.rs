//! Current session file shapes from coding-agent session-listing/session-manager.
//! No migration, tree reconstruction, file repair or persistence (those belong to K2).

use crate::session_message::{SessionMessage, UserContent};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Map, Number, Value};

pub const CURRENT_SESSION_VERSION: u32 = 3;
pub type ExtraFields = Map<String, Value>;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageCost {
    pub input: Number,
    pub output: Number,
    pub cache_read: Number,
    pub cache_write: Number,
    pub total: Number,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "present"
    )]
    pub billed: Option<Number>,
    #[serde(flatten)]
    pub extra: ExtraFields,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub input: Number,
    pub output: Number,
    pub cache_read: Number,
    pub cache_write: Number,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "present"
    )]
    pub cache_write1h: Option<Number>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "present_true"
    )]
    pub cache_write_unknown: Option<bool>,
    pub total_tokens: Number,
    pub cost: UsageCost,
    #[serde(flatten)]
    pub extra: ExtraFields,
}

fn present_true<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<bool>, D::Error> {
    if bool::deserialize(deserializer)? {
        Ok(Some(true))
    } else {
        Err(serde::de::Error::custom(
            "cacheWriteUnknown must be true when present",
        ))
    }
}

// A present JSON null must stay Some(Value::Null) for opaque extension payloads.
// For optional primitives, null is not an omitted TypeScript property.
pub(crate) fn present<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

fn required_nullable<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    Option::<String>::deserialize(deserializer)
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionEntryBase {
    pub id: String,
    #[serde(deserialize_with = "required_nullable")]
    pub parent_id: Option<String>,
    pub timestamp: String,
}

/// Header or one of the nine current entry kinds. Unknown fields are retained;
/// unknown entry kinds are rejected, not silently treated as custom entries.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum FileEntry {
    Session {
        id: String,
        timestamp: String,
        cwd: String,
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            deserialize_with = "present"
        )]
        version: Option<Number>,
        #[serde(
            default,
            rename = "parentSession",
            skip_serializing_if = "Option::is_none",
            deserialize_with = "present"
        )]
        parent_session: Option<String>,
        #[serde(flatten)]
        extra: ExtraFields,
    },
    Message {
        #[serde(flatten)]
        base: SessionEntryBase,
        message: SessionMessage,
        #[serde(flatten)]
        extra: ExtraFields,
    },
    ThinkingLevelChange {
        #[serde(flatten)]
        base: SessionEntryBase,
        #[serde(rename = "thinkingLevel")]
        thinking_level: String,
        #[serde(flatten)]
        extra: ExtraFields,
    },
    ModelChange {
        #[serde(flatten)]
        base: SessionEntryBase,
        provider: String,
        #[serde(rename = "modelId")]
        model_id: String,
        #[serde(flatten)]
        extra: ExtraFields,
    },
    Compaction {
        #[serde(flatten)]
        base: SessionEntryBase,
        summary: String,
        #[serde(rename = "firstKeptEntryId")]
        first_kept_entry_id: String,
        #[serde(rename = "tokensBefore")]
        tokens_before: Number,
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            deserialize_with = "present"
        )]
        details: Option<Value>,
        #[serde(
            default,
            rename = "fromHook",
            skip_serializing_if = "Option::is_none",
            deserialize_with = "present"
        )]
        from_hook: Option<bool>,
        #[serde(flatten)]
        extra: ExtraFields,
    },
    BranchSummary {
        #[serde(flatten)]
        base: SessionEntryBase,
        #[serde(rename = "fromId")]
        from_id: String,
        summary: String,
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            deserialize_with = "present"
        )]
        details: Option<Value>,
        #[serde(
            default,
            rename = "fromHook",
            skip_serializing_if = "Option::is_none",
            deserialize_with = "present"
        )]
        from_hook: Option<bool>,
        #[serde(flatten)]
        extra: ExtraFields,
    },
    Custom {
        #[serde(flatten)]
        base: SessionEntryBase,
        #[serde(rename = "customType")]
        custom_type: String,
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            deserialize_with = "present"
        )]
        data: Option<Value>,
        #[serde(flatten)]
        extra: ExtraFields,
    },
    CustomMessage {
        #[serde(flatten)]
        base: SessionEntryBase,
        #[serde(rename = "customType")]
        custom_type: String,
        content: UserContent,
        display: bool,
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            deserialize_with = "present"
        )]
        details: Option<Value>,
        #[serde(flatten)]
        extra: ExtraFields,
    },
    Label {
        #[serde(flatten)]
        base: SessionEntryBase,
        #[serde(rename = "targetId")]
        target_id: String,
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            deserialize_with = "present"
        )]
        label: Option<String>,
        #[serde(flatten)]
        extra: ExtraFields,
    },
    SessionInfo {
        #[serde(flatten)]
        base: SessionEntryBase,
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            deserialize_with = "present"
        )]
        name: Option<String>,
        #[serde(flatten)]
        extra: ExtraFields,
    },
}
