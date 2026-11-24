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
    serde_json::from_str(include_str!("fixtures/anthropic-content.json")).unwrap()
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
fn content_request_bytes_match_independent_node_recording() {
    let corpus = corpus();
    assert_eq!(corpus.cases.len(), 26);
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
fn unsupported_content_is_refused_without_partial_stdout() {
    for history in [
        json!([{"role":"user","text":"ambiguous","content":[]}]),
        json!([{"role":"user","content":[],"stopReason":"stop"}]),
        json!([{"role":"user","content":[{"type":"image","data":"x"}]}]),
        json!([{"role":"user","content":[{"type":"image","data":1,"mimeType":"image/png"}]}]),
        json!([{"role":"user","content":[{"type":"image","data":"x","mimeType":"image/png","url":"https://synthetic.invalid"}]}]),
        json!([{"role":"user","content":[{"type":"text","text":"x","data":"ambiguous"}]}]),
        json!([{"role":"user","content":[{"type":"audio","data":"x"}]}]),
        json!([{"role":"user","content":null}]),
        json!([{"role":"toolResult","toolCallId":"orphan","content":[{"type":"image","data":"x"}],"isError":false}]),
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
fn content_block_limit_counts_images_before_deduplication() {
    for role in ["user", "toolResult"] {
        for block in [
            json!({"type":"text","text":""}),
            json!({"type":"image","data":"x","mimeType":"image/png"}),
        ] {
            let mut input: Value = serde_json::from_str(corpus().cases[0].input.get()).unwrap();
            let mut message = json!({"role":role,"content":vec![block.clone();4096]});
            if role == "toolResult" {
                message["toolCallId"] = json!("orphan");
                message["isError"] = json!(false);
            }
            input["history"] = json!([message.clone()]);
            let valid: Input = serde_json::from_str(&input.to_string()).unwrap();
            assert!(build_request(&valid).is_ok());
            message["content"].as_array_mut().unwrap().push(block);
            input["history"] = json!([message]);
            let serialized = input.to_string();
            let invalid: Input = serde_json::from_str(&serialized).unwrap();
            assert!(build_request(&invalid).is_err());
            let output = cli(&serialized);
            assert!(!output.status.success());
            assert!(output.stdout.is_empty());
        }
    }
}
