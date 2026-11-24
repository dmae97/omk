//! transform-messages.ts plus convertResponsesMessages history items (MIT; root LICENSE/NOTICE).
//! Images need caller-resolved vision: true keeps them as data URLs, false downgrades them.
use crate::{
    openai_completions::{arguments, handoff::short_hash},
    request_blocks::StopReason,
    request_content::{InputContent, TOOL_IMAGE, USER_IMAGE, texts},
    request_history::{blank, nonblank},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, value::RawValue};
use std::{
    borrow::Cow,
    collections::{HashMap, HashSet},
};

const API: &str = "openai-responses";
const TOOL_CALL_PROVIDERS: [&str; 3] = ["openai", "openai-codex", "opencode"];

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Source {
    provider: String,
    api: String,
    model: String,
}
#[derive(Deserialize)]
#[serde(untagged)]
pub(super) enum Content {
    Text(String),
    Parts(Vec<InputContent>),
}

// Arguments stay raw: serde's tagged-enum buffering would lose their key order.
#[derive(Deserialize)]
#[serde(try_from = "Box<RawValue>")]
pub(super) enum Block {
    Text {
        text: String,
        signature: Option<String>,
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
        struct Text {
            #[serde(rename = "type")]
            _kind: String,
            text: String,
            text_signature: Option<String>,
        }
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Thinking {
            #[serde(rename = "type")]
            _kind: String,
            thinking: String,
            thinking_signature: Option<String>,
            redacted: Option<bool>,
        }
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Call {
            #[serde(rename = "type")]
            _kind: String,
            id: String,
            name: String,
            arguments: Box<RawValue>,
            // Never emitted by the Responses converter.
            #[serde(rename = "thoughtSignature")]
            _signature: Option<String>,
        }
        let err = |e: serde_json::Error| e.to_string();
        let s = raw.get();
        match serde_json::from_str::<Tag>(s).map_err(err)?.r#type.as_str() {
            "text" => {
                let t: Text = serde_json::from_str(s).map_err(err)?;
                Ok(Self::Text {
                    text: t.text,
                    signature: t.text_signature,
                })
            }
            "thinking" => {
                let t: Thinking = serde_json::from_str(s).map_err(err)?;
                Ok(Self::Thinking {
                    thinking: t.thinking,
                    signature: t.thinking_signature,
                    redacted: t.redacted.unwrap_or(false),
                })
            }
            "toolCall" => {
                let c: Call = serde_json::from_str(s).map_err(err)?;
                Ok(Self::ToolCall {
                    id: c.id,
                    name: c.name,
                    arguments: c.arguments,
                })
            }
            _ => Err("unsupported assistant block".into()),
        }
    }
}

#[derive(Deserialize)]
#[serde(try_from = "Fields")]
pub(super) enum Message {
    User(Content),
    Assistant(Vec<Block>, StopReason, Source),
    Result(String, Vec<InputContent>),
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fields {
    role: String,
    content: Box<RawValue>,
    source: Option<Source>,
    stop_reason: Option<StopReason>,
    tool_call_id: Option<String>,
    #[serde(rename = "toolName")]
    _tool_name: Option<String>,
    #[serde(rename = "isError")]
    _is_error: Option<bool>,
}
impl TryFrom<Fields> for Message {
    type Error = String;
    fn try_from(f: Fields) -> Result<Self, String> {
        let raw = f.content.get();
        let err = |e: serde_json::Error| e.to_string();
        let tool = f.tool_call_id.is_some() || f._tool_name.is_some() || f._is_error.is_some();
        match (f.role.as_str(), f.source, f.stop_reason, tool) {
            ("user", None, None, false) => Ok(Self::User(serde_json::from_str(raw).map_err(err)?)),
            ("assistant", Some(source), stop, false) => Ok(Self::Assistant(
                serde_json::from_str(raw).map_err(err)?,
                stop.unwrap_or_default(),
                source,
            )),
            ("toolResult", None, None, true) => Ok(Self::Result(
                f.tool_call_id.ok_or("toolResult needs toolCallId")?,
                serde_json::from_str(raw).map_err(err)?,
            )),
            _ => Err("unsupported history fields (assistants need explicit source)".into()),
        }
    }
}

pub(super) fn has_images(messages: &[Message]) -> bool {
    let image = |c: &[InputContent]| c.iter().any(|c| matches!(c, InputContent::Image { .. }));
    messages.iter().any(|m| match m {
        Message::User(Content::Parts(c)) | Message::Result(_, c) => image(c),
        _ => false,
    })
}

/// normalizeIdPart: UTF-16 units outside [A-Za-z0-9_-] become `_`, 64 units, no trailing `_`.
fn id_part(part: &str) -> String {
    let clean: String = part
        .encode_utf16()
        .take(64)
        .map(|c| match u8::try_from(c) {
            Ok(b) if b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-') => b as char,
            _ => '_',
        })
        .collect();
    clean.trim_end_matches('_').into()
}
fn normalize(id: &str, provider: &str, source: &Source) -> String {
    let Some((call, rest)) = id
        .split_once('|')
        .filter(|_| TOOL_CALL_PROVIDERS.contains(&provider))
    else {
        return id_part(id);
    };
    // JS split("|")[1]: text up to the next `|`.
    let item = rest.split('|').next().unwrap_or_default();
    let foreign = source.provider != provider || source.api != API;
    let mut item = if foreign {
        format!("fc_{}", short_hash(item))
    } else {
        id_part(item)
    };
    if !item.starts_with("fc_") {
        item = id_part(&format!("fc_{item}"));
    }
    format!("{}|{item}", id_part(call))
}

/// First pass of transformMessages for a target that is never the source model itself.
pub(super) fn prepare(messages: &mut [Message], provider: &str, model: &str) {
    let mut ids = HashMap::new();
    for message in messages {
        match message {
            Message::Assistant(blocks, _, source)
                if !(source.provider == provider && source.api == API && source.model == model) =>
            {
                let mut kept = Vec::with_capacity(blocks.len());
                for block in std::mem::take(blocks) {
                    match block {
                        Block::Thinking {
                            thinking, redacted, ..
                        } => {
                            if !redacted && nonblank(&thinking) {
                                kept.push(Block::Text {
                                    text: thinking,
                                    signature: None,
                                });
                            }
                        }
                        Block::Text { text, .. } => kept.push(Block::Text {
                            text,
                            signature: None,
                        }),
                        Block::ToolCall {
                            id,
                            name,
                            arguments,
                        } => {
                            let next = normalize(&id, provider, source);
                            if next != id {
                                ids.insert(id, next.clone());
                            }
                            kept.push(Block::ToolCall {
                                id: next,
                                name,
                                arguments,
                            });
                        }
                    }
                }
                *blocks = kept;
            }
            Message::Result(id, _) => {
                if let Some(mapped) = ids.get(id.as_str()).filter(|s| !s.is_empty()) {
                    id.clone_from(mapped);
                }
            }
            _ => {}
        }
    }
}

enum Turn<'a> {
    User(&'a Content),
    Assistant(&'a [Block], &'a Source),
    /// `None` is the synthetic "No result provided" result.
    Result(&'a str, Option<&'a [InputContent]>),
}
/// Second pass: drop error/aborted turns and orphan results, synthesize missing results.
fn pair(messages: &[Message]) -> Vec<Turn<'_>> {
    let mut out = Vec::new();
    let mut live = HashSet::new();
    let mut pending: Vec<&str> = Vec::new();
    let mut provided = HashSet::new();
    for message in messages.iter().map(Some).chain(std::iter::once(None)) {
        if !matches!(message, Some(Message::Result(..))) {
            for id in pending.drain(..) {
                if !provided.contains(id) {
                    out.push(Turn::Result(id, None));
                }
            }
            provided.clear();
        }
        match message {
            None => break,
            Some(Message::User(content)) => out.push(Turn::User(content)),
            Some(Message::Assistant(_, StopReason::Error | StopReason::Aborted, _)) => {}
            Some(Message::Assistant(blocks, _, source)) => {
                for b in blocks {
                    if let Block::ToolCall { id, .. } = b {
                        pending.push(id);
                        if !id.is_empty() {
                            live.insert(id.as_str());
                        }
                    }
                }
                out.push(Turn::Assistant(blocks, source));
            }
            Some(Message::Result(id, parts)) => {
                let id = id.trim_matches(blank);
                if live.contains(id) {
                    provided.insert(id);
                    out.push(Turn::Result(id, Some(parts)));
                }
            }
        }
    }
    out
}

#[derive(Serialize)]
#[serde(untagged)]
pub(super) enum Item<'a> {
    System {
        role: &'static str,
        content: &'a str,
    },
    User {
        role: &'static str,
        content: Vec<Part<'a>>,
    },
    Message {
        r#type: &'static str,
        role: &'static str,
        content: [OutputText<'a>; 1],
        status: &'static str,
        id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        phase: Option<&'static str>,
    },
    Call {
        r#type: &'static str,
        #[serde(skip_serializing_if = "Option::is_none")]
        id: Option<&'a str>,
        call_id: &'a str,
        name: &'a str,
        arguments: String,
    },
    Output {
        r#type: &'static str,
        call_id: &'a str,
        output: Output<'a>,
    },
    Reasoning(Box<RawValue>),
}
#[derive(Serialize)]
#[serde(untagged)]
pub(super) enum Output<'a> {
    Text(String),
    Parts(Vec<Part<'a>>),
}
#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(super) enum Part<'a> {
    InputText {
        text: Cow<'a, str>,
    },
    InputImage {
        detail: &'static str,
        image_url: String,
    },
}

/// downgradeUnsupportedImages, then the input_text/input_image mapping.
fn parts<'a>(
    content: &'a [InputContent],
    vision: Option<bool>,
    marker: &'static str,
) -> Result<Vec<Part<'a>>, String> {
    let has_image = content
        .iter()
        .any(|c| matches!(c, InputContent::Image { .. }));
    if has_image && !vision.ok_or("images require explicit vision capability")? {
        return Ok(texts(content, marker)?
            .into_iter()
            .map(|text| Part::InputText { text: text.into() })
            .collect());
    }
    if content.len() > 4096 {
        return Err("history content exceeds 4096 blocks".into());
    }
    Ok(content
        .iter()
        .map(|c| match c {
            InputContent::Text { text } => Part::InputText { text: text.into() },
            InputContent::Image { data, mime_type } => Part::InputImage {
                detail: "auto",
                image_url: format!("data:{mime_type};base64,{data}"),
            },
        })
        .collect())
}
#[derive(Serialize)]
pub(super) struct OutputText<'a> {
    r#type: &'static str,
    text: &'a str,
    annotations: [(); 0],
}

/// parseTextSignature: `{v:1,id}` JSON with an optional known phase, else the raw string.
fn message_id(signature: Option<&str>) -> Result<(Option<String>, Option<&'static str>), String> {
    let Some(sig) = signature.filter(|s| !s.is_empty()) else {
        return Ok((None, None));
    };
    if !sig.starts_with('{') {
        return Ok((Some(sig.into()), None));
    }
    // JSON.parse also accepts lone surrogate escapes and overflowing numbers; refuse, never guess.
    let Ok(Value::Object(mut map)) = serde_json::from_str::<Value>(sig) else {
        return Err("text signature starting with `{` is not portable JSON".into());
    };
    let v1 = map.get("v").and_then(Value::as_f64) == Some(1.0);
    match map.remove("id") {
        Some(Value::String(id)) if v1 => {
            let phase = match map.get("phase").and_then(Value::as_str) {
                Some("commentary") => Some("commentary"),
                Some("final_answer") => Some("final_answer"),
                _ => None,
            };
            // An empty v1 id is falsy in Node and falls back to msg_omk_*.
            Ok(((!id.is_empty()).then_some(id), phase))
        }
        _ => Ok((Some(sig.into()), None)),
    }
}

pub(super) fn items<'a>(
    messages: &'a [Message],
    provider: &str,
    model: &str,
    reasoning: bool,
    vision: Option<bool>,
    system: &'a str,
) -> Result<Vec<Item<'a>>, String> {
    let mut items = Vec::new();
    if !system.is_empty() {
        let role = if reasoning { "developer" } else { "system" };
        items.push(Item::System {
            role,
            content: system,
        });
    }
    let mut index = 0usize;
    for turn in pair(messages) {
        let before = items.len();
        match turn {
            Turn::User(content) => {
                let content = match content {
                    Content::Text(s) => vec![Part::InputText { text: s.into() }],
                    Content::Parts(c) => parts(c, vision, USER_IMAGE)?,
                };
                if !content.is_empty() {
                    items.push(Item::User {
                        role: "user",
                        content,
                    });
                }
            }
            Turn::Assistant(blocks, source) => {
                let different =
                    source.model != model && source.provider == provider && source.api == API;
                let mut text_index = 0usize;
                for block in blocks {
                    match block {
                        Block::Thinking {
                            thinking,
                            signature,
                            ..
                        } => {
                            let Some(sig) = signature.as_deref().filter(|s| !s.is_empty()) else {
                                continue;
                            };
                            if !nonblank(thinking) {
                                continue;
                            }
                            let raw = serde_json::from_str::<&RawValue>(sig)
                                .map_err(|_| "Invalid OpenAI reasoning signature".to_string())?;
                            let item = arguments::stringify(raw)
                                .map_err(|e| format!("unsupported reasoning signature: {e}"))?;
                            items.push(Item::Reasoning(
                                RawValue::from_string(item).map_err(|e| e.to_string())?,
                            ));
                        }
                        Block::Text { text, signature } => {
                            let (id, phase) = message_id(signature.as_deref())?;
                            let id = match id {
                                Some(id) if id.encode_utf16().count() > 64 => {
                                    format!("msg_{}", short_hash(&id))
                                }
                                Some(id) => id,
                                None if text_index == 0 => format!("msg_omk_{index}"),
                                None => format!("msg_omk_{index}_{text_index}"),
                            };
                            text_index += 1;
                            items.push(Item::Message {
                                r#type: "message",
                                role: "assistant",
                                content: [OutputText {
                                    r#type: "output_text",
                                    text,
                                    annotations: [],
                                }],
                                status: "completed",
                                id,
                                phase,
                            });
                        }
                        Block::ToolCall {
                            id,
                            name,
                            arguments: args,
                        } => {
                            let mut parts = id.split('|');
                            let call_id = parts.next().unwrap_or_default();
                            let item = parts
                                .next()
                                .filter(|item| !(different && item.starts_with("fc_")));
                            items.push(Item::Call {
                                r#type: "function_call",
                                id: item,
                                call_id,
                                name,
                                arguments: arguments::stringify(args)?,
                            });
                        }
                    }
                }
            }
            Turn::Result(id, parts) => {
                let parts = parts
                    .map(|p| self::parts(p, vision, TOOL_IMAGE))
                    .transpose()?;
                let output = match parts {
                    None => Output::Text("No result provided".into()),
                    Some(parts) => {
                        let text = parts
                            .iter()
                            .filter_map(|p| match p {
                                Part::InputText { text } => Some(text.as_ref()),
                                Part::InputImage { .. } => None,
                            })
                            .collect::<Vec<_>>()
                            .join("\n");
                        // After the downgrade, remaining images imply a vision model.
                        let images: Vec<_> = parts
                            .into_iter()
                            .filter(|p| matches!(p, Part::InputImage { .. }))
                            .collect();
                        if !images.is_empty() {
                            let mut out = Vec::with_capacity(images.len() + 1);
                            if !text.is_empty() {
                                out.push(Part::InputText { text: text.into() });
                            }
                            out.extend(images);
                            Output::Parts(out)
                        } else if text.is_empty() {
                            Output::Text("(see attached image)".into())
                        } else {
                            Output::Text(text)
                        }
                    }
                };
                items.push(Item::Output {
                    r#type: "function_call_output",
                    call_id: id.split('|').next().unwrap_or_default(),
                    output,
                });
            }
        }
        // Node `continue`s past msgIndex++ when a user or assistant turn adds no items.
        if items.len() > before {
            index += 1;
        }
    }
    Ok(items)
}
