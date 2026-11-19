//! Port of OMK's packages/ai/src/utils/json-parse.ts (MIT; root LICENSE/NOTICE).
use crate::partial_json;
use serde_json::{Value, json};
use std::fmt;

#[derive(Debug)]
pub enum JsonError {
    Limit(&'static str),
    Unsupported(&'static str),
    Syntax(String),
}
impl fmt::Display for JsonError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Limit(message) | Self::Unsupported(message) => f.write_str(message),
            Self::Syntax(message) => f.write_str(message),
        }
    }
}
impl std::error::Error for JsonError {}

fn bounded(input: &str) -> Result<(), JsonError> {
    if input.len() > 1024 * 1024 {
        return Err(JsonError::Limit("JSON input exceeds 1 MiB"));
    }
    let (mut depth, mut quoted, mut escaped) = (0usize, false, false);
    for ch in input.chars() {
        if quoted {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                quoted = false;
            }
        } else {
            match ch {
                '"' => quoted = true,
                '[' | '{' => {
                    depth += 1;
                    if depth > 64 {
                        return Err(JsonError::Limit("JSON nesting exceeds 64"));
                    }
                }
                ']' | '}' => depth = depth.saturating_sub(1),
                _ => {}
            }
        }
    }
    scalar_escapes(input)
}

fn scalar_escapes(input: &str) -> Result<(), JsonError> {
    let bytes = input.as_bytes();
    let hex = |start: usize| -> Option<u16> {
        let digits = bytes.get(start..start + 4)?;
        if !digits.iter().all(u8::is_ascii_hexdigit) {
            return None;
        }
        u16::from_str_radix(std::str::from_utf8(digits).ok()?, 16).ok()
    };
    let (mut index, mut quoted) = (0, false);
    while index < bytes.len() {
        if bytes[index] == b'"' {
            quoted = !quoted;
            index += 1;
        } else if quoted && bytes[index] == b'\\' {
            if bytes.get(index + 1) == Some(&b'u')
                && let Some(code) = hex(index + 2)
            {
                if (0xd800..=0xdbff).contains(&code) {
                    if bytes.get(index + 6..index + 8) == Some(b"\\u")
                        && hex(index + 8).is_some_and(|low| (0xdc00..=0xdfff).contains(&low))
                    {
                        index += 12;
                        continue;
                    }
                    return Err(JsonError::Unsupported(
                        "unpaired UTF-16 escape is outside the Rust JSON value surface",
                    ));
                }
                if (0xdc00..=0xdfff).contains(&code) {
                    return Err(JsonError::Unsupported(
                        "unpaired UTF-16 escape is outside the Rust JSON value surface",
                    ));
                }
            }
            index += 2;
        } else {
            index += 1;
        }
    }
    Ok(())
}

pub fn repair_json(input: &str) -> Result<String, JsonError> {
    bounded(input)?;
    let chars: Vec<char> = input.chars().collect();
    let (mut index, mut quoted) = (0, false);
    let mut output = String::with_capacity(input.len());
    while index < chars.len() {
        let ch = chars[index];
        index += 1;
        if !quoted {
            output.push(ch);
            if ch == '"' {
                quoted = true;
            }
        } else if ch == '"' {
            output.push(ch);
            quoted = false;
        } else if ch == '\\' {
            let next = chars.get(index).copied();
            if next == Some('u')
                && chars
                    .get(index + 1..index + 5)
                    .is_some_and(|s| s.iter().all(char::is_ascii_hexdigit))
            {
                output.push_str("\\u");
                for digit in &chars[index + 1..index + 5] {
                    output.push(*digit);
                }
                index += 5;
            } else if next
                .is_some_and(|c| matches!(c, '"' | '\\' | '/' | 'b' | 'f' | 'n' | 'r' | 't' | 'u'))
            {
                output.push('\\');
                output.push(chars[index]);
                index += 1;
            } else {
                output.push_str("\\\\");
            }
        } else if ch <= '\u{1f}' {
            let escaped = serde_json::to_string(&ch.to_string())
                .map_err(|e| JsonError::Syntax(e.to_string()))?;
            output.push_str(&escaped[1..escaped.len() - 1]);
        } else {
            output.push(ch);
        }
    }
    Ok(output)
}

// Preserve the observable JSON number shape of JSON.stringify for integral floats.
fn integral_numbers(value: &mut Value, safe_numbers: bool) -> Result<(), JsonError> {
    match value {
        Value::Number(n) => {
            let number = n
                .as_f64()
                .ok_or(JsonError::Unsupported("JSON number cannot be represented"))?;
            if number.fract() == 0.0 {
                if number.abs() > 9_007_199_254_740_991.0 {
                    return if safe_numbers {
                        Err(JsonError::Unsupported(
                            "JSON integer exceeds the safe JavaScript integer surface",
                        ))
                    } else {
                        Ok(())
                    };
                }
                if n.is_f64() {
                    *value = json!(number as i64);
                }
            }
        }
        Value::Array(items) => {
            for item in items {
                integral_numbers(item, safe_numbers)?;
            }
        }
        Value::Object(items) => {
            for item in items.values_mut() {
                integral_numbers(item, safe_numbers)?;
            }
        }
        _ => {}
    }
    Ok(())
}

pub(crate) fn strict(input: &str, safe_numbers: bool) -> Result<Value, JsonError> {
    let mut value = serde_json::from_str(input).map_err(|error: serde_json::Error| {
        if error.to_string().starts_with("number out of range") { return JsonError::Unsupported("JSON number is outside the finite Rust value surface"); }
        let detail = if input.is_empty() {
            "Unexpected end of JSON input".to_owned()
        } else if input.trim() == "{" {
            let position = input.encode_utf16().count();
            let line = input.bytes().filter(|b| *b == b'\n').count() + 1;
            let column = input.rsplit('\n').next().unwrap_or("").encode_utf16().count() + 1;
            format!("Expected property name or '}}' in JSON at position {position} (line {line} column {column})")
        } else { error.to_string() };
        JsonError::Syntax(detail)
    })?;
    integral_numbers(&mut value, safe_numbers)?;
    Ok(value)
}

pub fn parse_json_with_repair(input: &str) -> Result<Value, JsonError> {
    parse_with_repair(input, true)
}

// Envelope usage integers retain the reducer's existing field validation and errors.
pub(crate) fn parse_sse_with_repair(input: &str) -> Result<Value, JsonError> {
    parse_with_repair(input, false)
}

fn parse_with_repair(input: &str, safe_numbers: bool) -> Result<Value, JsonError> {
    bounded(input)?;
    match strict(input, safe_numbers) {
        Ok(value) => Ok(value),
        Err(original) => {
            let repaired = repair_json(input)?;
            if repaired == input {
                Err(original)
            } else {
                strict(&repaired, safe_numbers)
            }
        }
    }
}

pub fn parse_streaming_json(input: &str) -> Result<Value, JsonError> {
    bounded(input)?;
    if input.trim().is_empty() {
        return Ok(json!({}));
    }
    match parse_json_with_repair(input) {
        Ok(value) => return Ok(value),
        Err(JsonError::Syntax(_)) => {}
        Err(error) => return Err(error),
    }
    let value = match partial_json::parse(input) {
        Ok(value) => value,
        Err(error @ (JsonError::Limit(_) | JsonError::Unsupported(_))) => return Err(error),
        Err(JsonError::Syntax(_)) => {
            let repaired = repair_json(input)?;
            match partial_json::parse(&repaired) {
                Ok(value) => value,
                Err(error @ (JsonError::Limit(_) | JsonError::Unsupported(_))) => {
                    return Err(error);
                }
                Err(JsonError::Syntax(_)) => return Ok(json!({})),
            }
        }
    };
    let trimmed = input.trim_matches(partial_json::blank);
    let nullish = value.is_null() && (trimmed.starts_with("null") || "null".starts_with(trimmed));
    Ok(if nullish { json!({}) } else { value })
}
