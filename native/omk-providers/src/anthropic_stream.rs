// Incremental ownership of the existing Node-derived Anthropic decoder/reducer.
use crate::{
    json_parse::parse_sse_with_repair,
    reducer::Reducer,
    sse::{Decoder, Frame},
};
use serde_json::{Value, json};

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
pub struct Replay {
    pub events: Value,
    pub result: Value,
    pub tool_arguments: Value,
}
/// Incremental semantic events for the recorded text model, without retaining wire chunks.
/// This projection excludes mutable partial snapshots, timestamps and cost.
pub struct Stream {
    reducer: Reducer,
    decoder: Decoder,
    bytes: usize,
    failure: Option<String>,
}
impl Stream {
    pub fn new(model: &str) -> Result<Self, String> {
        if model != "synthetic-anthropic" {
            return Err("unrecorded model".into());
        }
        Ok(Self::recorded(model, false))
    }
    pub(crate) fn recorded(model: &str, observe: bool) -> Self {
        Self {
            reducer: Reducer::new(model, observe),
            decoder: Decoder::default(),
            bytes: 0,
            failure: None,
        }
    }
    /// Failure is latched; drain prior events even when this call fails.
    pub fn feed(&mut self, bytes: &[u8]) -> Result<(), String> {
        if let Some(error) = &self.failure {
            return Err(error.clone());
        }
        let outcome = (|| {
            self.bytes = self
                .bytes
                .checked_add(bytes.len())
                .filter(|n| *n <= 8 * 1024 * 1024)
                .ok_or("stream exceeds 8 MiB")?;
            self.decode(bytes, false)
        })();
        if let Err(error) = &outcome {
            self.failure = Some(error.clone());
        }
        outcome
    }
    fn decode(&mut self, bytes: &[u8], eof: bool) -> Result<(), String> {
        for frame in self.decoder.feed(bytes, eof)? {
            consume(&mut self.reducer, frame)?;
        }
        Ok(())
    }
    /// Move queued events out exactly once. Call after construction and each feed.
    pub fn take_events(&mut self) -> Vec<Value> {
        std::mem::take(&mut self.reducer.events)
    }
    /// Consumes the stream, appending exactly one terminal event to undrained events.
    pub fn finish(mut self, error: Option<String>, aborted: bool) -> Replay {
        self.failure = self.failure.or(error);
        if self.failure.is_none() {
            self.failure = self.decode(&[], true).err();
        }
        if self.failure.is_none() && aborted && !(self.reducer.started && !self.reducer.stopped) {
            self.failure = Some("Request was aborted".into());
        }
        let tool_arguments = json!(std::mem::take(&mut self.reducer.tool_arguments));
        let (events, result) = self.reducer.finish(self.failure, aborted);
        Replay {
            events,
            result,
            tool_arguments,
        }
    }
}
