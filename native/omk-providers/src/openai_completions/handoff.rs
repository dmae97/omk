//! First pass of transform-messages.ts and Chat Completions normalizeToolCallId (MIT).
use super::pairing::Message;
use crate::request_history::nonblank;
use serde::Deserialize;
use serde_json::value::RawValue;
use std::collections::HashMap;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Source {
    provider: String,
    api: String,
    model: String,
}

// Keep arguments raw; serde's internally tagged enum buffering loses their key order.
#[derive(Deserialize)]
#[serde(try_from = "Box<RawValue>")]
pub(super) enum Block {
    Text {
        text: String,
    },
    Thinking {
        thinking: String,
        signature: Option<String>,
        redacted: bool,
    },
    ToolCall {
        id: String,
        name: String,
        arguments: Box<RawValue>,
        signature: Option<String>,
    },
}
impl TryFrom<Box<RawValue>> for Block {
    type Error = String;
    fn try_from(raw: Box<RawValue>) -> Result<Self, String> {
        #[derive(Deserialize)]
        struct Tag {
            r#type: String,
        }
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Call {
            #[serde(rename = "type")]
            _kind: String,
            id: String,
            name: String,
            arguments: Box<RawValue>,
            thought_signature: Option<String>,
        }
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Text {
            #[serde(rename = "type")]
            _kind: String,
            text: String,
            #[serde(rename = "textSignature")]
            _signature: Option<String>,
        }
        let err = |e: serde_json::Error| e.to_string();
        let s = raw.get();
        match serde_json::from_str::<Tag>(s).map_err(err)?.r#type.as_str() {
            "toolCall" => {
                let c: Call = serde_json::from_str(s).map_err(err)?;
                Ok(Self::ToolCall {
                    id: c.id,
                    name: c.name,
                    arguments: c.arguments,
                    signature: c.thought_signature,
                })
            }
            "text" => Ok(Self::Text {
                text: serde_json::from_str::<Text>(s).map_err(err)?.text,
            }),
            "thinking" => {
                let crate::request_blocks::Block::Thinking {
                    thinking,
                    thinking_signature,
                    redacted,
                } = serde_json::from_str(s).map_err(err)?
                else {
                    return Err("expected thinking block".into());
                };
                Ok(Self::Thinking {
                    thinking,
                    signature: thinking_signature,
                    redacted,
                })
            }
            _ => Err("unsupported assistant block".into()),
        }
    }
}

pub(super) fn prepare(
    messages: &mut [Message],
    provider: Option<&str>,
    model: &str,
) -> Result<(), String> {
    if provider.is_some_and(|p| !matches!(p, "openai" | "synthetic")) {
        return Err("unsupported target provider identity".into());
    }
    let mut ids = HashMap::new();
    for msg in messages {
        match msg {
            Message::Assistant(blocks, _, Some(source)) => {
                let target = provider.ok_or("source requires target provider")?;
                if source.provider == target
                    && source.api == "openai-completions"
                    && source.model == model
                {
                    continue;
                }
                for block in blocks.iter_mut() {
                    match block {
                        Block::ToolCall { id, signature, .. } => {
                            *signature = None;
                            let next = normalize(id, target)?;
                            if *id != next {
                                ids.insert(std::mem::replace(id, next.clone()), next);
                            }
                        }
                        Block::Thinking {
                            thinking, redacted, ..
                        } => {
                            let text = if !*redacted && nonblank(thinking) {
                                std::mem::take(thinking)
                            } else {
                                String::new()
                            };
                            *block = Block::Text { text };
                        }
                        Block::Text { .. } => {}
                    }
                }
            }
            Message::Result(id, _, _) => {
                if let Some(mapped) = ids.get(id).filter(|s| !s.is_empty()) {
                    id.clone_from(mapped);
                }
            }
            Message::Assistant(blocks, _, None)
                if blocks.iter().any(|b| {
                    matches!(
                        b,
                        Block::Thinking { .. }
                            | Block::ToolCall {
                                signature: Some(_),
                                ..
                            }
                    )
                }) =>
            {
                return Err("signed history requires explicit source identity".into());
            }
            _ => {}
        }
    }
    Ok(())
}
fn normalize(id: &str, provider: &str) -> Result<String, String> {
    let Some((call, item)) = id.split_once('|') else {
        if provider == "openai" {
            return String::from_utf16(&id.encode_utf16().take(40).collect::<Vec<_>>())
                .map_err(|_| "ID truncation splits surrogate pair".into());
        }
        return Ok(id.into());
    };
    let clean = |s: &str| {
        s.encode_utf16()
            .map(|c| match u8::try_from(c) {
                Ok(b) if b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-') => b as char,
                _ => '_',
            })
            .collect::<String>()
    };
    let call = clean(call);
    let item = clean(item);
    let combined = if item.is_empty() {
        call.clone()
    } else {
        format!("{call}_{item}")
    };
    if combined.len() <= 40 {
        return Ok(combined);
    }
    let hash = short_hash(id);
    let suffix = &hash[..8.min(hash.len())];
    Ok(format!(
        "{}_{}",
        &call[..call.len().min(39 - suffix.len())],
        suffix
    ))
}
// utils/hash.ts: Math.imul wraps modulo 2^32; charCodeAt reads UTF-16 code units.
pub(crate) fn short_hash(s: &str) -> String {
    fn base36(mut n: u32) -> String {
        let mut digits = Vec::new();
        loop {
            digits.push(char::from_digit(n % 36, 36).unwrap());
            n /= 36;
            if n == 0 {
                break;
            }
        }
        digits.into_iter().rev().collect()
    }
    let (mut a, mut b) = (0xdeadbeefu32, 0x41c6ce57u32);
    for c in s.encode_utf16() {
        a = (a ^ u32::from(c)).wrapping_mul(2654435761);
        b = (b ^ u32::from(c)).wrapping_mul(1597334677);
    }
    let mix = |a: u32, b: u32| {
        (a ^ (a >> 16)).wrapping_mul(2246822507) ^ (b ^ (b >> 13)).wrapping_mul(3266489909)
    };
    a = mix(a, b);
    b = mix(b, a);
    format!("{}{}", base36(b), base36(a))
}
