//! createClient header merge (openai-responses.ts) and the openai SDK's buildHeaders order
//! (internal/headers.js, client.js; Apache-2.0): accept, auth, defaultHeaders, then content-type.
use crate::openai_completions::plain_header_value;
use serde::{
    Deserialize, Deserializer,
    de::{MapAccess, Visitor},
};
use serde_json::{Map, Value, json};
use std::{collections::HashSet, fmt};

/// A JS `Record<string, string>` in source key order; duplicate keys are refused.
#[derive(Default)]
pub(super) struct Headers(Vec<(String, String)>);
impl<'de> Deserialize<'de> for Headers {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = Headers;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("an object of string header values")
            }
            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Headers, A::Error> {
                let mut entries = Vec::new();
                let mut seen = HashSet::new();
                while let Some((name, value)) = map.next_entry::<String, String>()? {
                    if !seen.insert(name.clone()) {
                        return Err(serde::de::Error::custom("duplicate header name"));
                    }
                    entries.push((name, value));
                }
                Ok(Headers(entries))
            }
        }
        d.deserialize_map(V)
    }
}
impl Headers {
    /// Object.assign: an existing key keeps its position and takes the new value.
    fn set(&mut self, name: &str, value: &str) {
        match self.0.iter_mut().find(|(n, _)| n == name) {
            Some(entry) => entry.1 = value.into(),
            None => self.0.push((name.into(), value.into())),
        }
    }
}

fn token(name: &str) -> bool {
    !name.is_empty()
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&b))
}

pub(super) struct Merge<'a> {
    pub model: Option<&'a Headers>,
    pub session: Option<&'a str>,
    pub send_session_id: bool,
    pub options: Option<&'a Headers>,
    pub api_key: &'a str,
}
pub(super) fn merge(m: &Merge) -> Result<Value, String> {
    let mut merged = Headers(m.model.map(|h| h.0.clone()).unwrap_or_default());
    if let Some(session) = m.session {
        let session = plain_header_value(session)?;
        if m.send_session_id {
            merged.set("session_id", session);
        }
        merged.set("x-client-request-id", session);
    }
    for (name, value) in m.options.iter().flat_map(|h| &h.0) {
        merged.set(name, value);
    }
    // Array-index keys would reorder under Object.entries, but digits have no case variants,
    // so per-lowercase-name "last entry wins" is unaffected.
    let mut out = Map::new();
    out.insert("accept".into(), json!("application/json"));
    out.insert(
        "authorization".into(),
        json!(format!("Bearer {}", m.api_key)),
    );
    for (name, value) in &merged.0 {
        let lower = name.to_ascii_lowercase();
        if !token(name) {
            return Err(format!("header name is not an HTTP token: {name:?}"));
        }
        if lower == "user-agent" || lower.starts_with("x-stainless-") {
            return Err(format!("SDK-owned header is not ported: {name}"));
        }
        out.insert(lower, json!(plain_header_value(value)?));
    }
    // bodyHeaders come after defaultHeaders in buildHeaders.
    out.insert("content-type".into(), json!("application/json"));
    Ok(Value::Object(out))
}
