use crate::WireError;
use serde::de::{MapAccess, Visitor, value::MapAccessDeserializer};
use serde::{Deserialize, Deserializer, Serialize};
use std::{fmt, marker::PhantomData};

pub const VERSION: &str = "omk.native-agent.v1";
pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

// MapAccessDeserializer forwards the original entries, including duplicate keys.
fn object<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    struct Object<T>(PhantomData<T>);
    impl<'de, T: Deserialize<'de>> Visitor<'de> for Object<T> {
        type Value = T;

        fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
            formatter.write_str("an object")
        }

        fn visit_map<M: MapAccess<'de>>(self, map: M) -> Result<T, M::Error> {
            T::deserialize(MapAccessDeserializer::new(map))
        }
    }
    deserializer.deserialize_map(Object(PhantomData))
}

#[derive(Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Identity {
    version: String,
    launch_id: String,
    session_id: String,
    prompt_id: String,
    tool_call_id: String,
    scope_epoch_id: String,
    generation: u64,
    attempt: u64,
    grant_digest: String,
}

impl Identity {
    fn valid(&self) -> bool {
        self.version == VERSION
            && [
                &self.launch_id,
                &self.session_id,
                &self.prompt_id,
                &self.tool_call_id,
                &self.scope_epoch_id,
            ]
            .iter()
            .all(|id| (1..=128).contains(&id.len()))
            && (1..=MAX_SAFE_INTEGER).contains(&self.generation)
            && (1..=MAX_SAFE_INTEGER).contains(&self.attempt)
            && self.grant_digest.len() == 64
            && self
                .grant_digest
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Control {
    #[serde(deserialize_with = "object")]
    pub(crate) identity: Identity,
    pub(crate) control_seq: u64,
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "type",
    content = "data",
    rename_all = "lowercase",
    deny_unknown_fields
)]
pub enum Request {
    Hello(#[serde(deserialize_with = "object")] Control),
    Execute(#[serde(deserialize_with = "object")] Control),
}

pub fn parse_request(bytes: &[u8]) -> Result<Request, WireError> {
    let mut decoder = serde_json::Deserializer::from_slice(bytes);
    let request: Request = object(&mut decoder).map_err(|_| WireError::Schema)?;
    decoder.end().map_err(|_| WireError::Schema)?;
    let (Request::Hello(control) | Request::Execute(control)) = &request;
    if !control.identity.valid() {
        return Err(WireError::Identity);
    }
    if !(1..=MAX_SAFE_INTEGER).contains(&control.control_seq) {
        return Err(WireError::Sequence);
    }
    Ok(request)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Capabilities {
    pub offline_only: bool,
    pub backend: bool,
    pub execute: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Ready<'a> {
    pub identity: &'a Identity,
    pub control_seq: u64,
    pub capabilities: Capabilities,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Unsupported<'a> {
    pub identity: &'a Identity,
    pub control_seq: u64,
    pub status: &'static str,
    pub started: bool,
}

#[derive(Serialize)]
#[serde(
    tag = "type",
    content = "data",
    rename_all = "lowercase",
    deny_unknown_fields
)]
pub(crate) enum Reply<'a> {
    Ready(Ready<'a>),
    Result(Unsupported<'a>),
}
