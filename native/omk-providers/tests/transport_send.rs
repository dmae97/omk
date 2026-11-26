use omk_providers::transport::{Cancellation, Error, Limits, Transport};
use reqwest::header::{HeaderMap, HeaderValue};
use std::time::Duration;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    time::{Instant, timeout},
};

fn run(test: impl Future<Output = ()>) {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(test);
}
async fn bind_listener() -> TcpListener {
    TcpListener::bind("127.0.0.1:0").await.unwrap()
}
fn url(listener: &TcpListener) -> String {
    format!("http://{}/v1/messages", listener.local_addr().unwrap())
}
async fn request(socket: &mut TcpStream) -> Vec<u8> {
    let mut bytes = Vec::new();
    let mut buf = [0; 4096];
    loop {
        let n = socket.read(&mut buf).await.unwrap();
        assert!(n > 0, "EOF before request");
        bytes.extend_from_slice(&buf[..n]);
        assert!(bytes.len() < 128 * 1024);
        if let Some(end) = bytes.windows(4).position(|v| v == b"\r\n\r\n") {
            let headers = String::from_utf8_lossy(&bytes[..end]).to_lowercase();
            let length: usize = headers
                .lines()
                .find_map(|l| l.strip_prefix("content-length: "))
                .unwrap_or("0")
                .parse()
                .unwrap();
            if bytes.len() >= end + 4 + length {
                return bytes;
            }
        }
    }
}
async fn eof(socket: &mut TcpStream) {
    let mut byte = [0];
    assert_eq!(
        timeout(Duration::from_secs(2), socket.read(&mut byte))
            .await
            .unwrap()
            .unwrap(),
        0
    );
}
fn deadline() -> Instant {
    Instant::now() + Duration::from_secs(3)
}

#[test]
fn sends_recorded_sdk_body_and_streams_bytes_without_buffering_the_response() {
    run(async {
        let listener = bind_listener().await;
        let url = url(&listener);
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("fixtures/anthropic.json")).unwrap();
        let recorded = &fixture["cases"][0];
        let body = recorded["request"]["body"]
            .as_str()
            .unwrap()
            .as_bytes()
            .to_vec();
        let expected = body.clone();
        let chunks = recorded["chunks"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|c| {
                c.as_array()
                    .unwrap()
                    .iter()
                    .map(|b| b.as_u64().unwrap() as u8)
            })
            .collect::<Vec<_>>();
        let expected_chunks = chunks.clone();
        let mut headers = HeaderMap::new();
        for (key, value) in recorded["request"]["headers"].as_object().unwrap() {
            headers.insert(
                reqwest::header::HeaderName::from_bytes(key.as_bytes()).unwrap(),
                HeaderValue::from_str(value.as_str().unwrap()).unwrap(),
            );
        }
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let bytes = request(&mut socket).await;
            let end = bytes.windows(4).position(|v| v == b"\r\n\r\n").unwrap();
            assert_eq!(&bytes[end + 4..], expected);
            let head = String::from_utf8_lossy(&bytes[..end]);
            assert!(head.starts_with("POST /v1/messages HTTP/1.1\r\n"));
            assert!(head.contains("x-api-key: faux-key"));
            socket.write_all(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nContent-Type: text/event-stream\r\n\r\n").await.unwrap();
            socket
                .write_all(format!("{:x}\r\n", chunks.len()).as_bytes())
                .await
                .unwrap();
            socket.write_all(&chunks).await.unwrap();
            socket.write_all(b"\r\n0\r\n\r\n").await.unwrap();
        });
        let transport = Transport::new().unwrap();
        let mut received = Vec::new();
        let metadata = transport
            .post(
                &url,
                headers,
                body,
                Limits {
                    deadline: deadline(),
                    max_response_bytes: 8 * 1024 * 1024,
                },
                &Cancellation::default(),
                |_, chunk| {
                    received.extend_from_slice(chunk);
                    Ok(())
                },
            )
            .await
            .unwrap();
        assert_eq!(metadata.status, 200);
        assert_eq!(metadata.headers["content-type"], "text/event-stream");
        assert_eq!(received, expected_chunks);
        let replay =
            omk_providers::anthropic::replay("synthetic-anthropic", &[received], None).unwrap();
        assert_eq!(replay.events, recorded["events"]);
        assert_eq!(replay.result, recorded["result"]);
        server.await.unwrap();
    });
}

#[test]
fn cancellation_and_expiry_before_dispatch_make_zero_connections() {
    run(async {
        let listener = bind_listener().await;
        let transport = Transport::new().unwrap();
        let cancel = Cancellation::default();
        cancel.cancel();
        cancel.clone().cancel();
        let mut calls = 0;
        let result = transport
            .post(
                &url(&listener),
                HeaderMap::new(),
                vec![],
                Limits {
                    deadline: deadline(),
                    max_response_bytes: 16,
                },
                &cancel,
                |_, _| {
                    calls += 1;
                    Ok(())
                },
            )
            .await;
        assert!(matches!(result, Err(Error::Cancelled)));
        let result = transport
            .post(
                &url(&listener),
                HeaderMap::new(),
                vec![],
                Limits {
                    deadline: Instant::now(),
                    max_response_bytes: 16,
                },
                &Cancellation::default(),
                |_, _| {
                    calls += 1;
                    Ok(())
                },
            )
            .await;
        assert!(matches!(result, Err(Error::Deadline)));
        assert_eq!(calls, 0);
        assert!(
            timeout(Duration::from_millis(30), listener.accept())
                .await
                .is_err()
        );
    });
}

#[test]
fn cancellation_while_waiting_for_headers_closes_the_request() {
    run(async {
        let listener = bind_listener().await;
        let endpoint = url(&listener);
        let cancel = Cancellation::default();
        let control = cancel.clone();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            request(&mut socket).await;
            control.cancel();
            eof(&mut socket).await;
        });
        let result = Transport::new()
            .unwrap()
            .post(
                &endpoint,
                HeaderMap::new(),
                vec![],
                Limits {
                    deadline: deadline(),
                    max_response_bytes: 16,
                },
                &cancel,
                |_, _| panic!("no body before headers"),
            )
            .await;
        assert!(matches!(result, Err(Error::Cancelled)));
        server.await.unwrap();
    });
}

#[test]
fn cancellation_during_body_delivery_stops_callbacks_and_closes_socket() {
    run(async {
        let listener = bind_listener().await;
        let endpoint = url(&listener);
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            request(&mut socket).await;
            socket
                .write_all(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n1\r\nx\r\n")
                .await
                .unwrap();
            eof(&mut socket).await;
        });
        let cancel = Cancellation::default();
        let mut calls = 0;
        let result = Transport::new()
            .unwrap()
            .post(
                &endpoint,
                HeaderMap::new(),
                vec![],
                Limits {
                    deadline: deadline(),
                    max_response_bytes: 16,
                },
                &cancel,
                |_, chunk| {
                    calls += 1;
                    assert_eq!(chunk, b"x");
                    cancel.cancel();
                    Ok(())
                },
            )
            .await;
        assert!(matches!(result, Err(Error::Cancelled)));
        assert_eq!(calls, 1);
        server.await.unwrap();
    });
}

#[test]
fn absolute_deadline_covers_headers_and_stalled_body() {
    run(async {
        for headers in [false, true] {
            let listener = bind_listener().await;
            let endpoint = url(&listener);
            let server = tokio::spawn(async move {
                let (mut socket, _) = listener.accept().await.unwrap();
                request(&mut socket).await;
                if headers {
                    socket
                        .write_all(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n")
                        .await
                        .unwrap();
                }
                eof(&mut socket).await;
            });
            let result = Transport::new()
                .unwrap()
                .post(
                    &endpoint,
                    HeaderMap::new(),
                    vec![],
                    Limits {
                        deadline: Instant::now() + Duration::from_millis(100),
                        max_response_bytes: 16,
                    },
                    &Cancellation::default(),
                    |_, _| Ok(()),
                )
                .await;
            assert!(matches!(result, Err(Error::Deadline)), "{result:?}");
            server.await.unwrap();
        }
    });
}

#[test]
fn byte_bound_is_checked_before_delivery_and_unknown_length_is_bounded() {
    run(async {
        for response in [
            b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nxy".as_slice(),
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n2\r\nxy\r\n0\r\n\r\n".as_slice(),
        ] {
            let listener = bind_listener().await;
            let endpoint = url(&listener);
            let server = tokio::spawn(async move {
                let (mut socket, _) = listener.accept().await.unwrap();
                request(&mut socket).await;
                socket.write_all(response).await.unwrap();
            });
            let mut delivered = 0;
            let result = Transport::new()
                .unwrap()
                .post(
                    &endpoint,
                    HeaderMap::new(),
                    vec![],
                    Limits {
                        deadline: deadline(),
                        max_response_bytes: 1,
                    },
                    &Cancellation::default(),
                    |_, chunk| {
                        delivered += chunk.len();
                        Ok(())
                    },
                )
                .await;
            assert!(matches!(result, Err(Error::ResponseTooLarge)));
            assert_eq!(delivered, 0);
            server.await.unwrap();
        }
    });
}

#[test]
fn status_errors_and_redirects_return_once_without_following_or_retrying() {
    run(async {
        for status in [307, 429, 503] {
            let listener = bind_listener().await;
            let endpoint = url(&listener);
            let target = bind_listener().await;
            let redirect = url(&target);
            let server = tokio::spawn(async move {
                let (mut socket, _) = listener.accept().await.unwrap();
                request(&mut socket).await;
                socket.write_all(format!("HTTP/1.1 {status} Test\r\nLocation: {redirect}\r\nRetry-After: 0\r\nContent-Length: 4\r\n\r\noops").as_bytes()).await.unwrap();
                drop(socket);
                assert!(
                    timeout(Duration::from_millis(100), listener.accept())
                        .await
                        .is_err(),
                    "unexpected retry"
                );
            });
            let mut body = Vec::new();
            let metadata = Transport::new()
                .unwrap()
                .post(
                    &endpoint,
                    HeaderMap::new(),
                    vec![],
                    Limits {
                        deadline: deadline(),
                        max_response_bytes: 16,
                    },
                    &Cancellation::default(),
                    |metadata, chunk| {
                        assert_eq!(metadata.status, status);
                        body.extend_from_slice(chunk);
                        Ok(())
                    },
                )
                .await
                .unwrap();
            assert_eq!(metadata.status, status);
            assert_eq!(body, b"oops");
            server.await.unwrap();
            assert!(
                timeout(Duration::from_millis(20), target.accept())
                    .await
                    .is_err(),
                "redirect followed"
            );
        }
    });
}

#[test]
fn sink_failure_and_truncated_response_are_not_success() {
    run(async {
        for sink_failure in [true, false] {
            let listener = bind_listener().await;
            let endpoint = url(&listener);
            let server = tokio::spawn(async move {
                let (mut socket, _) = listener.accept().await.unwrap();
                request(&mut socket).await;
                socket
                    .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 8\r\n\r\nx")
                    .await
                    .unwrap();
                if sink_failure {
                    eof(&mut socket).await;
                }
            });
            let result = Transport::new()
                .unwrap()
                .post(
                    &endpoint,
                    HeaderMap::new(),
                    vec![],
                    Limits {
                        deadline: deadline(),
                        max_response_bytes: 16,
                    },
                    &Cancellation::default(),
                    |_, _| if sink_failure { Err(()) } else { Ok(()) },
                )
                .await;
            assert!(if sink_failure {
                matches!(result, Err(Error::Sink))
            } else {
                matches!(result, Err(Error::Network))
            });
            server.await.unwrap();
        }
    });
}

#[test]
fn unsafe_endpoint_and_oversized_request_fail_without_disclosing_input() {
    run(async {
        let transport = Transport::new().unwrap();
        for endpoint in [
            "http://example.invalid/path?secret=sentinel",
            "https://user:sentinel@example.invalid",
            "https://example.invalid/#sentinel",
            "file:///sentinel",
            "invalid-sentinel",
        ] {
            let error = transport
                .post(
                    endpoint,
                    HeaderMap::new(),
                    vec![],
                    Limits {
                        deadline: deadline(),
                        max_response_bytes: 1,
                    },
                    &Cancellation::default(),
                    |_, _| Ok(()),
                )
                .await
                .unwrap_err();
            assert!(matches!(error, Error::InvalidRequest));
            assert!(!format!("{error:?} {error}").contains("sentinel"));
        }
        let listener = bind_listener().await;
        let error = transport
            .post(
                &url(&listener),
                HeaderMap::new(),
                vec![0; 8 * 1024 * 1024 + 1],
                Limits {
                    deadline: deadline(),
                    max_response_bytes: 1,
                },
                &Cancellation::default(),
                |_, _| Ok(()),
            )
            .await
            .unwrap_err();
        assert!(matches!(error, Error::InvalidRequest));
        assert!(
            timeout(Duration::from_millis(20), listener.accept())
                .await
                .is_err()
        );
    });
}

#[test]
fn caller_framing_headers_are_refused_before_dispatch() {
    run(async {
        let listener = bind_listener().await;
        let transport = Transport::new().unwrap();
        for key in [
            reqwest::header::CONTENT_LENGTH,
            reqwest::header::TRANSFER_ENCODING,
        ] {
            let mut headers = HeaderMap::new();
            headers.insert(key, HeaderValue::from_static("1"));
            let error = transport
                .post(
                    &url(&listener),
                    headers,
                    vec![],
                    Limits {
                        deadline: deadline(),
                        max_response_bytes: 1,
                    },
                    &Cancellation::default(),
                    |_, _| Ok(()),
                )
                .await
                .unwrap_err();
            assert_eq!(error, Error::InvalidRequest);
        }
        assert!(
            timeout(Duration::from_millis(20), listener.accept())
                .await
                .is_err()
        );
    });
}

#[test]
fn cumulative_limit_stops_before_delivering_a_later_chunk() {
    run(async {
        let listener = bind_listener().await;
        let endpoint = url(&listener);
        let (sent, received) = tokio::sync::oneshot::channel();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            request(&mut socket).await;
            socket
                .write_all(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n1\r\nx\r\n")
                .await
                .unwrap();
            received.await.unwrap();
            socket.write_all(b"1\r\ny\r\n").await.unwrap();
            eof(&mut socket).await;
        });
        let mut sent = Some(sent);
        let mut bytes = Vec::new();
        let error = Transport::new()
            .unwrap()
            .post(
                &endpoint,
                HeaderMap::new(),
                vec![],
                Limits {
                    deadline: deadline(),
                    max_response_bytes: 1,
                },
                &Cancellation::default(),
                |_, chunk| {
                    bytes.extend_from_slice(chunk);
                    sent.take().unwrap().send(()).unwrap();
                    Ok(())
                },
            )
            .await
            .unwrap_err();
        assert_eq!(error, Error::ResponseTooLarge);
        assert_eq!(bytes, b"x");
        server.await.unwrap();
    });
}

#[test]
fn dropping_a_pending_request_future_closes_its_socket() {
    run(async {
        let listener = bind_listener().await;
        let endpoint = url(&listener);
        let (sent, received) = tokio::sync::oneshot::channel();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            request(&mut socket).await;
            sent.send(()).unwrap();
            eof(&mut socket).await;
        });
        let transport = Transport::new().unwrap();
        let cancellation = Cancellation::default();
        let mut operation = Box::pin(transport.post(
            &endpoint,
            HeaderMap::new(),
            vec![],
            Limits {
                deadline: deadline(),
                max_response_bytes: 1,
            },
            &cancellation,
            |_, _| Ok(()),
        ));
        let mut received = Box::pin(received);
        std::future::poll_fn(|cx| {
            use std::future::Future;
            assert!(operation.as_mut().poll(cx).is_pending());
            received.as_mut().poll(cx).map(|result| result.unwrap())
        })
        .await;
        drop(operation);
        server.await.unwrap();
    });
}

#[test]
fn zero_limit_accepts_empty_body_and_exact_limit_accepts_all_bytes() {
    run(async {
        for body in ["", "exact"] {
            let listener = bind_listener().await;
            let endpoint = url(&listener);
            let server = tokio::spawn(async move {
                let (mut socket, _) = listener.accept().await.unwrap();
                request(&mut socket).await;
                socket
                    .write_all(
                        format!(
                            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n{body}",
                            body.len()
                        )
                        .as_bytes(),
                    )
                    .await
                    .unwrap();
            });
            let mut bytes = Vec::new();
            Transport::new()
                .unwrap()
                .post(
                    &endpoint,
                    HeaderMap::new(),
                    vec![],
                    Limits {
                        deadline: deadline(),
                        max_response_bytes: body.len(),
                    },
                    &Cancellation::default(),
                    |_, chunk| {
                        bytes.extend_from_slice(chunk);
                        Ok(())
                    },
                )
                .await
                .unwrap();
            assert_eq!(bytes, body.as_bytes());
            server.await.unwrap();
        }
    });
}
