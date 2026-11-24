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
    serde_json::from_str(include_str!("fixtures/anthropic-vision.json")).unwrap()
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
fn vision_request_bytes_match_independent_node_recording() {
    let corpus = corpus();
    assert_eq!(corpus.cases.len(), 50);
    for case in corpus.cases {
        let input: Input = serde_json::from_str(case.input.get()).unwrap();
        let request = build_request(&input).unwrap_or_else(|error| panic!("{}: {error}", case.id));
        assert_eq!(request, case.request, "{} library", case.id);
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
fn vision_rejects_unsupported_fields_and_original_block_overflow() {
    let original: Value = serde_json::from_str(corpus().cases[0].input.get()).unwrap();
    let mut oversized = original.clone();
    oversized["history"] = json!([{"role":"toolResult","toolCallId":"orphan","content":vec![json!({"type":"image","data":"","mimeType":"image/png"});4097],"isError":false}]);
    let mut wrong_model = original.clone();
    wrong_model["model"] = json!("synthetic-anthropic-vision2");
    let mut malformed = original.clone();
    malformed["history"][0]["content"][0]["url"] = json!("https://synthetic.invalid/image");
    for input in [oversized, wrong_model, malformed] {
        let serialized = input.to_string();
        assert!(
            serde_json::from_str::<Input>(&serialized)
                .and_then(|input| build_request(&input).map_err(serde::de::Error::custom))
                .is_err()
        );
        let output = cli(&serialized);
        assert!(!output.status.success());
        assert!(output.stdout.is_empty());
    }
    let mut boundary = original;
    boundary["history"][0]["content"] = json!(vec![
        json!({"type":"image","data":"","mimeType":"image/png"});
        4096
    ]);
    assert!(build_request(&serde_json::from_str::<Input>(&boundary.to_string()).unwrap()).is_ok());
}

#[test]
fn vision_does_not_admit_unrecorded_response_or_cancellation_replay() {
    use omk_providers::anthropic::replay;
    assert!(replay("synthetic-anthropic-vision", &[vec![]], None).is_err());
    assert!(replay("synthetic-anthropic-vision", &[], Some(0)).is_err());
}
