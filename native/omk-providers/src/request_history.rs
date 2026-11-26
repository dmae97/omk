//! Tool pairing ported from packages/ai/src/providers/transform-messages.ts (MIT).
use crate::request_blocks::{
    BlockHistory, StopReason, ToolContent, WireBlock, blocks, tool_result,
};
use crate::request_cache::{Control, Text};
use crate::request_content::{InputContent, USER_IMAGE, convert};
use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;
use std::collections::HashSet;

#[derive(Deserialize)]
#[serde(try_from = "HistoryInput")]
pub(crate) enum HistoryMessage {
    User { text: String },
    UserBlocks { content: Vec<InputContent> },
    Assistant { text: String },
    Blocks(BlockHistory),
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
enum Role {
    User,
    Assistant,
    ToolResult,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HistoryInput {
    role: Role,
    text: Option<String>,
    content: Option<Box<RawValue>>,
    stop_reason: Option<StopReason>,
    tool_call_id: Option<String>,
    is_error: Option<bool>,
}
impl TryFrom<HistoryInput> for HistoryMessage {
    type Error = String;
    fn try_from(input: HistoryInput) -> Result<Self, Self::Error> {
        let HistoryInput {
            role,
            text,
            content,
            stop_reason,
            tool_call_id,
            is_error,
        } = input;
        match (role, text, content, stop_reason, tool_call_id, is_error) {
            (Role::User, Some(text), None, None, None, None) => Ok(Self::User { text }),
            (Role::User, None, Some(content), None, None, None) => Ok(Self::UserBlocks {
                content: serde_json::from_str(content.get()).map_err(|e| e.to_string())?,
            }),
            (Role::Assistant, Some(text), None, None, None, None) => Ok(Self::Assistant { text }),
            (Role::Assistant, None, Some(content), stop_reason, None, None) => {
                Ok(Self::Blocks(BlockHistory::Assistant {
                    content: serde_json::from_str(content.get()).map_err(|e| e.to_string())?,
                    stop_reason: stop_reason.unwrap_or_default(),
                }))
            }
            (Role::ToolResult, None, Some(content), None, Some(tool_call_id), Some(is_error)) => {
                Ok(Self::Blocks(BlockHistory::ToolResult {
                    tool_call_id,
                    content: serde_json::from_str(content.get()).map_err(|e| e.to_string())?,
                    is_error,
                }))
            }
            _ => Err("unsupported or ambiguous history message fields".into()),
        }
    }
}

#[derive(Serialize)]
struct CachedBlock<'a> {
    #[serde(flatten)]
    block: WireBlock<'a>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cache_control: Option<Control>,
}
#[derive(Serialize)]
#[serde(untagged)]
enum Content<'a> {
    Text(&'a str),
    Blocks(Vec<WireBlock<'a>>),
    CachedText(Vec<Text<'a>>),
    CachedBlocks(Vec<CachedBlock<'a>>),
}
#[derive(Serialize)]
pub(crate) struct Message<'a> {
    role: &'a str,
    content: Content<'a>,
}

// ECMAScript trim differs from Rust's whitespace set (U+0085 and U+FEFF).
pub(crate) fn blank(c: char) -> bool {
    matches!(c, '\u{0009}'..='\u{000d}' | ' ' | '\u{00a0}' | '\u{1680}'
        | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}'
        | '\u{205f}' | '\u{3000}' | '\u{feff}')
}
pub(crate) fn nonblank(text: &str) -> bool {
    text.chars().any(|c| !blank(c))
}

enum Turn<'a> {
    User(&'a str),
    UserBlocks(Vec<WireBlock<'a>>),
    Assistant(Vec<WireBlock<'a>>),
    ToolResult(WireBlock<'a>),
}
fn flush<'a>(
    pending: &mut Vec<&'a str>,
    provided: &mut HashSet<&'a str>,
    turns: &mut Vec<Turn<'a>>,
) {
    for id in pending.drain(..) {
        if !provided.contains(id) {
            turns.push(Turn::ToolResult(WireBlock::ToolResult {
                tool_use_id: id,
                content: ToolContent::Text("No result provided".into()),
                is_error: true,
            }));
        }
    }
    provided.clear();
}

pub(crate) fn messages<'a>(
    history: &'a [HistoryMessage],
    user: &'a str,
    vision: bool,
    cache: Option<Control>,
    allow_empty_signature: bool,
) -> Result<Vec<Message<'a>>, String> {
    if history.len() > 4096 {
        return Err("history exceeds 4096 messages".into());
    }
    let (mut pending, mut provided, mut live, mut turns) =
        (Vec::new(), HashSet::new(), HashSet::new(), Vec::new());
    for message in history {
        match message {
            HistoryMessage::UserBlocks { content } => {
                flush(&mut pending, &mut provided, &mut turns);
                let content = convert(content, vision, USER_IMAGE)?
                    .into_iter()
                    .filter(|block| !matches!(block, WireBlock::Text { text } if !nonblank(text)))
                    .collect();
                turns.push(Turn::UserBlocks(content));
            }
            HistoryMessage::User { text } => {
                flush(&mut pending, &mut provided, &mut turns);
                turns.push(Turn::User(text));
            }
            HistoryMessage::Assistant { text } => {
                flush(&mut pending, &mut provided, &mut turns);
                turns.push(Turn::Assistant(if nonblank(text) {
                    vec![WireBlock::Text { text: text.into() }]
                } else {
                    vec![]
                }));
            }
            HistoryMessage::Blocks(BlockHistory::Assistant {
                content,
                stop_reason,
            }) => {
                let content = blocks(content, allow_empty_signature)?;
                flush(&mut pending, &mut provided, &mut turns);
                if matches!(stop_reason, StopReason::Error | StopReason::Aborted) {
                    continue;
                }
                for block in &content {
                    if let WireBlock::ToolUse { id, .. } = block {
                        pending.push(*id);
                        if !id.is_empty() {
                            live.insert(*id);
                        }
                    }
                }
                turns.push(Turn::Assistant(content));
            }
            HistoryMessage::Blocks(BlockHistory::ToolResult {
                tool_call_id,
                content,
                is_error,
            }) => {
                let id = tool_call_id.trim_matches(blank);
                let block = tool_result(id, content, *is_error, vision)?;
                if id.is_empty() || !live.contains(id) {
                    continue;
                }
                provided.insert(id);
                turns.push(Turn::ToolResult(block));
            }
        }
    }
    flush(&mut pending, &mut provided, &mut turns);
    turns.push(Turn::User(user));
    let mut turns = turns.into_iter().peekable();
    let mut result = Vec::new();
    while let Some(turn) = turns.next() {
        match turn {
            Turn::UserBlocks(content) if !content.is_empty() => result.push(Message {
                role: "user",
                content: Content::Blocks(content),
            }),
            Turn::User(text) if nonblank(text) => result.push(Message {
                role: "user",
                content: Content::Text(text),
            }),
            Turn::Assistant(content) if !content.is_empty() => result.push(Message {
                role: "assistant",
                content: Content::Blocks(content),
            }),
            Turn::ToolResult(block) => {
                let mut content = vec![block];
                while matches!(turns.peek(), Some(Turn::ToolResult(_))) {
                    if let Some(Turn::ToolResult(block)) = turns.next() {
                        content.push(block);
                    }
                }
                result.push(Message {
                    role: "user",
                    content: Content::Blocks(content),
                });
            }
            Turn::User(_) | Turn::UserBlocks(_) | Turn::Assistant(_) => {}
        }
    }
    if let Some(cache) = cache
        && let Some(last) = result.last_mut().filter(|message| message.role == "user")
    {
        last.content = match std::mem::replace(&mut last.content, Content::Text("")) {
            Content::Text(text) => Content::CachedText(vec![Text {
                r#type: "text",
                text: text.into(),
                cache_control: Some(cache),
            }]),
            Content::Blocks(blocks) => {
                let len = blocks.len();
                Content::CachedBlocks(
                    blocks
                        .into_iter()
                        .enumerate()
                        .map(|(index, block)| CachedBlock {
                            block,
                            cache_control: (index + 1 == len).then_some(cache),
                        })
                        .collect(),
                )
            }
            other => other,
        };
    }
    Ok(result)
}
