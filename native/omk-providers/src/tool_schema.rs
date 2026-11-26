//! Port of OMK's packages/ai/src/providers/tool-schema.ts stableTools (MIT; root LICENSE/NOTICE).
use crate::request::Tool;
use serde_json::value::RawValue;
use std::{cmp::Ordering, collections::BTreeMap};

/// ICU root primary order of the Anthropic tool-name alphabet; lowercase sorts first on ties.
const PRIMARY: &[u8] = b"_-0123456789abcdefghijklmnopqrstuvwxyz";

fn collation_key(name: &str) -> Result<(Vec<usize>, Vec<bool>), String> {
    name.bytes()
        .map(|b| {
            let weight = PRIMARY.iter().position(|p| *p == b.to_ascii_lowercase());
            weight.map(|w| (w, b.is_ascii_uppercase()))
        })
        .collect::<Option<Vec<_>>>()
        .map(|keys| keys.into_iter().unzip())
        .ok_or_else(|| "tool names outside [A-Za-z0-9_-] are not supported".to_string())
}

/// Node localeCompare order for root-equivalent default locales, with canonical schemas.
pub(crate) fn stable(tools: &[Tool]) -> Result<Vec<(&Tool, Box<RawValue>)>, String> {
    let mut keyed = tools
        .iter()
        .map(|tool| {
            let schema = canonical_properties(&tool.properties)?;
            Ok((collation_key(&tool.name)?, tool, schema))
        })
        .collect::<Result<Vec<_>, String>>()?;
    keyed.sort_by(|a, b| a.0.cmp(&b.0));
    if keyed.windows(2).any(|pair| pair[0].0 == pair[1].0) {
        // Node would tie-break on description/schema; duplicate names are refused instead.
        return Err("duplicate tool names are not supported".into());
    }
    Ok(keyed
        .into_iter()
        .map(|(_, tool, schema)| (tool, schema))
        .collect())
}

fn canonical_properties(raw: &RawValue) -> Result<Box<RawValue>, String> {
    let mut out = String::new();
    if raw.get().trim_start().starts_with('{') {
        write(raw, &mut out, key_order)?;
    } else {
        out.push_str("{}");
    }
    RawValue::from_string(out).map_err(|e| e.to_string())
}

pub(crate) fn array_index(key: &str) -> Option<u32> {
    let canonical =
        key == "0" || (!key.starts_with('0') && key.bytes().all(|b| b.is_ascii_digit()));
    key.parse::<u32>()
        .ok()
        .filter(|n| canonical && *n != u32::MAX)
}

/// JSON.parse(canonicalJsonStringify(...)) order: array indexes ascending, then UTF-16 order.
fn key_order(a: &str, b: &str) -> Ordering {
    match (array_index(a), array_index(b)) {
        (Some(x), Some(y)) => x.cmp(&y),
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => a.encode_utf16().cmp(b.encode_utf16()),
    }
}

/// canonicalJsonStringify alone: object keys sorted by UTF-16 code units, no index-first rule.
pub(crate) fn canonical_json(raw: &RawValue) -> Result<String, String> {
    let mut out = String::new();
    write(raw, &mut out, |a, b| a.encode_utf16().cmp(b.encode_utf16()))?;
    Ok(out)
}

fn write(
    raw: &RawValue,
    out: &mut String,
    order: fn(&str, &str) -> Ordering,
) -> Result<(), String> {
    let text = raw.get().trim();
    let json = |e: serde_json::Error| e.to_string();
    match text.as_bytes().first() {
        Some(b'{') => {
            // BTreeMap insertion keeps JSON.parse's last duplicate; nullish `required` is dropped.
            let map: BTreeMap<String, &RawValue> = serde_json::from_str(text).map_err(json)?;
            let mut entries: Vec<_> = map
                .iter()
                .filter(|(key, value)| !(*key == "required" && value.get() == "null"))
                .collect();
            entries.sort_by(|a, b| order(a.0, b.0));
            out.push('{');
            for (index, (key, value)) in entries.into_iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                out.push_str(&serde_json::to_string(key).map_err(json)?);
                out.push(':');
                write(value, out, order)?;
            }
            out.push('}');
        }
        Some(b'[') => {
            let items: Vec<&RawValue> = serde_json::from_str(text).map_err(json)?;
            out.push('[');
            for (index, item) in items.into_iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                write(item, out, order)?;
            }
            out.push(']');
        }
        Some(b'"') => {
            let value: String = serde_json::from_str(text).map_err(json)?;
            out.push_str(&serde_json::to_string(&value).map_err(json)?);
        }
        Some(b't' | b'f' | b'n') => out.push_str(text),
        _ => out.push_str(&js_number(text)?),
    }
    Ok(())
}

/// ECMAScript Number::toString(10) after JSON.parse, from Rust's shortest round-trip digits.
pub(crate) fn js_number(text: &str) -> Result<String, String> {
    let value: f64 = text
        .parse()
        .map_err(|_| "invalid JSON number".to_string())?;
    if !value.is_finite() {
        return Ok("null".into());
    }
    if value == 0.0 {
        return Ok("0".into());
    }
    let scientific = format!("{:e}", value.abs());
    let (mantissa, exponent) = scientific
        .split_once('e')
        .ok_or_else(|| "invalid float formatting".to_string())?;
    let digits = mantissa.replace('.', "");
    let k = digits.len() as i32;
    let n = exponent.parse::<i32>().map_err(|e| e.to_string())? + 1;
    let body = if k <= n && n <= 21 {
        format!("{digits}{}", "0".repeat((n - k) as usize))
    } else if 0 < n && n <= 21 {
        format!("{}.{}", &digits[..n as usize], &digits[n as usize..])
    } else if -6 < n && n <= 0 {
        format!("0.{}{digits}", "0".repeat((-n) as usize))
    } else {
        let (head, tail) = digits.split_at(1);
        let dot = if tail.is_empty() { "" } else { "." };
        let sign = if n > 0 { "+" } else { "-" };
        format!("{head}{dot}{tail}e{sign}{}", (n - 1).abs())
    };
    Ok(if value < 0.0 {
        format!("-{body}")
    } else {
        body
    })
}
