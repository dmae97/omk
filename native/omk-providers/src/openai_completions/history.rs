use super::{
    arguments::stringify,
    handoff::Block,
    pairing::{Turn, pair},
};
use crate::{
    request_content::{InputContent, TOOL_IMAGE, USER_IMAGE, texts},
    request_history::nonblank,
};
use serde::{Deserialize, Serialize};
use std::borrow::Cow;

#[derive(Deserialize)]
#[serde(untagged)]
pub(super) enum UserContent {
    String(String),
    Blocks(Vec<InputContent>),
}
#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Part<'a> {
    Text { text: Cow<'a, str> },
    ImageUrl { image_url: ImageUrl },
}
#[derive(Serialize)]
struct ImageUrl {
    url: String,
}
#[derive(Serialize)]
#[serde(untagged)]
enum Content<'a> {
    String(Cow<'a, str>),
    Parts(Vec<Part<'a>>),
    Null,
}
#[derive(Serialize)]
struct Call<'a> {
    id: &'a str,
    r#type: &'static str,
    function: Function<'a>,
}
#[derive(Serialize)]
struct Function<'a> {
    name: &'a str,
    arguments: String,
}
#[derive(Serialize)]
pub(super) struct WireMessage<'a> {
    role: &'static str,
    content: Content<'a>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning_content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    tool_calls: Vec<Call<'a>>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    reasoning_details: Vec<Box<serde_json::value::RawValue>>,
    // The SDK appends a missing required field after tool calls and reasoning details.
    #[serde(rename = "reasoning_content", skip_serializing_if = "Option::is_none")]
    required_reasoning_content: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_call_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<&'a str>,
}
impl<'a> WireMessage<'a> {
    fn new(role: &'static str, content: Content<'a>) -> Self {
        Self {
            role,
            content,
            reasoning: None,
            reasoning_content: None,
            reasoning_details: Vec::new(),
            required_reasoning_content: None,
            tool_calls: vec![],
            tool_call_id: None,
            name: None,
        }
    }
    fn text(role: &'static str, s: &'a str) -> Self {
        Self::new(role, Content::String(s.into()))
    }
}
fn parts<'a>(
    blocks: &'a [InputContent],
    vision: Option<bool>,
    marker: &'static str,
) -> Result<Vec<Part<'a>>, String> {
    if blocks
        .iter()
        .any(|b| matches!(b, InputContent::Image { .. }))
    {
        if blocks.len() > 4096 {
            return Err("image history exceeds 4096 blocks".into());
        }
        if !vision.ok_or("images require explicit vision capability")? {
            return Ok(texts(blocks, marker)?
                .into_iter()
                .map(|text| Part::Text { text: text.into() })
                .collect());
        }
    }
    Ok(blocks
        .iter()
        .map(|b| match b {
            InputContent::Text { text } => Part::Text {
                text: text.as_str().into(),
            },
            InputContent::Image { data, mime_type } => Part::ImageUrl {
                image_url: ImageUrl {
                    url: format!("data:{mime_type};base64,{data}"),
                },
            },
        })
        .collect())
}
const BRIDGE: &str = "I have processed the tool results.";
fn assistant<'a>(
    blocks: &'a [Block],
    input: &super::Request,
) -> Result<Option<WireMessage<'a>>, String> {
    let mut msg = WireMessage::new(
        "assistant",
        if input.compat.requires_assistant_after_tool_result {
            Content::String("".into())
        } else {
            Content::Null
        },
    );
    let mut texts = Vec::new();
    let mut thoughts = Vec::new();
    let mut field = None;
    for b in blocks {
        match b {
            Block::Text { text } => {
                if nonblank(text) {
                    texts.push(text.as_str());
                }
            }
            Block::ToolCall {
                id,
                name,
                arguments,
                signature,
            } => {
                if let Some(s) = signature
                    && let Some(d) = super::arguments::detail(s)?
                {
                    msg.reasoning_details.push(d);
                }
                msg.tool_calls.push(Call {
                    id,
                    r#type: "function",
                    function: Function {
                        name,
                        arguments: stringify(arguments)?,
                    },
                });
            }
            Block::Thinking {
                thinking,
                signature,
                ..
            } => {
                if nonblank(thinking) {
                    if thoughts.is_empty() {
                        field = signature.as_deref();
                    }
                    thoughts.push(thinking.as_str());
                }
            }
        }
    }
    if input.compat.requires_thinking_as_text && !thoughts.is_empty() {
        let mut parts = vec![Part::Text {
            text: thoughts.join("\n\n").into(),
        }];
        parts.extend(texts.into_iter().map(|s| Part::Text { text: s.into() }));
        msg.content = Content::Parts(parts);
    } else {
        match field {
            None | Some("") => {}
            Some("reasoning_content") => msg.reasoning_content = Some(thoughts.join("\n")),
            Some("reasoning") => msg.reasoning = Some(thoughts.join("\n")),
            Some(_) => return Err("unsupported thinking signature field".into()),
        }
        if !texts.is_empty() {
            msg.content = Content::String(texts.concat().into());
        } else if msg.tool_calls.is_empty() {
            return Ok(None);
        }
    }
    if input.reasoning
        && input
            .compat
            .requires_reasoning_content_on_assistant_messages
        && msg.reasoning_content.is_none()
    {
        msg.required_reasoning_content = Some("");
    }
    Ok(Some(msg))
}
pub(super) fn messages(input: &super::Request) -> Result<Vec<WireMessage<'_>>, String> {
    let mut wire = Vec::new();
    if !input.system.is_empty() || input.compat.requires_system_message_first {
        let role = if input.reasoning && input.compat.supports_developer_role {
            "developer"
        } else {
            "system"
        };
        wire.push(WireMessage::text(role, &input.system));
    }
    let bridge = input.compat.requires_assistant_after_tool_result;
    let mut after_result = false;
    let mut turns = pair(&input.messages).into_iter().peekable();
    while let Some(turn) = turns.next() {
        match turn {
            Turn::User(user) => {
                if after_result && bridge {
                    wire.push(WireMessage::text("assistant", BRIDGE));
                }
                let content = match user {
                    UserContent::String(s) => Content::String(s.as_str().into()),
                    UserContent::Blocks(b) if b.is_empty() => continue,
                    UserContent::Blocks(b) => Content::Parts(parts(b, input.vision, USER_IMAGE)?),
                };
                wire.push(WireMessage::new("user", content));
                after_result = false;
            }
            Turn::Assistant(blocks) => {
                if let Some(msg) = assistant(blocks, input)? {
                    wire.push(msg);
                    after_result = false;
                }
            }
            Turn::Result { .. } => {
                let mut images = Vec::new();
                let mut current = turn;
                while let Turn::Result { id, name, blocks } = current {
                    let mut text_parts = Vec::new();
                    if let Some(blocks) = blocks {
                        for part in parts(blocks, input.vision, TOOL_IMAGE)? {
                            match part {
                                Part::Text { text } => text_parts.push(text),
                                image => images.push(image),
                            }
                        }
                    } else {
                        text_parts.push("No result provided".into());
                    }
                    let joined = text_parts.join("\n");
                    let mut msg = WireMessage::new(
                        "tool",
                        Content::String(if joined.is_empty() {
                            "(see attached image)".into()
                        } else {
                            joined.into()
                        }),
                    );
                    msg.tool_call_id = Some(id);
                    msg.name = (input.compat.requires_tool_result_name && !name.is_empty())
                        .then_some(name);
                    wire.push(msg);
                    let Some(next) = turns.next_if(|t| matches!(t, Turn::Result { .. })) else {
                        break;
                    };
                    current = next;
                }
                after_result = images.is_empty();
                if !images.is_empty() {
                    if bridge {
                        wire.push(WireMessage::text("assistant", BRIDGE));
                    }
                    images.insert(
                        0,
                        Part::Text {
                            text: "Attached image(s) from tool result:".into(),
                        },
                    );
                    wire.push(WireMessage::new("user", Content::Parts(images)));
                }
            }
        }
    }
    Ok(wire)
}
