use omk_providers::anthropic::{Input, build_request, replay};
use serde::Deserialize;
use serde_json::Value;
use std::{
    io::Write,
    process::{Command, Stdio},
};

#[derive(Deserialize)]
struct Corpus {
    cases: Vec<Case>,
}
#[derive(Deserialize)]
struct Case {
    id: String,
    input: Input,
    request: Value,
    chunks: Vec<Vec<u8>>,
    abort: bool,
    #[serde(rename = "abortAfterChunks")]
    abort_after_chunks: Option<usize>,
    events: Value,
    result: Value,
}

#[test]
fn node_recordings_are_the_independent_oracle() {
    let corpus: Corpus = serde_json::from_str(include_str!("fixtures/anthropic.json")).unwrap();
    assert_eq!(corpus.cases.len(), 16);
    for case in corpus.cases {
        let request = build_request(&case.input).unwrap();
        assert_eq!(request, case.request, "{} request bytes/headers", case.id);
        let actual = replay(
            &case.input.model,
            &case.chunks,
            case.abort.then_some(0).or(case.abort_after_chunks),
        )
        .unwrap();
        assert_eq!(actual.events, case.events, "{} event order", case.id);
        assert_eq!(actual.result, case.result, "{} final message", case.id);
        let source: Value = serde_json::from_str(include_str!("fixtures/anthropic.json")).unwrap();
        let input = source["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["id"] == case.id)
            .unwrap();
        let mut child = Command::new(env!("CARGO_BIN_EXE_replay-anthropic"))
            .env_clear()
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let payload = serde_json::json!({"input":input["input"],"chunks":case.chunks,"abort":case.abort,"abortAfterChunks":case.abort_after_chunks});
        child
            .stdin
            .take()
            .unwrap()
            .write_all(payload.to_string().as_bytes())
            .unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(
            output.status.success(),
            "{}: {}",
            case.id,
            String::from_utf8_lossy(&output.stderr)
        );
        let output: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(
            output,
            serde_json::json!({"request":case.request,"events":case.events,"result":case.result}),
            "{} CLI",
            case.id
        );
    }
}
