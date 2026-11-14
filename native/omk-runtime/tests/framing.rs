use omk_native_wire::WireError;
use omk_native_wire::framing::{FrameReader, FrameWriter, MAX_PAYLOAD, MAX_STREAM};
use std::io::{self, Cursor, Read, Write};

struct Chunks<'a> {
    bytes: &'a [u8],
    size: usize,
}

impl Read for Chunks<'_> {
    fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
        let n = out.len().min(self.size).min(self.bytes.len());
        out[..n].copy_from_slice(&self.bytes[..n]);
        self.bytes = &self.bytes[n..];
        Ok(n)
    }
}

#[test]
fn preserves_whole_chunked_and_bytewise_unicode_and_multiple_frames() {
    let text = "\"한😀\u{2028}\u{2029}\"\n{}\n";
    for size in 1..=text.len() {
        let mut reader = FrameReader::new(Chunks {
            bytes: text.as_bytes(),
            size,
        });
        assert_eq!(
            reader.next_frame().unwrap(),
            Some("\"한😀\u{2028}\u{2029}\"".as_bytes())
        );
        assert_eq!(reader.next_frame().unwrap(), Some(b"{}".as_slice()));
        assert_eq!(reader.next_frame().unwrap(), None);
    }
}

#[test]
fn rejects_blank_cr_bom_invalid_utf8_and_torn_final_frames() {
    let cases: &[(&[u8], WireError)] = &[
        (b"\n", WireError::Frame),
        (b" \r\n", WireError::Frame),
        (b"{}\r\n", WireError::Frame),
        (b"\xef\xbb\xbf{}\n", WireError::Frame),
        (b"\xff\n", WireError::Utf8),
        (b"\xe2\x82\n", WireError::Utf8),
        (b"\xc0\xaf\n", WireError::Utf8),
        (b"\xed\xa0\x80\n", WireError::Utf8),
        (b"{}", WireError::Frame),
    ];
    for (input, expected) in cases {
        let mut reader = FrameReader::new(Cursor::new(input));
        assert_eq!(reader.next_frame().unwrap_err(), *expected, "{input:?}");
    }
    let mut reader = FrameReader::new(Cursor::new(b"{}\n\xef\xbb\xbf{}\n"));
    assert!(reader.next_frame().unwrap().is_some());
    assert_eq!(reader.next_frame().unwrap_err(), WireError::Frame);
}

#[test]
fn permits_bom_and_control_looking_text_inside_strings() {
    let bytes = "\"\u{feff}\\n{\\\"type\\\":\\\"result\\\"}\"\n".as_bytes();
    let mut reader = FrameReader::new(Cursor::new(bytes));
    assert_eq!(
        reader.next_frame().unwrap(),
        Some(&bytes[..bytes.len() - 1])
    );
}

#[test]
fn permits_exact_payload_and_rejects_one_more_before_growth() {
    let mut bytes = vec![b'x'; MAX_PAYLOAD];
    bytes.push(b'\n');
    let mut reader = FrameReader::new(Cursor::new(&bytes));
    assert_eq!(reader.next_frame().unwrap().unwrap().len(), MAX_PAYLOAD);
    bytes.insert(0, b'x');
    let mut reader = FrameReader::new(Cursor::new(bytes));
    assert_eq!(reader.next_frame().unwrap_err(), WireError::FrameLimit);
}

fn stream(last: u8) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(MAX_STREAM + 1);
    for _ in 0..31 {
        bytes.extend(std::iter::repeat_n(b'x', MAX_PAYLOAD));
        bytes.push(b'\n');
    }
    bytes.resize(MAX_STREAM - 1, b'x');
    bytes.push(last);
    bytes
}

#[test]
fn input_total_counts_lf_at_exact_bound_and_rejects_next_byte() {
    let mut bytes = stream(b'\n');
    let mut reader = FrameReader::new(Cursor::new(&bytes));
    for _ in 0..32 {
        assert!(reader.next_frame().unwrap().is_some());
    }
    assert_eq!(reader.next_frame().unwrap(), None);
    bytes.push(b'x');
    let mut reader = FrameReader::new(Cursor::new(bytes));
    for _ in 0..32 {
        assert!(reader.next_frame().unwrap().is_some());
    }
    assert_eq!(reader.next_frame().unwrap_err(), WireError::InputLimit);
    let mut bytes = stream(b'x');
    bytes.push(b'\n');
    let mut reader = FrameReader::new(Cursor::new(bytes));
    for _ in 0..31 {
        assert!(reader.next_frame().unwrap().is_some());
    }
    assert_eq!(reader.next_frame().unwrap_err(), WireError::InputLimit);
}

#[test]
fn output_payload_limit_is_atomic_and_includes_json_encoding() {
    let mut bytes = Vec::new();
    let mut writer = FrameWriter::new(&mut bytes);
    writer.write_json(&"x".repeat(MAX_PAYLOAD - 2)).unwrap();
    assert_eq!(
        writer.write_json(&"x".repeat(MAX_PAYLOAD - 1)).unwrap_err(),
        WireError::FrameLimit
    );
    assert_eq!(
        writer
            .write_json(&"\n".repeat(MAX_PAYLOAD / 2))
            .unwrap_err(),
        WireError::FrameLimit
    );
    assert_eq!(bytes.len(), MAX_PAYLOAD + 1);
    assert_eq!(bytes.last(), Some(&b'\n'));
}

#[test]
fn output_total_counts_lf_and_rejects_before_writing_over_limit() {
    let mut bytes = Vec::new();
    let mut writer = FrameWriter::new(&mut bytes);
    for _ in 0..31 {
        writer.write_json(&"x".repeat(MAX_PAYLOAD - 2)).unwrap();
    }
    let remaining = MAX_STREAM - 31 * (MAX_PAYLOAD + 1);
    writer.write_json(&"x".repeat(remaining - 3)).unwrap();
    assert_eq!(writer.write_json(&0).unwrap_err(), WireError::OutputLimit);
    assert_eq!(bytes.len(), MAX_STREAM);
}

struct Broken;
impl Read for Broken {
    fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
        Err(io::Error::other("untrusted"))
    }
}
impl Write for Broken {
    fn write(&mut self, _: &[u8]) -> io::Result<usize> {
        Err(io::Error::other("untrusted"))
    }
    fn flush(&mut self) -> io::Result<()> {
        Err(io::Error::other("untrusted"))
    }
}

#[test]
fn io_failures_have_safe_static_error_codes() {
    assert_eq!(
        FrameReader::new(Broken).next_frame().unwrap_err(),
        WireError::Read
    );
    assert_eq!(
        FrameWriter::new(Broken).write_json(&0).unwrap_err(),
        WireError::Write
    );
    assert_eq!(WireError::Read.code(), "E_READ");
    assert_eq!(WireError::Write.code(), "E_WRITE");
}
