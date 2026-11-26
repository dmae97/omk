use omk_providers::{
    anthropic::Input,
    auth::{KeySources, Snapshot},
    catalog::Catalog,
    dispatch,
    transport::{Cancellation, Limits, Transport},
};
use serde_json::{Value, json};
use std::{collections::BTreeMap, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    time::{Instant, timeout},
};
fn corpus() -> Value {
    let mut recorded: Value = serde_json::from_str(include_str!("fixtures/dispatch.json")).unwrap();
    for extra in [
        include_str!("fixtures/anthropic-policy.json"),
        include_str!("fixtures/anthropic-cache.json"),
        include_str!("fixtures/anthropic-signature.json"),
        include_str!("fixtures/anthropic-tool-schema.json"),
    ] {
        let extra: Value = serde_json::from_str(extra).unwrap();
        recorded["cases"]
            .as_array_mut()
            .unwrap()
            .extend(extra["cases"].as_array().unwrap().iter().cloned());
    }
    recorded
}
async fn server(listener: TcpListener, wire: String, expected: Value) {
    let (mut socket, _) = timeout(Duration::from_secs(3), listener.accept())
        .await
        .unwrap()
        .unwrap();
    let mut raw = Vec::new();
    while !raw.ends_with(b"\r\n\r\n") {
        raw.push(socket.read_u8().await.unwrap());
        assert!(raw.len() < 65536);
    }
    let headers = String::from_utf8(raw).unwrap();
    assert!(headers.starts_with("POST /v1/messages HTTP/1.1\r\n"));
    let mut actual = BTreeMap::new();
    for line in headers.split("\r\n").skip(1).filter(|l| l.contains(':')) {
        let (key, value) = line.split_once(':').unwrap();
        actual.insert(key.to_ascii_lowercase(), value.trim().to_string());
    }
    let length: usize = actual["content-length"].parse().unwrap();
    let mut body = vec![0; length];
    socket.read_exact(&mut body).await.unwrap();
    assert_eq!(
        String::from_utf8(body).unwrap(),
        expected["body"].as_str().unwrap()
    );
    for (k, v) in expected["headers"].as_object().unwrap() {
        assert_eq!(actual.get(k).map(String::as_str), v.as_str(), "header {k}");
    }
    assert_eq!(
        actual.contains_key("authorization"),
        expected["headers"].get("authorization").is_some()
    );
    socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",wire.len(),wire).as_bytes()).await.unwrap();
}
#[test]
fn independent_node_dispatch_matches_library_socket_request_and_response() {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(async {
            for case in corpus()["cases"].as_array().unwrap() {
                let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
                let base = format!("http://{}", listener.local_addr().unwrap());
                let overlay = case["overlay"]
                    .as_str()
                    .unwrap()
                    .replace("https://synthetic.invalid/v1/", &base)
                    .replace("https://synthetic.invalid", &base);
                let catalog = Catalog::load(Some(&overlay));
                let input: Input = serde_json::from_value(case["input"].clone()).unwrap();
                let snapshot = Snapshot::from_json(Ok(case["store"].as_str()));
                let prepared = dispatch::prepare(
                    &catalog,
                    case["provider"].as_str().unwrap(),
                    &input,
                    &snapshot,
                    KeySources {
                        runtime: case["runtime"].as_str(),
                        environment: case["environment"].as_str(),
                        fallback: None,
                        include_fallback: true,
                    },
                    |key| case["env"][key].as_str().map(str::to_string),
                )
                .unwrap();
                let task = tokio::spawn(server(
                    listener,
                    case["wire"].as_str().unwrap().into(),
                    case["request"].clone(),
                ));
                let mut events = Vec::new();
                let result = prepared
                    .send(
                        &Transport::new().unwrap(),
                        Limits {
                            deadline: Instant::now() + Duration::from_secs(3),
                            max_response_bytes: 8192,
                        },
                        &Cancellation::default(),
                        |event| events.push(event),
                    )
                    .await
                    .unwrap();
                task.await.unwrap();
                assert_eq!(json!(events), case["events"], "{} events", case["id"]);
                assert_eq!(result.result, case["result"], "{} result", case["id"]);
            }
        });
}

#[test]
fn executable_dispatch_matches_all_independent_node_cases() {
    use std::{
        io::Write,
        process::{Command, Stdio},
    };
    tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(async {
  for case in corpus()["cases"].as_array().unwrap() {
   let listener=TcpListener::bind("127.0.0.1:0").await.unwrap();
   let base=format!("http://{}",listener.local_addr().unwrap());
   let overlay=case["overlay"].as_str().unwrap().replace("https://synthetic.invalid/v1/",&base).replace("https://synthetic.invalid",&base);
   let task=tokio::spawn(server(listener,case["wire"].as_str().unwrap().into(),case["request"].clone()));
   let input=json!({"overlay":overlay,"provider":case["provider"],"input":case["input"],"runtime":case["runtime"],"store":case["store"],"environment":case["environment"],"env":case.get("env").cloned().unwrap_or(json!({})),"timeoutMs":2000});
   let output=tokio::task::spawn_blocking(move || {
    let mut child=Command::new(env!("CARGO_BIN_EXE_provider")).arg("stream").env_clear().env("ANTHROPIC_API_KEY","ambient-must-not-win").stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
    child.stdin.take().unwrap().write_all(input.to_string().as_bytes()).unwrap(); child.wait_with_output().unwrap()
   }).await.unwrap();
   task.await.unwrap();
   assert!(output.status.success(),"{}: {}",case["id"],String::from_utf8_lossy(&output.stderr));
   assert!(output.stderr.is_empty());
   let lines:Vec<Value>=String::from_utf8(output.stdout).unwrap().lines().map(|line|serde_json::from_str(line).unwrap()).collect();
   let events:Vec<_>=lines.iter().filter_map(|v|v.get("event")).collect();
   assert_eq!(json!(events),case["events"]);
   assert_eq!(lines.last().unwrap()["result"],case["result"]);
  }
 });
}
