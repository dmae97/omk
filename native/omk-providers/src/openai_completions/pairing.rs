//! Same-model transformMessages: flush pending calls at turn boundaries, retain live IDs.
use super::handoff::{Block, Source};
use super::history::UserContent;
use crate::{request_blocks::StopReason, request_content::InputContent, request_history::blank};
use serde::Deserialize;
use serde_json::value::RawValue;
use std::collections::HashSet;

#[derive(Deserialize)]
#[serde(try_from = "Fields")]
pub(super) enum Message {
    User(UserContent),
    Assistant(Vec<Block>, StopReason, Option<Source>),
    Result(String, String, Vec<InputContent>),
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fields {
    role: String,
    content: Box<RawValue>,
    source: Option<Source>,
    stop_reason: Option<StopReason>,
    tool_call_id: Option<String>,
    tool_name: Option<String>,
    is_error: Option<bool>,
}
impl TryFrom<Fields> for Message {
    type Error = String;
    fn try_from(f: Fields) -> Result<Self, String> {
        if f.role != "assistant" && f.source.is_some() {
            return Err("only assistants carry source identity".into());
        }
        let raw = f.content.get();
        let err = |e: serde_json::Error| e.to_string();
        match (
            f.role.as_str(),
            f.stop_reason,
            f.tool_call_id,
            f.tool_name,
            f.is_error,
        ) {
            ("user", None, None, None, None) => {
                Ok(Self::User(serde_json::from_str(raw).map_err(err)?))
            }
            ("assistant", stop, None, None, None) => {
                let blocks: Vec<Block> = serde_json::from_str(raw).map_err(err)?;
                Ok(Self::Assistant(blocks, stop.unwrap_or_default(), f.source))
            }
            ("toolResult", None, Some(id), name, _) => Ok(Self::Result(
                id,
                name.unwrap_or_default(),
                serde_json::from_str(raw).map_err(err)?,
            )),
            _ => Err("unsupported history fields".into()),
        }
    }
}
impl Message {
    pub(super) fn has_tools(&self) -> bool {
        match self {
            Self::Result(..) => true,
            Self::Assistant(blocks, ..) => {
                blocks.iter().any(|b| matches!(b, Block::ToolCall { .. }))
            }
            Self::User(_) => false,
        }
    }
}
pub(super) enum Turn<'a> {
    User(&'a UserContent),
    Assistant(&'a [Block]),
    Result {
        id: &'a str,
        name: &'a str,
        blocks: Option<&'a [InputContent]>,
    },
}
pub(super) fn pair(messages: &[Message]) -> Vec<Turn<'_>> {
    let mut out = Vec::new();
    let mut live = HashSet::new();
    let mut pending = Vec::new();
    let mut provided = HashSet::new();
    for message in messages.iter().map(Some).chain(std::iter::once(None)) {
        if !matches!(message, Some(Message::Result(..))) {
            for (id, name) in pending.drain(..) {
                if !provided.contains(id) {
                    out.push(Turn::Result {
                        id,
                        name,
                        blocks: None,
                    });
                }
            }
            provided.clear();
        }
        match message {
            None => break,
            Some(Message::User(user)) => out.push(Turn::User(user)),
            Some(Message::Assistant(_, StopReason::Error | StopReason::Aborted, _)) => {}
            Some(Message::Assistant(blocks, ..)) => {
                for b in blocks {
                    if let Block::ToolCall { id, name, .. } = b {
                        pending.push((id.as_str(), name.as_str()));
                        if !id.is_empty() {
                            live.insert(id.as_str());
                        }
                    }
                }
                out.push(Turn::Assistant(blocks));
            }
            Some(Message::Result(id, name, blocks)) => {
                let id = id.trim_matches(blank);
                if live.contains(id) {
                    provided.insert(id);
                    out.push(Turn::Result {
                        id,
                        name,
                        blocks: Some(blocks),
                    });
                }
            }
        }
    }
    out
}
