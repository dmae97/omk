//! Public stdin/stdout RPC contracts. No transport, dispatch or runtime policy.
use serde::{Deserialize, Deserializer, Serialize, Serializer};
#[path = "rpc_command.rs"]
pub mod command;
#[path = "rpc_data.rs"]
pub mod data;
#[path = "rpc_events.rs"]
pub mod events;
#[path = "rpc_response.rs"]
pub mod response;
#[path = "rpc_status.rs"]
pub mod status;
#[path = "rpc_stream.rs"]
pub mod stream;
#[path = "rpc_ui.rs"]
pub mod ui;
pub use command::{CommandBody, RpcCommand, ThinkingLevel};
pub use events::RpcEvent;
pub use response::RpcResponse;
pub use ui::{RpcUiRequest, RpcUiResponse};

/// Missing optional properties stay absent; present null is accepted only if T
/// admits null (e.g. Value), never as a substitute for an optional primitive.
#[derive(Debug, Clone, PartialEq, Default)]
pub enum Optional<T> {
    #[default]
    Absent,
    Present(T),
}
impl<T> Optional<T> {
    pub fn is_absent(&self) -> bool {
        matches!(self, Self::Absent)
    }
}
impl<T: Serialize> Serialize for Optional<T> {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Absent => s.serialize_none(),
            Self::Present(v) => v.serialize(s),
        }
    }
}
impl<'de, T: Deserialize<'de>> Deserialize<'de> for Optional<T> {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        T::deserialize(d).map(Self::Present)
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Bool<const B: bool>;
impl<const B: bool> Serialize for Bool<B> {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_bool(B)
    }
}
impl<'de, const B: bool> Deserialize<'de> for Bool<B> {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        if bool::deserialize(d)? == B {
            Ok(Self)
        } else {
            Err(serde::de::Error::custom("invalid boolean literal"))
        }
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Version<const V: u64>;
impl<const V: u64> Serialize for Version<V> {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_u64(V)
    }
}
impl<'de, const V: u64> Deserialize<'de> for Version<V> {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        if serde_json::Number::deserialize(d)?.as_f64() == Some(V as f64) {
            Ok(Self)
        } else {
            Err(serde::de::Error::custom("unsupported wire schema version"))
        }
    }
}
// A newtype prevents serde's missing-field special case for Option: null is
// a valid data payload for cycle_* responses, but an omitted data key is not.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(transparent)]
pub struct Nullable<T>(pub Option<T>);
impl<'de, T: serde::de::DeserializeOwned> Deserialize<'de> for Nullable<T> {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let value = serde_json::Value::deserialize(d)?;
        serde_json::from_value(value)
            .map(Self)
            .map_err(serde::de::Error::custom)
    }
}

/// Unknown fields around a tagged union, without serde flatten emitting its
/// discriminator/payload twice. Reserved keys cannot be overwritten by extras.
#[derive(Debug, Clone, PartialEq)]
pub struct Open<T> {
    pub body: T,
    pub extra: crate::session::ExtraFields,
}
impl<T: Serialize> Serialize for Open<T> {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let serde_json::Value::Object(mut fields) =
            serde_json::to_value(&self.body).map_err(serde::ser::Error::custom)?
        else {
            return Err(serde::ser::Error::custom("expected object body"));
        };
        for (key, value) in &self.extra {
            if fields.insert(key.clone(), value.clone()).is_some() {
                return Err(serde::ser::Error::custom("reserved field in RPC extras"));
            }
        }
        fields.serialize(s)
    }
}
impl<'de, T: Serialize + serde::de::DeserializeOwned> Deserialize<'de> for Open<T> {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let mut extra = crate::session::ExtraFields::deserialize(d)?;
        let body: T = serde_json::from_value(serde_json::Value::Object(extra.clone()))
            .map_err(serde::de::Error::custom)?;
        let encoded = serde_json::to_value(&body).map_err(serde::de::Error::custom)?;
        if let Some(fields) = encoded.as_object() {
            for key in fields.keys() {
                extra.remove(key);
            }
        }
        Ok(Self { body, extra })
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum RpcInput {
    Command(RpcCommand),
    UiResponse(RpcUiResponse),
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum RpcOutput {
    Response(Box<RpcResponse>),
    UiRequest(RpcUiRequest),
    Event(Box<RpcEvent>),
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum RpcMessage {
    Input(RpcInput),
    Output(RpcOutput),
}

pub type RpcRecord = crate::jsonl::JsonRecord<RpcMessage>;
