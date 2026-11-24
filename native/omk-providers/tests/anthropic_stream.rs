use omk_providers::anthropic::Stream;
use serde_json::Value;

fn corpus() -> Value {
    serde_json::from_str(include_str!("fixtures/anthropic.json")).unwrap()
}

#[test]
fn incremental_chunks_match_all_independent_node_terminal_recordings() {
    let corpus = corpus();
    let cases = corpus["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 16);
    for case in cases {
        let aborted = case["abort"] == true || case["abortAfterChunks"].is_number();
        let mut stream = Stream::new(case["input"]["model"].as_str().unwrap()).unwrap();
        let mut events = stream.take_events();
        if case["abort"] != true {
            let limit = case["abortAfterChunks"]
                .as_u64()
                .map(|n| n as usize)
                .unwrap_or(usize::MAX);
            for chunk in case["chunks"].as_array().unwrap().iter().take(limit) {
                let bytes: Vec<u8> = serde_json::from_value(chunk.clone()).unwrap();
                let outcome = stream.feed(&bytes);
                events.extend(stream.take_events());
                if outcome.is_err() {
                    break;
                }
            }
        }
        let terminal = stream.finish(None, aborted);
        events.extend(terminal.events.as_array().unwrap().iter().cloned());
        assert_eq!(
            serde_json::json!(events),
            case["events"],
            "{} events",
            case["id"]
        );
        assert_eq!(terminal.result, case["result"], "{} result", case["id"]);
    }
}

#[test]
fn complete_frames_are_delivered_before_eof_and_not_delivered_twice() {
    let corpus = corpus();
    let case = &corpus["cases"][0];
    assert_eq!(case["id"], "unicode");
    let mut stream = Stream::new("synthetic-anthropic").unwrap();
    assert_eq!(stream.take_events(), [serde_json::json!({"type":"start"})]);
    assert!(stream.take_events().is_empty());
    let bytes: Vec<u8> = serde_json::from_value(case["chunks"][0].clone()).unwrap();
    stream.feed(&bytes).unwrap();
    let events = stream.take_events();
    assert!(events.iter().any(|event| event["type"] == "text_delta"));
    assert!(events.iter().all(|event| event["type"] != "done"));
    assert!(stream.take_events().is_empty());
    let terminal = stream.finish(None, false);
    assert_eq!(
        terminal.events,
        serde_json::json!([{"type":"done","reason":"stop"}])
    );
    assert_eq!(terminal.result, case["result"]);
}

#[test]
fn parser_failure_latches_and_preserves_prior_events_and_one_terminal() {
    let mut stream = Stream::new("synthetic-anthropic").unwrap();
    let first = stream
        .feed(b"event: message_start\ndata: malformed\n\n")
        .unwrap_err();
    assert_eq!(stream.feed(b""), Err(first.clone()));
    assert_eq!(stream.take_events(), [serde_json::json!({"type":"start"})]);
    let terminal = stream.finish(Some("HTTP consumer failed".into()), false);
    assert_eq!(
        terminal.events,
        serde_json::json!([{"type":"error","reason":"error"}])
    );
    assert_eq!(terminal.result["errorMessage"], first);
}

#[test]
fn total_byte_bound_and_unrecorded_model_fail_closed() {
    assert!(Stream::new("unrecorded").is_err());
    assert!(Stream::new("synthetic-anthropic-vision").is_err());
    let mut stream = Stream::new("synthetic-anthropic").unwrap();
    // Valid ignored frames keep decoder storage small while crossing the total bound.
    let chunk = b"event: ping\ndata: {}\n\n".repeat(4096);
    for _ in 0..(8 * 1024 * 1024 / chunk.len()) {
        stream.feed(&chunk).unwrap();
    }
    assert_eq!(stream.feed(&chunk).unwrap_err(), "stream exceeds 8 MiB");
    let terminal = stream.finish(None, false);
    assert_eq!(terminal.result["stopReason"], "error");
}

#[test]
fn transport_delivers_events_before_eof_and_cancels_after_partial_text() {
    use omk_providers::transport::{Cancellation, Error, Limits, Transport};
    use reqwest::header::HeaderMap;
    use std::{io::ErrorKind, time::Duration};
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
        time::{Instant, timeout},
    };

    tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(async {
        let corpus = corpus();
        for aborted in [false, true] {
            let case = corpus["cases"].as_array().unwrap().iter().find(|case| case["id"] == "cancel-mid").unwrap();
            let chunks: Vec<Vec<u8>> = serde_json::from_value(case["chunks"].clone()).unwrap();
            let split = chunks[0].len();
            let wire: Vec<u8> = chunks.into_iter().flatten().collect();
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let endpoint = format!("http://{}/v1/messages", listener.local_addr().unwrap());
            let (sent, received) = tokio::sync::oneshot::channel();
            let server = tokio::spawn(async move {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = Vec::new();
                loop {
                    let byte = socket.read_u8().await.unwrap();
                    request.push(byte);
                    if request.ends_with(b"\r\n\r\n") { break; }
                }
                socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", wire.len()).as_bytes()).await.unwrap();
                socket.write_all(&wire[..split]).await.unwrap();
                received.await.unwrap();
                if aborted {
                    let mut byte = [0];
                    let eof = timeout(Duration::from_secs(2), socket.read(&mut byte)).await.unwrap();
                    assert!(matches!(eof, Ok(0)) || eof.is_err_and(|e| matches!(e.kind(), ErrorKind::ConnectionReset | ErrorKind::ConnectionAborted)));
                } else {
                    socket.write_all(&wire[split..]).await.unwrap();
                }
            });
            let cancellation = Cancellation::default();
            let mut sent = Some(sent);
            let mut stream = Stream::new("synthetic-anthropic").unwrap();
            let mut events = stream.take_events();
            let outcome = Transport::new().unwrap().post(&endpoint, HeaderMap::new(), vec![], Limits { deadline: Instant::now() + Duration::from_secs(3), max_response_bytes: 8192 }, &cancellation, |response, chunk| {
                assert_eq!(response.status, 200);
                stream.feed(chunk).unwrap();
                let pending = stream.take_events();
                if pending.iter().any(|event| event["type"] == "text_delta") {
                    sent.take().unwrap().send(()).unwrap();
                    if aborted { cancellation.cancel(); }
                }
                events.extend(pending);
                Ok(())
            }).await;
            if aborted { assert_eq!(outcome.unwrap_err(), Error::Cancelled); } else { assert!(outcome.is_ok()); }
            let terminal = stream.finish(None, aborted);
            events.extend(terminal.events.as_array().unwrap().iter().cloned());
            let expected = if aborted { case } else { &corpus["cases"][0] };
            assert_eq!(serde_json::json!(events), expected["events"]);
            assert_eq!(terminal.result, expected["result"]);
            server.await.unwrap();
        }
    });
}
