use omk_providers::{
    anthropic::{Input, build_request, replay_with_tool_arguments as replay},
    json_parse::{parse_json_with_repair, parse_streaming_json, repair_json},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    io::Write,
    process::{Command, Stdio},
};

#[derive(Deserialize)]
struct Corpus {
    values: Vec<JsonCase>,
    streams: Vec<StreamCase>,
}
#[derive(Deserialize)]
struct JsonCase {
    id: String,
    input: String,
    repaired: String,
    strict: Value,
    streaming: Value,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StreamCase {
    id: String,
    input: Value,
    request: Value,
    chunks: Vec<Vec<u8>>,
    abort: bool,
    abort_after_chunks: Option<usize>,
    events: Value,
    tool_arguments: Value,
    result: Value,
}
#[test]
fn parser_bounds_are_errors_not_partial_success() {
    let oversized = "x".repeat(1024 * 1024 + 1);
    let nested = "[".repeat(65);
    for input in [
        &oversized,
        &nested,
        r#"{"value":"\uD800"}"#,
        r#"{"value":"\uDC00"}"#,
        "9007199254740993",
        "1e999",
        r#"{"nested":[9007199254740993]}"#,
        r#"[1e999,"#,
    ] {
        assert!(
            parse_streaming_json(input).is_err(),
            "must explicitly refuse: {:?}",
            &input[..input.len().min(80)]
        );
    }
    assert_eq!(
        parse_json_with_repair(r#"{"value":"\uD83D\uDE00"}"#).unwrap(),
        json!({"value":"😀"})
    );
    assert_eq!(
        parse_json_with_repair(r#"{"value":"\\uD800"}"#).unwrap(),
        json!({"value":r"\uD800"})
    );
}

fn corpus() -> Corpus {
    serde_json::from_str(include_str!("fixtures/anthropic-json.json")).unwrap()
}

#[test]
fn node_json_utilities_are_the_only_expected_value_source() {
    let cases = corpus().values;
    assert_eq!(cases.len(), 331);
    for case in cases {
        assert_eq!(
            repair_json(&case.input).unwrap(),
            case.repaired,
            "{} repair: {:?}",
            case.id,
            case.input
        );
        let parsed = match parse_json_with_repair(&case.input) {
            Ok(value) => json!({"ok":true,"value":value}),
            Err(_) => json!({"ok":false}),
        };
        assert_eq!(parsed, case.strict, "{} strict: {:?}", case.id, case.input);
        assert_eq!(
            parse_streaming_json(&case.input).unwrap(),
            case.streaming,
            "{} partial: {:?}",
            case.id,
            case.input
        );
    }
}

#[test]
fn actual_node_streams_match_rust_library_and_cli_including_each_tool_argument_update() {
    let cases = corpus().streams;
    assert_eq!(cases.len(), 17);
    for case in cases {
        let input: Input = serde_json::from_value(case.input.clone()).unwrap();
        assert_eq!(
            build_request(&input).unwrap(),
            case.request,
            "{} request",
            case.id
        );
        let actual = replay(
            &input.model,
            &case.chunks,
            case.abort.then_some(0).or(case.abort_after_chunks),
        )
        .unwrap();
        assert_eq!(actual.events, case.events, "{} events", case.id);
        assert_eq!(actual.result, case.result, "{} result", case.id);
        assert_eq!(
            actual.tool_arguments, case.tool_arguments,
            "{} snapshots",
            case.id
        );
        let mut child = Command::new(env!("CARGO_BIN_EXE_replay-anthropic"))
            .env_clear()
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let payload = json!({"input":case.input,"chunks":case.chunks,"abort":case.abort,"abortAfterChunks":case.abort_after_chunks,"observeToolArguments":true});
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
            json!({"request":case.request,"events":case.events,"result":case.result,"toolArguments":case.tool_arguments}),
            "{} CLI",
            case.id
        );
    }
}
