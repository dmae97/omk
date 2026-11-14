//! First offline Anthropic parity slice; not the full provider/auth surface.
use crate::json_parse::parse_sse_with_repair;
pub use crate::request::{Input, build_request};
use crate::{
    reducer::Reducer,
    sse::{Decoder, Frame},
};
use serde_json::{Value, json};

pub struct Replay {
    pub events: Value,
    pub result: Value,
    pub tool_arguments: Value,
}
fn consume(reducer: &mut Reducer, frame: Frame) -> Result<(), String> {
    if frame.event == "error" {
        return Err(frame.data);
    }
    if ![
        "message_start",
        "message_delta",
        "message_stop",
        "content_block_start",
        "content_block_delta",
        "content_block_stop",
    ]
    .contains(&frame.event.as_str())
    {
        return Ok(());
    }
    let event = parse_sse_with_repair(&frame.data).map_err(|error| {
        let detail = error.to_string();
        format!(
            "Could not parse Anthropic SSE event {}: {}; data={}; raw={}",
            frame.event,
            detail,
            frame.data,
            frame.raw.join("\\n")
        )
    })?;
    reducer.apply(event)
}

pub fn replay(
    model: &str,
    chunks: &[Vec<u8>],
    abort_after: Option<usize>,
) -> Result<Replay, String> {
    replay_internal(model, chunks, abort_after, false)
}

/// Opt-in, bounded intermediate argument observations for offline conformance.
pub fn replay_with_tool_arguments(
    model: &str,
    chunks: &[Vec<u8>],
    abort_after: Option<usize>,
) -> Result<Replay, String> {
    replay_internal(model, chunks, abort_after, true)
}

fn replay_internal(
    model: &str,
    chunks: &[Vec<u8>],
    abort_after: Option<usize>,
    observe: bool,
) -> Result<Replay, String> {
    if model != "synthetic-anthropic" {
        return Err("unrecorded model".into());
    }
    if chunks
        .iter()
        .try_fold(0usize, |sum, chunk| sum.checked_add(chunk.len()))
        .is_none_or(|n| n > 8 * 1024 * 1024)
    {
        return Err("replay exceeds 8 MiB".into());
    }
    if abort_after.is_some_and(|n| n > chunks.len()) {
        return Err("invalid cancellation boundary".into());
    }
    let mut reducer = Reducer::new(model, observe);
    let mut decoder = Decoder::default();
    let outcome = (|| {
        if abort_after == Some(0) {
            return Err("Request was aborted".into());
        }
        for (index, chunk) in chunks.iter().enumerate() {
            if abort_after == Some(index) {
                break;
            }
            for frame in decoder.feed(chunk, false)? {
                consume(&mut reducer, frame)?;
            }
        }
        for frame in decoder.feed(&[], true)? {
            consume(&mut reducer, frame)?;
        }
        if abort_after.is_some() && !(reducer.started && !reducer.stopped) {
            return Err("Request was aborted".into());
        }
        Ok(())
    })();
    let tool_arguments = json!(std::mem::take(&mut reducer.tool_arguments));
    let (events, result) = reducer.finish(outcome.err(), abort_after.is_some());
    Ok(Replay {
        events,
        result,
        tool_arguments,
    })
}
