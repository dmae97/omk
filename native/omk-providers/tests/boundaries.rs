use omk_providers::anthropic::{Input, build_request, replay};
use serde_json::{Value, json};
use std::{
    io::Write,
    process::{Command, Stdio},
};

#[test]
fn replay_refuses_unknown_models_invalid_cancel_and_resource_overflow() {
    assert!(replay("unrecorded", &[], None).is_err());
    assert!(replay("synthetic-anthropic", &[], Some(1)).is_err());
    assert!(replay("synthetic-anthropic", &[vec![0; 8 * 1024 * 1024 + 1]], None).is_err());
    let oversized = replay("synthetic-anthropic", &[vec![b'x'; 1024 * 1024 + 1]], None).unwrap();
    assert_eq!(oversized.result["stopReason"], "error");
    assert_eq!(oversized.events.as_array().unwrap().len(), 2);
    assert_eq!(oversized.result["errorMessage"], "SSE buffer exceeds 1 MiB");
}

#[test]
fn invalid_usage_is_an_error_not_a_panic_or_success() {
    let frame = b"event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"id\":\"synthetic\",\"usage\":{\"input_tokens\":18446744073709551615}}}\n\n";
    let output = replay("synthetic-anthropic", &[frame.to_vec()], None).unwrap();
    assert_eq!(output.result["stopReason"], "error");
    assert_eq!(output.result["errorMessage"], "invalid usage: input_tokens");
}

#[test]
fn request_rejects_unknown_input_and_preserves_schema_order_and_string_spaces() {
    let mut input =
        json!({"model":"synthetic-anthropic","maxTokens":1,"system":"","user":"hello", "tools":[]});
    input["apiKey"] = json!("synthetic-unused");
    assert!(serde_json::from_value::<Input>(input).is_err());
    let input: Input = serde_json::from_str(r#"{
      "model":"synthetic-anthropic","maxTokens":1,"system":"","user":"hello", "tools":[{
        "name":"t","description":"d","properties":{ "z": { "description": "space \\\" quote" }, "a": { "type": "string" } },"required":["z"]
      }]
    }"#).unwrap();
    let request = build_request(&input).unwrap();
    let body = request["body"].as_str().unwrap();
    assert!(body.find("\"z\"").unwrap() < body.find("\"a\"").unwrap());
    let parsed: Value = serde_json::from_str(body).unwrap();
    assert_eq!(
        parsed["tools"][0]["input_schema"]["properties"]["z"]["description"],
        "space \\\" quote"
    );
}

#[test]
fn cli_refuses_oracle_fields_instead_of_echoing_them() {
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
        .write_all(br#"{"result":{"stopReason":"stop"}}"#)
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
    assert!(String::from_utf8_lossy(&output.stderr).contains("unknown field"));
}
