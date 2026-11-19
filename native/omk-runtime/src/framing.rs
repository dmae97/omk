use crate::WireError;
use serde::Serialize;
use std::io::{self, BufReader, Read, Write};

pub const MAX_PAYLOAD: usize = 262_144;
pub const MAX_STREAM: usize = 8_388_608;

pub struct FrameReader<R> {
    reader: BufReader<R>,
    payload: Vec<u8>,
    total: usize,
}

impl<R: Read> FrameReader<R> {
    pub fn new(reader: R) -> Self {
        Self {
            reader: BufReader::with_capacity(8192, reader),
            payload: Vec::with_capacity(MAX_PAYLOAD),
            total: 0,
        }
    }

    pub fn next_frame(&mut self) -> Result<Option<&[u8]>, WireError> {
        self.payload.clear();
        let mut byte = [0];
        loop {
            match self.reader.read(&mut byte) {
                Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                Err(_) => return Err(WireError::Read),
                Ok(0) if self.payload.is_empty() => return Ok(None),
                Ok(0) => return Err(WireError::Frame),
                Ok(_) => {}
            }
            if self.total == MAX_STREAM {
                return Err(WireError::InputLimit);
            }
            self.total += 1;
            match byte[0] {
                b'\r' => return Err(WireError::Frame),
                b'\n' => {
                    if self.payload.is_empty() || self.payload.starts_with(b"\xef\xbb\xbf") {
                        return Err(WireError::Frame);
                    }
                    std::str::from_utf8(&self.payload).map_err(|_| WireError::Utf8)?;
                    return Ok(Some(&self.payload));
                }
                _ => {
                    if self.payload.len() == MAX_PAYLOAD {
                        return Err(WireError::FrameLimit);
                    }
                    self.payload.push(byte[0]);
                }
            }
        }
    }
}

struct Payload {
    bytes: Vec<u8>,
    overflowed: bool,
}

impl Write for Payload {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if bytes.len() > MAX_PAYLOAD - self.bytes.len() {
            self.overflowed = true;
            return Err(io::Error::other("E_FRAME_LIMIT"));
        }
        self.bytes.extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

pub struct FrameWriter<W> {
    writer: W,
    total: usize,
}

impl<W: Write> FrameWriter<W> {
    pub fn new(writer: W) -> Self {
        Self { writer, total: 0 }
    }

    pub fn write_json<T: Serialize>(&mut self, value: &T) -> Result<(), WireError> {
        let mut payload = Payload {
            bytes: Vec::with_capacity(MAX_PAYLOAD),
            overflowed: false,
        };
        let encoded = serde_json::to_writer(&mut payload, value);
        if payload.overflowed {
            return Err(WireError::FrameLimit);
        }
        encoded.map_err(|_| WireError::Schema)?;
        let size = payload.bytes.len() + 1;
        if size > MAX_STREAM - self.total {
            return Err(WireError::OutputLimit);
        }
        self.writer
            .write_all(&payload.bytes)
            .map_err(|_| WireError::Write)?;
        self.writer.write_all(b"\n").map_err(|_| WireError::Write)?;
        self.writer.flush().map_err(|_| WireError::Write)?;
        self.total += size;
        Ok(())
    }
}
