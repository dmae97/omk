use serde::de::{MapAccess, Visitor, value::MapAccessDeserializer};
use serde::{Deserialize, Deserializer, Serialize};
use std::{fmt, marker::PhantomData};

#[derive(Debug, Clone, Eq, PartialEq, Serialize)]
#[serde(transparent)]
pub(crate) struct Object<T>(pub T);

// Same object-only visitor as the existing native wire; do not convert through Value and lose duplicates.
impl<'de, T: Deserialize<'de>> Deserialize<'de> for Object<T> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Map<T>(PhantomData<T>);
        impl<'de, T: Deserialize<'de>> Visitor<'de> for Map<T> {
            type Value = Object<T>;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("an object")
            }
            fn visit_map<M: MapAccess<'de>>(self, map: M) -> Result<Self::Value, M::Error> {
                T::deserialize(MapAccessDeserializer::new(map)).map(Object)
            }
        }
        deserializer.deserialize_map(Map(PhantomData))
    }
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Snapshot {
    pub(crate) schema_version: String,
    pub(crate) runtime: String,
    pub(crate) graph_kind: String,
    pub(crate) execution_requested: bool,
    pub(crate) capabilities: Object<Capabilities>,
    pub(crate) run_id: String,
    pub(crate) cursor: Object<Cursor>,
    pub(crate) state: Object<State>,
    pub(crate) proof_verdict: String,
    pub(crate) nodes: Vec<Object<Node>>,
    pub(crate) edges: Vec<Object<Edge>>,
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Capabilities {
    pub execute: bool,
    pub amend_graph: bool,
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Cursor {
    pub revision: u64,
    pub generation: u64,
    pub authority_revision: u64,
    pub authority_digest: String,
    pub journal_digest: String,
    pub contract_digest: String,
    #[serde(deserialize_with = "Deserialize::deserialize")]
    pub candidate_digest: Option<String>,
    #[serde(deserialize_with = "Deserialize::deserialize")]
    pub receipt_digest: Option<String>,
    #[serde(deserialize_with = "Deserialize::deserialize")]
    pub environment_digest: Option<String>,
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct State {
    pub execution: String,
    pub settlement: String,
    pub verification: String,
    pub application: String,
    pub publication: String,
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Node {
    pub id: String,
    pub depends_on: Vec<String>,
    pub status: String,
    pub attempt: u64,
    #[serde(deserialize_with = "Deserialize::deserialize")]
    pub generation: Option<u64>,
    pub ready: bool,
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Edge {
    pub source: String,
    pub target: String,
    pub kind: String,
}
