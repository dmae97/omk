use omk_providers::anthropic::{Input, build_request};
use serde_json::{Value, json};
use std::{
    io::Write,
    process::{Command, Output, Stdio},
};

fn corpus() -> Value {
    serde_json::from_str(include_str!("fixtures/anthropic-history.json")).unwrap()
}

fn cli(input: &Value) -> Output {
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
        .write_all(
            json!({"input":input,"chunks":[],"abort":false})
                .to_string()
                .as_bytes(),
        )
        .unwrap();
    child.wait_with_output().unwrap()
}

#[test]
fn text_history_request_bytes_match_independent_node_recording() {
    let source = corpus();
    let cases = source["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 12);
    for case in cases {
        let input: Input = serde_json::from_value(case["input"].clone())
            .unwrap_or_else(|error| panic!("{}: {error}", case["id"]));
        assert_eq!(
            build_request(&input).unwrap(),
            case["request"],
            "{}",
            case["id"]
        );
        let output = cli(&case["input"]);
        assert!(
            output.status.success(),
            "{}: {}",
            case["id"],
            String::from_utf8_lossy(&output.stderr)
        );
        let actual: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(
            actual["request"], case["request"],
            "{} executable",
            case["id"]
        );
    }
}

#[test]
fn unsupported_history_roles_and_extra_fields_fail_closed() {
    for history in [
        json!([{"role":"toolResult","text":"not a supported text message"}]),
        json!([{"role":"assistant","text":"reply","thinkingSignature":"not supported"}]),
        json!([{"role":"user","content":[]}]),
    ] {
        let mut input = corpus()["cases"][0]["input"].clone();
        input["history"] = history;
        assert!(serde_json::from_value::<Input>(input.clone()).is_err());
        let output = cli(&input);
        assert!(!output.status.success());
        assert!(output.stdout.is_empty());
    }
}
