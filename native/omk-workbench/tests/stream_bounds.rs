use omk_workbench_wire::{GraphError, MAX_FRAME_BYTES, StreamError, consume_stream};
use serde_json::{Value, json};
use std::io::{self, BufReader, Cursor, Read, Write};

fn frame(revision: u64) -> Vec<u8> {
    let mut bytes = serde_json::to_vec(&json!({
        "schemaVersion": "omk.run-graph.v1", "runtime": "node", "graphKind": "verified-run",
        "executionRequested": false, "capabilities": {"execute": false, "amendGraph": false},
        "runId": "bounded",
        "cursor": {"revision": revision, "generation": 1,
            "authorityRevision": 0, "authorityDigest": "0".repeat(64),
            "journalDigest": format!("{revision:064x}"), "contractDigest": "b".repeat(64),
            "candidateDigest": null, "receiptDigest": null, "environmentDigest": null},
        "state": {"execution": "ready", "settlement": "open", "verification": "not_requested",
            "application": "not_requested", "publication": "none"},
        "proofVerdict": "inconclusive", "nodes": [], "edges": []
    }))
    .unwrap();
    bytes.push(b'\n');
    bytes
}

#[test]
fn refuses_empty_unterminated_and_oversize_frames_without_drain() {
    for input in [
        vec![],
        b"\n".to_vec(),
        frame(1)[..frame(1).len() - 1].to_vec(),
        vec![b'x'; MAX_FRAME_BYTES * 4],
    ] {
        let mut reader = Cursor::new(input);
        assert!(matches!(
            consume_stream(&mut reader, &mut io::sink()),
            Err(StreamError::Observation(GraphError::Frame))
        ));
        assert!(reader.position() <= (MAX_FRAME_BYTES + 1) as u64);
    }
    let mut endless = BufReader::with_capacity(8192, io::repeat(b'x'));
    assert!(matches!(
        consume_stream(&mut endless, &mut io::sink()),
        Err(StreamError::Observation(GraphError::Frame))
    ));
}

#[test]
fn accepts_the_exact_payload_limit() {
    let original = frame(1);
    let mut input = vec![b' '; MAX_FRAME_BYTES + 1 - original.len()];
    input.extend(&original);
    let mut output = Vec::new();
    consume_stream(&mut Cursor::new(input), &mut output).unwrap();
    assert_eq!(
        serde_json::from_slice::<Value>(&output).unwrap(),
        serde_json::from_slice::<Value>(&original).unwrap()
    );
}

#[test]
fn authority_only_updates_are_not_coalesced_away() {
    let initial = frame(1);
    let mut next: Value = serde_json::from_slice(&initial).unwrap();
    next["cursor"]["authorityRevision"] = json!(1);
    next["cursor"]["authorityDigest"] = json!("e".repeat(64));
    next["proofVerdict"] = json!("verified");
    let mut input = initial;
    input.extend(serde_json::to_vec(&next).unwrap());
    input.push(b'\n');
    let mut output = Vec::new();
    consume_stream(&mut Cursor::new(input), &mut output).unwrap();
    let text = String::from_utf8(output).unwrap();
    let rows: Vec<Value> = text
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[1], next);
}

#[test]
fn conflict_stops_the_stream_without_emitting_the_conflicting_snapshot() {
    let initial = frame(1);
    let mut conflict: Value = serde_json::from_slice(&initial).unwrap();
    conflict["proofVerdict"] = json!("verified");
    let mut input = initial;
    input.extend(serde_json::to_vec(&conflict).unwrap());
    input.push(b'\n');
    input.extend(frame(2));
    let mut output = Vec::new();
    assert!(matches!(
        consume_stream(&mut Cursor::new(input), &mut output),
        Err(StreamError::Observation(GraphError::Conflict))
    ));
    assert_eq!(output.iter().filter(|b| **b == b'\n').count(), 1);
}

struct RefusingWriter {
    fail_flush: bool,
}
impl Write for RefusingWriter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if self.fail_flush {
            Ok(bytes.len())
        } else {
            Err(io::Error::other("output unavailable"))
        }
    }
    fn flush(&mut self) -> io::Result<()> {
        Err(io::Error::other("flush unavailable"))
    }
}
#[test]
fn write_or_flush_failure_stops_before_reading_the_next_frame() {
    for fail_flush in [false, true] {
        let initial = frame(1);
        let mut reader = Cursor::new([initial.clone(), frame(2)].concat());
        assert!(matches!(
            consume_stream(&mut reader, &mut RefusingWriter { fail_flush }),
            Err(StreamError::Output)
        ));
        assert_eq!(reader.position(), initial.len() as u64);
    }
}

struct FailedRead;
impl Read for FailedRead {
    fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
        Err(io::Error::other("input unavailable"))
    }
}
#[test]
fn read_errors_remain_errors() {
    assert!(matches!(
        consume_stream(&mut BufReader::new(FailedRead), &mut io::sink()),
        Err(StreamError::Input)
    ));
}

#[derive(Default)]
struct CountingWriter {
    bytes: usize,
    flushes: usize,
}
impl Write for CountingWriter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.bytes += bytes.len();
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        self.flushes += 1;
        Ok(())
    }
}
#[test]
fn consumes_many_frames_lazily_and_retains_only_the_latest_view() {
    let frames = (1..=2000).map(|revision| Ok(Cursor::new(frame(revision))));
    // Flatten bytes lazily rather than constructing a whole input transcript.
    let mut reader = BufReader::new(LazyFrames {
        frames,
        current: Cursor::new(Vec::new()),
    });
    let mut writer = CountingWriter::default();
    let view = consume_stream(&mut reader, &mut writer).unwrap();
    assert_eq!(
        serde_json::to_value(view.current().unwrap()).unwrap()["cursor"]["revision"],
        2000
    );
    assert_eq!(writer.flushes, 2000);
    assert!(writer.bytes > MAX_FRAME_BYTES);
}

struct LazyFrames<I> {
    frames: I,
    current: Cursor<Vec<u8>>,
}
impl<I: Iterator<Item = io::Result<Cursor<Vec<u8>>>>> Read for LazyFrames<I> {
    fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
        loop {
            let read = self.current.read(bytes)?;
            if read > 0 {
                return Ok(read);
            }
            match self.frames.next() {
                Some(next) => self.current = next?,
                None => return Ok(0),
            }
        }
    }
}
