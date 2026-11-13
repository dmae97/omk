/// Mirrors the Node decoder, including immediate CR consumption at a chunk boundary.
#[derive(Default)]
pub(crate) struct Decoder {
    buffer: Vec<u8>,
    event: Option<String>,
    data: Vec<String>,
    raw: Vec<String>,
}
pub(crate) struct Frame {
    pub event: String,
    pub data: String,
    pub raw: Vec<String>,
}
impl Decoder {
    pub fn feed(&mut self, bytes: &[u8], eof: bool) -> Result<Vec<Frame>, String> {
        if self.buffer.len().saturating_add(bytes.len()) > 1024 * 1024 {
            return Err("SSE buffer exceeds 1 MiB".into());
        }
        self.buffer.extend_from_slice(bytes);
        let mut frames = Vec::new();
        while let Some(index) = self.buffer.iter().position(|b| *b == b'\r' || *b == b'\n') {
            let end = index
                + if self.buffer[index] == b'\r' && self.buffer.get(index + 1) == Some(&b'\n') {
                    2
                } else {
                    1
                };
            let line = String::from_utf8_lossy(&self.buffer[..index]).into_owned();
            self.buffer.drain(..end);
            if let Some(frame) = self.line(line)? {
                frames.push(frame);
            }
        }
        if eof {
            if !self.buffer.is_empty() {
                let line = String::from_utf8_lossy(&self.buffer).into_owned();
                self.buffer.clear();
                if let Some(frame) = self.line(line)? {
                    frames.push(frame);
                }
            }
            if let Some(frame) = self.flush() {
                frames.push(frame);
            }
        }
        Ok(frames)
    }
    fn line(&mut self, line: String) -> Result<Option<Frame>, String> {
        if line.is_empty() {
            return Ok(self.flush());
        }
        if self.raw.iter().map(String::len).sum::<usize>() + line.len() > 1024 * 1024 {
            return Err("SSE event exceeds 1 MiB".into());
        }
        self.raw.push(line.clone());
        if line.starts_with(':') {
            return Ok(None);
        }
        let (field, value) = line.split_once(':').unwrap_or((&line, ""));
        let value = value.strip_prefix(' ').unwrap_or(value);
        match field {
            "event" => self.event = Some(value.into()),
            "data" => self.data.push(value.into()),
            _ => {}
        }
        Ok(None)
    }
    fn flush(&mut self) -> Option<Frame> {
        if self.event.is_none() && self.data.is_empty() {
            return None;
        }
        Some(Frame {
            event: self.event.take().unwrap_or_default(),
            data: std::mem::take(&mut self.data).join("\n"),
            raw: std::mem::take(&mut self.raw),
        })
    }
}
