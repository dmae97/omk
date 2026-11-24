use omk_providers::{
    auth::{KeySources, Snapshot},
    catalog::Catalog,
    dispatch,
    transport::{Cancellation, Limits, Transport},
};
use serde_json::{Value, json};
use std::{
    io::{BufRead, BufReader, Read, Write},
    net::TcpListener,
    process::{Command, Stdio},
    sync::mpsc,
    time::Duration,
};
#[test]
fn executable_flushes_text_delta_before_the_server_releases_eof() {
    let corpus: Value = serde_json::from_str(include_str!("fixtures/dispatch.json")).unwrap();
    let case = &corpus["cases"][0];
    let streams: Value = serde_json::from_str(include_str!("fixtures/anthropic.json")).unwrap();
    let split = streams["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "cancel-mid")
        .unwrap();
    let chunks: Vec<Vec<u8>> = serde_json::from_value(split["chunks"].clone()).unwrap();
    let prefix = chunks[0].len();
    let wire: Vec<u8> = chunks.into_iter().flatten().collect();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let overlay = case["overlay"]
        .as_str()
        .unwrap()
        .replace("https://synthetic.invalid/v1/", &base);
    let (sent, received) = mpsc::channel();
    let server = std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        let mut headers = Vec::new();
        let mut byte = [0];
        while !headers.ends_with(b"\r\n\r\n") {
            socket.read_exact(&mut byte).unwrap();
            headers.push(byte[0]);
        }
        let len: usize = String::from_utf8(headers)
            .unwrap()
            .lines()
            .find_map(|s| s.strip_prefix("content-length: "))
            .unwrap()
            .parse()
            .unwrap();
        socket.read_exact(&mut vec![0; len]).unwrap();
        write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",wire.len()).unwrap();
        socket.write_all(&wire[..prefix]).unwrap();
        received
            .recv_timeout(Duration::from_secs(3))
            .expect("CLI must flush text_delta before EOF");
        socket.write_all(&wire[prefix..]).unwrap();
    });
    let mut child = Command::new(env!("CARGO_BIN_EXE_provider"))
        .arg("stream")
        .env_clear()
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(json!({"overlay":overlay,"provider":"anthropic","input":case["input"],"runtime":"faux-key","timeoutMs":2000}).to_string().as_bytes()).unwrap();
    let mut sent = Some(sent);
    let mut terminal = 0;
    for line in BufReader::new(child.stdout.take().unwrap()).lines() {
        let v: Value = serde_json::from_str(&line.unwrap()).unwrap();
        if v["event"]["type"] == "text_delta"
            && let Some(sender) = sent.take()
        {
            sender.send(()).unwrap();
        }
        if v["event"]["type"] == "done" || v["event"]["type"] == "error" {
            terminal += 1;
        }
    }
    assert!(child.wait().unwrap().success());
    assert_eq!(terminal, 1);
    server.join().unwrap();
}
#[test]
fn cancellation_after_partial_dispatch_retains_text_and_closes_the_socket() {
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        time::{Instant, timeout},
    };
    tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(async {
  let corpus:Value=serde_json::from_str(include_str!("fixtures/dispatch.json")).unwrap(); let case=&corpus["cases"][0];
  let streams:Value=serde_json::from_str(include_str!("fixtures/anthropic.json")).unwrap();
  let split=streams["cases"].as_array().unwrap().iter().find(|c|c["id"]=="cancel-mid").unwrap(); let chunks:Vec<Vec<u8>>=serde_json::from_value(split["chunks"].clone()).unwrap(); let prefix=chunks[0].clone();
  let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap(); let base=format!("http://{}",listener.local_addr().unwrap());
  let overlay=case["overlay"].as_str().unwrap().replace("https://synthetic.invalid/v1/",&base);
  let server=tokio::spawn(async move {
   let (mut socket,_)=listener.accept().await.unwrap(); let mut headers=Vec::new();
   while !headers.ends_with(b"\r\n\r\n") { headers.push(socket.read_u8().await.unwrap()); }
   let len:usize=String::from_utf8(headers).unwrap().lines().find_map(|s|s.strip_prefix("content-length: ")).unwrap().parse().unwrap(); socket.read_exact(&mut vec![0;len]).await.unwrap();
   socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n").await.unwrap(); socket.write_all(&prefix).await.unwrap();
   let result=timeout(Duration::from_secs(2),socket.read(&mut [0])).await.unwrap(); assert!(matches!(result,Ok(0)) || result.is_err());
  });
  let prepared=dispatch::prepare(&Catalog::load(Some(&overlay)),"anthropic",&serde_json::from_value(case["input"].clone()).unwrap(),&Snapshot::from_json(Ok(None)),KeySources{runtime:Some("faux-key"),environment:None,fallback:None,include_fallback:false},|_|None).unwrap();
  let cancel=Cancellation::default(); let mut events=Vec::new();
  let result=prepared.send(&Transport::new().unwrap(),Limits{deadline:Instant::now()+Duration::from_secs(3),max_response_bytes:8192},&cancel,|e| { if e["type"]=="text_delta" { cancel.cancel(); } events.push(e); }).await.unwrap();
  assert_eq!(result.result["stopReason"],"aborted"); assert!(!result.result["content"].as_array().unwrap().is_empty()); assert_eq!(events.last().unwrap()["reason"],"aborted"); server.await.unwrap();
 });
}
