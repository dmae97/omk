use omk_providers::{
    anthropic::Input,
    auth::{KeySources, Snapshot},
    catalog::Catalog,
    dispatch,
    transport::{Cancellation, Limits, Transport},
};
use serde_json::{Value, json};
use std::time::Duration;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    time::{Instant, timeout},
};
fn corpus() -> Value {
    serde_json::from_str(include_str!("fixtures/dispatch.json")).unwrap()
}
#[test]
fn credentials_headers_and_catalog_refusals_do_not_dispatch_or_disclose_secrets() {
    let case = &corpus()["cases"][0];
    let input: Input = serde_json::from_value(case["input"].clone()).unwrap();
    let catalog = Catalog::load(case["overlay"].as_str());
    let sources = || KeySources {
        runtime: None,
        environment: Some("wrong-account"),
        fallback: None,
        include_fallback: false,
    };
    assert!(matches!(
        dispatch::prepare(
            &catalog,
            "anthropic",
            &input,
            &Snapshot::from_json(Ok(None)),
            KeySources {
                environment: None,
                ..sources()
            },
            |_| None
        ),
        Err(dispatch::Error::MissingCredential)
    ));
    assert!(
        dispatch::prepare(
            &catalog,
            "anthropic",
            &input,
            &Snapshot::from_json(Ok(None)),
            KeySources {
                environment: None,
                include_fallback: true,
                ..sources()
            },
            |_| None
        )
        .is_ok()
    );
    for store in [
        Err(()),
        Ok(Some("{broken")),
        Ok(Some(r#"{"anthropic":{"type":"api_key","key":"$MISSING"}}"#)),
        Ok(Some(
            r#"{"anthropic":{"type":"api_key","key":"!touch must-not-execute"}}"#,
        )),
        Ok(Some(
            r#"{"anthropic":{"type":"oauth","access":"secret-marker"}}"#,
        )),
    ] {
        let snapshot = Snapshot::from_json(store);
        let error =
            match dispatch::prepare(&catalog, "anthropic", &input, &snapshot, sources(), |_| {
                None
            }) {
                Ok(_) => panic!("unsafe account substitution"),
                Err(e) => e,
            };
        assert!(!format!("{error:?} {error}").contains("secret-marker"));
    }
    for headers in [
        json!({"x-test":"secret-marker\r\nInjected: yes"}),
        json!({"Host":"elsewhere.invalid"}),
        json!({"Content-Length":"0"}),
        json!({"x-test":"$MISSING"}),
    ] {
        let mut overlay: Value = serde_json::from_str(case["overlay"].as_str().unwrap()).unwrap();
        overlay["providers"]["anthropic"]["headers"] = headers;
        let catalog = Catalog::load(Some(&overlay.to_string()));
        assert!(
            dispatch::prepare(
                &catalog,
                "anthropic",
                &input,
                &Snapshot::from_json(Ok(None)),
                sources(),
                |_| None
            )
            .is_err()
        );
    }
    assert!(
        dispatch::prepare(
            &Catalog::load(Some("{")),
            "anthropic",
            &input,
            &Snapshot::from_json(Ok(None)),
            sources(),
            |_| None
        )
        .is_err()
    );
    assert!(
        dispatch::prepare(
            &catalog,
            "missing",
            &input,
            &Snapshot::from_json(Ok(None)),
            sources(),
            |_| None
        )
        .is_err()
    );
}

#[test]
fn http_failure_has_one_terminal_no_retry_and_no_echoed_secret() {
    tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(async {
  for body in ["", "secret-marker: invalid key"] {
   let listener=TcpListener::bind("127.0.0.1:0").await.unwrap();
   let endpoint=format!("http://{}",listener.local_addr().unwrap());
   let case=&corpus()["cases"][0];
   let overlay=case["overlay"].as_str().unwrap().replace("https://synthetic.invalid/v1/",&endpoint);
   let prepared=dispatch::prepare(&Catalog::load(Some(&overlay)),"anthropic",&serde_json::from_value(case["input"].clone()).unwrap(),&Snapshot::from_json(Ok(None)),KeySources{runtime:Some("faux-key"),environment:None,fallback:None,include_fallback:false}, |_|None).unwrap();
   let body=body.to_string();
   let server=tokio::spawn(async move {
    let (mut socket,_)=listener.accept().await.unwrap();
    let mut raw=Vec::new(); while !raw.ends_with(b"\r\n\r\n") { raw.push(socket.read_u8().await.unwrap()); }
    let headers=String::from_utf8(raw).unwrap(); let len:usize=headers.lines().find_map(|s|s.strip_prefix("content-length: ")).unwrap().parse().unwrap();
    socket.read_exact(&mut vec![0;len]).await.unwrap();
    socket.write_all(format!("HTTP/1.1 401 Unauthorized\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body).as_bytes()).await.unwrap();
    assert!(timeout(Duration::from_millis(50),listener.accept()).await.is_err());
   });
   let mut events=Vec::new();
   let result=prepared.send(&Transport::new().unwrap(),Limits{deadline:Instant::now()+Duration::from_secs(2),max_response_bytes:1024},&Cancellation::default(),|e|events.push(e)).await.unwrap();
   assert_eq!(json!(events),json!([{"type":"start"},{"type":"error","reason":"error"}]));
   assert_eq!(result.result["stopReason"],"error");
   assert!(!result.result.to_string().contains("secret-marker")); server.await.unwrap();
  }
 });
}

#[test]
fn executable_refuses_invalid_admission_before_events_and_does_not_echo_inputs() {
    use std::{
        io::Write,
        process::{Command, Stdio},
    };
    let case = &corpus()["cases"][0];
    let valid = json!({"overlay":case["overlay"],"provider":"anthropic","input":case["input"],"runtime":"secret-marker"});
    let mut inputs = Vec::new();
    for (key, value) in [
        ("timeoutMs", json!(0)),
        ("timeoutMs", json!(30001)),
        ("maxResponseBytes", json!(8388609)),
        ("unexpected", json!("secret-marker")),
    ] {
        let mut input = valid.clone();
        input[key] = value;
        inputs.push(input.to_string());
    }
    inputs.push(" ".repeat(2 * 1024 * 1024 + 1));
    for input in inputs {
        let mut child = Command::new(env!("CARGO_BIN_EXE_provider"))
            .arg("stream")
            .env_clear()
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(input.as_bytes())
            .unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(!output.status.success());
        assert!(output.stdout.is_empty());
        let error = String::from_utf8(output.stderr).unwrap();
        assert!(error.starts_with("provider refused:"));
        assert!(!error.contains("secret-marker"));
    }
}
