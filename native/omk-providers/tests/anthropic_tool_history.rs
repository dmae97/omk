use omk_providers::anthropic::{Input, build_request};
use serde::Deserialize;
use serde_json::{Value, json, value::RawValue};
use std::{
    io::Write,
    process::{Command, Output, Stdio},
};

#[derive(Deserialize)]
struct Case {
    id: String,
    input: Box<RawValue>,
    request: Value,
}
#[derive(Deserialize)]
struct Corpus {
    cases: Vec<Case>,
}
fn corpus() -> Corpus {
    serde_json::from_str(include_str!("fixtures/anthropic-tool-history.json")).unwrap()
}
fn cli(input: &str) -> Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_replay-anthropic"))
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
        .write_all(format!(r#"{{"input":{input},"chunks":[],"abort":false}}"#).as_bytes())
        .unwrap();
    child.wait_with_output().unwrap()
}
#[test]
fn tool_history_request_bytes_match_independent_node_recording() {
    let corpus = corpus();
    assert_eq!(corpus.cases.len(), 25);
    for case in corpus.cases {
        let input: Input = serde_json::from_str(case.input.get())
            .unwrap_or_else(|error| panic!("{}: {error}", case.id));
        assert_eq!(
            build_request(&input).unwrap(),
            case.request,
            "{} library",
            case.id
        );
        let output = cli(case.input.get());
        assert!(
            output.status.success(),
            "{}: {}",
            case.id,
            String::from_utf8_lossy(&output.stderr)
        );
        let actual: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(actual["request"], case.request, "{} executable", case.id);
    }
}
#[test]
fn unsupported_tool_history_is_refused_without_partial_stdout() {
    for history in [
        json!([{"role":"assistant","content":[{"type":"image","data":"unsupported"}]}]),
        json!([{"role":"assistant","content":[],"provider":"other"}]),
        json!([{"role":"assistant","content":[],"text":"ambiguous"}]),
        json!([{"role":"assistant","content":[],"stopReason":"unknown"}]),
        json!([{"role":"toolResult","toolCallId":"call_1","content":[],"isError":"false"}]),
        json!([{"role":"toolResult","toolCallId":"call_1","content":[],"isError":false,"extra":1}]),
        json!([{"role":"assistant","content":[{"type":"thinking","thinking":"","redacted":true}]}]),
    ] {
        let mut input: Value = serde_json::from_str(corpus().cases[0].input.get()).unwrap();
        input["history"] = history;
        let serialized = input.to_string();
        assert!(
            serde_json::from_str::<Input>(&serialized)
                .and_then(|input| build_request(&input).map_err(serde::de::Error::custom))
                .is_err()
        );
        let output = cli(&serialized);
        assert!(!output.status.success(), "accepted {serialized}");
        assert!(output.stdout.is_empty());
        assert!(String::from_utf8_lossy(&output.stderr).contains("replay refused:"));
    }
}
#[test]
fn tool_history_and_argument_limits_fail_closed() {
    for history in [
        json!(vec![json!({"role":"user","text":""}); 4097]),
        json!([{"role":"assistant","content":vec![json!({"type":"text","text":""}); 4097]}]),
        json!([{"role":"assistant","content":[{"type":"toolCall","id":"a","name":"read","arguments":{"value":9007199254740992u64}}]}]),
        json!([{"role":"assistant","content":[{"type":"toolCall","id":"a","name":"read","arguments":{"value":"x".repeat(1024*1024)}}]}]),
    ] {
        let mut input: Value = serde_json::from_str(corpus().cases[0].input.get()).unwrap();
        input["history"] = history;
        let serialized = input.to_string();
        let input: Input = serde_json::from_str(&serialized).unwrap();
        assert!(build_request(&input).is_err());
        let output = cli(&serialized);
        assert!(!output.status.success());
        assert!(output.stdout.is_empty());
    }
}
