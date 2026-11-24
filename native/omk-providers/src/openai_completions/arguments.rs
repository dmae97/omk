//! JSON.stringify on object arguments: index keys first, other keys in insertion order.
use crate::tool_schema::{array_index, js_number};
use serde::{
    Deserialize, Deserializer,
    de::{MapAccess, Visitor},
};
use serde_json::value::RawValue;
use std::{collections::HashSet, fmt};

struct Entries<'a>(Vec<(String, &'a RawValue)>);
impl<'de> Deserialize<'de> for Entries<'de> {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = Entries<'de>;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("object arguments")
            }
            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
                let mut entries = Vec::new();
                let mut seen = HashSet::new();
                while let Some((key, value)) = map.next_entry::<String, &RawValue>()? {
                    if !seen.insert(key.clone()) {
                        return Err(serde::de::Error::custom("duplicate argument key"));
                    }
                    entries.push((key, value));
                }
                entries.sort_by_key(|(key, _)| array_index(key).unwrap_or(u32::MAX));
                Ok(Entries(entries))
            }
        }
        d.deserialize_map(V)
    }
}
pub(crate) fn stringify(raw: &RawValue) -> Result<String, String> {
    if !raw.get().starts_with('{') {
        return Err("tool arguments must be an object".into());
    }
    let mut out = String::new();
    write(raw, &mut out, 0)?;
    Ok(out)
}
/// JSON.parse followed by filter(Boolean), then reserialize with JS key order.
pub(super) fn detail(signature: &str) -> Result<Option<Box<RawValue>>, String> {
    let Ok(raw) = serde_json::from_str::<&RawValue>(signature) else {
        return Ok(None);
    };
    let mut out = String::new();
    write(raw, &mut out, 0)?;
    if matches!(out.as_str(), "false" | "0" | "\"\"") || raw.get() == "null" {
        return Ok(None);
    }
    RawValue::from_string(out)
        .map(Some)
        .map_err(|e| e.to_string())
}
fn write(raw: &RawValue, out: &mut String, depth: u8) -> Result<(), String> {
    if depth > 64 {
        return Err("tool arguments exceed depth limit".into());
    }
    let s = raw.get();
    let err = |e: serde_json::Error| e.to_string();
    match s.as_bytes()[0] {
        b'{' => {
            let entries: Entries = serde_json::from_str(s).map_err(err)?;
            out.push('{');
            for (i, (key, val)) in entries.0.into_iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&serde_json::to_string(&key).map_err(err)?);
                out.push(':');
                write(val, out, depth + 1)?;
            }
            out.push('}');
        }
        b'[' => {
            let items: Vec<&RawValue> = serde_json::from_str(s).map_err(err)?;
            out.push('[');
            for (i, val) in items.into_iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write(val, out, depth + 1)?;
            }
            out.push(']');
        }
        b'"' => out.push_str(
            &serde_json::to_string(&serde_json::from_str::<String>(s).map_err(err)?)
                .map_err(err)?,
        ),
        b't' | b'f' | b'n' => out.push_str(s),
        _ => out.push_str(&js_number(s)?),
    }
    Ok(())
}
