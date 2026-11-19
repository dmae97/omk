use crate::{GraphError, GraphView, MAX_FRAME_BYTES, Update};
use std::io::{BufRead, Read, Write};

#[derive(Debug)]
pub enum StreamError {
    Input,
    Output,
    Observation(GraphError),
}

/// One retained view, one reusable bounded input frame, and no output queue.
/// The caller owns deadlines/cancellation for blocking readers and writers.
pub fn consume_stream(
    reader: &mut impl BufRead,
    writer: &mut impl Write,
) -> Result<GraphView, StreamError> {
    let mut view = GraphView::default();
    let mut frame = Vec::new();
    loop {
        frame.clear();
        let read = reader
            .by_ref()
            .take((MAX_FRAME_BYTES + 1) as u64)
            .read_until(b'\n', &mut frame)
            .map_err(|_| StreamError::Input)?;
        if read == 0 {
            return if view.current().is_some() {
                Ok(view)
            } else {
                Err(StreamError::Observation(GraphError::Frame))
            };
        }
        if view.apply(&frame).map_err(StreamError::Observation)? == Update::Installed {
            let current = view
                .current()
                .ok_or(StreamError::Observation(GraphError::Frame))?;
            serde_json::to_writer(&mut *writer, current).map_err(|_| StreamError::Output)?;
            writer.write_all(b"\n").map_err(|_| StreamError::Output)?;
            writer.flush().map_err(|_| StreamError::Output)?;
        }
    }
}
