//! Same-model request blocks ported from packages/ai/src/providers/anthropic.ts (MIT).
use crate::request_content::{InputContent, TOOL_IMAGE, convert};
use crate::{json_parse::parse_json_with_repair, request::compact_raw, request_history::nonblank};
use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;
use std::borrow::Cow;

#[derive(Serialize)]
#[serde(untagged)]
pub(crate) enum ToolContent<'a> {
    Text(String),
    Blocks(Vec<WireBlock<'a>>),
}
#[derive(Serialize)]
pub(crate) struct ImageSource<'a> {
    pub r#type: &'static str,
    pub media_type: &'a str,
    pub data: &'a str,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum StopReason {
    #[default]
    Stop,
    Length,
    ToolUse,
    Error,
    Aborted,
}

#[derive(Deserialize)]
#[serde(try_from = "BlockInput")]
pub(crate) enum Block {
    Text {
        text: String,
    },
    Thinking {
        thinking: String,
        thinking_signature: Option<String>,
        redacted: bool,
    },
    ToolCall {
        id: String,
        name: String,
        arguments: Box<RawValue>,
    },
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
enum Kind {
    Text,
    Thinking,
    ToolCall,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BlockInput {
    r#type: Kind,
    text: Option<String>,
    thinking: Option<String>,
    thinking_signature: Option<String>,
    redacted: Option<bool>,
    id: Option<String>,
    name: Option<String>,
    arguments: Option<Box<RawValue>>,
}
impl TryFrom<BlockInput> for Block {
    type Error = &'static str;
    fn try_from(input: BlockInput) -> Result<Self, Self::Error> {
        match input {
            BlockInput {
                r#type: Kind::Text,
                text: Some(text),
                thinking: None,
                thinking_signature: None,
                redacted: None,
                id: None,
                name: None,
                arguments: None,
            } => Ok(Self::Text { text }),
            BlockInput {
                r#type: Kind::Thinking,
                text: None,
                thinking: Some(thinking),
                thinking_signature,
                redacted,
                id: None,
                name: None,
                arguments: None,
            } => {
                let redacted = redacted.unwrap_or(false);
                if redacted && thinking_signature.is_none() {
                    return Err("redacted thinking requires a signature");
                }
                Ok(Self::Thinking {
                    thinking,
                    thinking_signature,
                    redacted,
                })
            }
            BlockInput {
                r#type: Kind::ToolCall,
                text: None,
                thinking: None,
                thinking_signature: None,
                redacted: None,
                id: Some(id),
                name: Some(name),
                arguments: Some(arguments),
            } => Ok(Self::ToolCall {
                id,
                name,
                arguments,
            }),
            _ => Err("unsupported or ambiguous history block fields"),
        }
    }
}

pub(crate) enum BlockHistory {
    Assistant {
        content: Vec<Block>,
        stop_reason: StopReason,
    },
    ToolResult {
        tool_call_id: String,
        content: Vec<InputContent>,
        is_error: bool,
    },
}
#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(crate) enum WireBlock<'a> {
    Text {
        text: Cow<'a, str>,
    },
    Image {
        source: ImageSource<'a>,
    },
    Thinking {
        thinking: &'a str,
        signature: &'a str,
    },
    RedactedThinking {
        data: &'a str,
    },
    ToolUse {
        id: &'a str,
        name: &'a str,
        #[serde(serialize_with = "compact_raw")]
        input: &'a RawValue,
    },
    ToolResult {
        tool_use_id: &'a str,
        content: ToolContent<'a>,
        is_error: bool,
    },
}

pub(crate) fn blocks(
    content: &[Block],
    allow_empty_signature: bool,
) -> Result<Vec<WireBlock<'_>>, String> {
    if content.len() > 4096 {
        return Err("history content exceeds 4096 blocks".into());
    }
    let mut result = Vec::new();
    for block in content {
        match block {
            Block::Text { text } if nonblank(text) => {
                result.push(WireBlock::Text { text: text.into() })
            }
            Block::Thinking {
                thinking_signature,
                redacted: true,
                ..
            } => {
                let data = thinking_signature
                    .as_deref()
                    .ok_or("redacted thinking requires a signature")?;
                result.push(WireBlock::RedactedThinking { data });
            }
            Block::Thinking {
                thinking,
                thinking_signature,
                ..
            } if nonblank(thinking) => {
                result.push(
                    match thinking_signature.as_deref().filter(|s| nonblank(s)) {
                        Some(signature) => WireBlock::Thinking {
                            thinking,
                            signature,
                        },
                        None if allow_empty_signature => WireBlock::Thinking {
                            thinking,
                            signature: "",
                        },
                        None => WireBlock::Text {
                            text: thinking.into(),
                        },
                    },
                );
            }
            Block::ToolCall {
                id,
                name,
                arguments,
            } => {
                // Preserve recorded Node key order; raw JSON lexical parity is corpus-bounded.
                parse_json_with_repair(arguments.get()).map_err(|e| e.to_string())?;
                result.push(WireBlock::ToolUse {
                    id,
                    name,
                    input: arguments,
                });
            }
            Block::Text { .. } | Block::Thinking { .. } => {}
        }
    }
    Ok(result)
}

pub(crate) fn tool_result<'a>(
    id: &'a str,
    content: &'a [InputContent],
    is_error: bool,
    vision: bool,
) -> Result<WireBlock<'a>, String> {
    let mut blocks = convert(content, vision, TOOL_IMAGE)?;
    let content = if blocks
        .iter()
        .any(|block| matches!(block, WireBlock::Image { .. }))
    {
        if !blocks
            .iter()
            .any(|block| matches!(block, WireBlock::Text { .. }))
        {
            blocks.insert(
                0,
                WireBlock::Text {
                    text: "(see attached image)".into(),
                },
            );
        }
        ToolContent::Blocks(blocks)
    } else {
        ToolContent::Text(
            blocks
                .iter()
                .filter_map(|block| match block {
                    WireBlock::Text { text } => Some(text.as_ref()),
                    _ => None,
                })
                .collect::<Vec<_>>()
                .join("\n"),
        )
    };
    Ok(WireBlock::ToolResult {
        tool_use_id: id,
        content,
        is_error,
    })
}
