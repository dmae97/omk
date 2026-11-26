//! First offline Anthropic parity slice; not the full provider/auth surface.
pub use crate::anthropic_stream::{Replay, Stream};
pub use crate::request::{Input, build_request};
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
    // Vision has a request-only oracle; do not admit unrecorded response/cancellation replay.
    if model != "synthetic-anthropic"
        && (model != "synthetic-anthropic-vision" || !chunks.is_empty() || abort_after.is_some())
    {
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
    let mut stream = Stream::recorded(model, observe);
    if abort_after != Some(0) {
        for chunk in chunks.iter().take(abort_after.unwrap_or(chunks.len())) {
            if stream.feed(chunk).is_err() {
                break;
            }
        }
    }
    Ok(stream.finish(
        (abort_after == Some(0)).then(|| "Request was aborted".into()),
        abort_after.is_some(),
    ))
}
