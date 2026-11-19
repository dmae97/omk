#[path = "rpc_cases.rs"]
mod rpc_cases;
#[path = "rpc_event_cases.rs"]
mod rpc_event_cases;
use omk_contract::rpc::{CommandBody, RpcCommand, RpcInput, RpcMessage, RpcOutput, RpcRecord};
use rpc_cases::{commands, response, ui_requests};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

fn roundtrip(value: Value) {
    let source = serde_json::to_string(&value).unwrap();
    let typed: RpcMessage = serde_json::from_str(&source).expect("valid typed RPC shape");
    assert_eq!(serde_json::to_value(&typed).unwrap(), value);
    let record: RpcRecord = serde_json::from_str(&source).unwrap();
    assert_eq!(serde_json::to_string(&record).unwrap(), source);
    let rebuilt = RpcRecord::from_entry(typed).unwrap();
    assert_eq!(serde_json::to_value(rebuilt).unwrap(), value);
}
fn invalid(value: Value) {
    assert!(
        serde_json::from_str::<RpcRecord>(&serde_json::to_string(&value).unwrap()).is_err(),
        "{value}"
    );
}

#[test]
fn rpc_transcript_all_35_rows_roundtrip_byte_identically_with_direction_checks() {
    #[derive(Serialize, Deserialize)]
    struct Row {
        direction: String,
        message: RpcRecord,
    }
    let source = include_str!("../fixtures/rpc-transcript.jsonl");
    let mut output = String::new();
    let mut incoming = 0;
    let mut outgoing = 0;
    for line in source.lines() {
        let row: Row = serde_json::from_str(line).unwrap();
        let message = serde_json::to_string(&row.message).unwrap();
        match row.direction.as_str() {
            "in" => {
                incoming += 1;
                assert!(serde_json::from_str::<RpcInput>(&message).is_ok());
                assert!(serde_json::from_str::<RpcOutput>(&message).is_err());
            }
            "out" => {
                outgoing += 1;
                assert!(serde_json::from_str::<RpcOutput>(&message).is_ok());
                assert!(serde_json::from_str::<RpcInput>(&message).is_err());
            }
            other => panic!("unexpected direction {other}"),
        }
        assert_eq!(serde_json::to_string(&row).unwrap(), line);
        assert_eq!(
            serde_json::to_value(row.message.entry()).unwrap(),
            serde_json::from_str::<Value>(&message).unwrap()
        );
        output.push_str(&serde_json::to_string(&row).unwrap());
        output.push('\n');
    }
    assert_eq!((incoming, outgoing), (4, 31));
    assert_eq!(output.as_bytes(), source.as_bytes());
}

#[test]
fn rpc_all_commands_match_current_typescript_discriminants_and_all_responses() {
    let source = include_str!("../../../../packages/coding-agent/src/modes/rpc/rpc-types.ts");
    let body = source
        .split("export const RPC_COMMAND_BODY_SCHEMA")
        .nth(1)
        .unwrap()
        .split("export const RPC_COMMAND_SCHEMA")
        .next()
        .unwrap();
    let mut expected: Vec<_> = body
        .split("type: Type.Literal(\"")
        .skip(1)
        .map(|s| s.split('"').next().unwrap().to_string())
        .collect();
    let mut seen = Vec::new();
    for mut command in commands() {
        let name = command["type"].as_str().unwrap().to_string();
        seen.push(name.clone());
        command["id"] = json!("request");
        command["futureField"] = json!({"retained":true});
        roundtrip(command);
        roundtrip(response(&name));
        roundtrip(json!({"type":"response","command":name,"success":false,"error":"synthetic"}));
    }
    seen.sort();
    expected.sort();
    assert_eq!(seen.len(), 29);
    assert_eq!(seen, expected);
    for level in [
        "off", "minimal", "low", "medium", "high", "xhigh", "max", "ultra",
    ] {
        roundtrip(json!({"type":"set_thinking_level","level":level}));
    }
    for name in ["cycle_model", "cycle_thinking_level"] {
        roundtrip(json!({"type":"response","command":name,"success":true,"data":null}));
    }
    roundtrip(
        json!({"type":"response","command":"future-or-parse-error","success":false,"error":"synthetic","termination":rpc_cases::termination()}),
    );
    roundtrip(json!({"type":"prompt","message":""}));
}

#[test]
fn rpc_ui_requests_and_response_union_preserve_undefined_and_false() {
    let source = include_str!("../../../../packages/coding-agent/src/modes/rpc/rpc-types.ts");
    let mut expected: Vec<_> = source
        .split("export type RpcExtensionUIRequest")
        .nth(1)
        .unwrap()
        .split("method: \"")
        .skip(1)
        .map(|s| s.split('"').next().unwrap())
        .collect();
    let requests = ui_requests();
    let mut methods: Vec<_> = requests
        .iter()
        .map(|r| r["method"].as_str().unwrap())
        .collect();
    expected.sort();
    methods.sort();
    assert_eq!(methods, expected);
    assert_eq!(ui_requests().len(), 9);
    for request in ui_requests() {
        roundtrip(request);
    }
    for fields in [
        json!({"value":""}),
        json!({"confirmed":false}),
        json!({"cancelled":true}),
        json!({"value":"x","confirmed":false,"cancelled":true}),
    ] {
        let mut value = json!({"type":"extension_ui_response","id":"ui"});
        value
            .as_object_mut()
            .unwrap()
            .extend(fields.as_object().unwrap().clone());
        roundtrip(value);
    }
    for fields in [
        json!({}),
        json!({"cancelled":false}),
        json!({"value":null}),
        json!({"confirmed":"false"}),
        json!({"value":"yes","cancelled":false}),
        json!({"value":"yes","confirmed":1}),
    ] {
        let mut value = json!({"type":"extension_ui_response","id":"ui"});
        value
            .as_object_mut()
            .unwrap()
            .extend(fields.as_object().unwrap().clone());
        invalid(value);
    }
    invalid(json!({"type":"extension_ui_response","value":"x"}));
}

#[test]
fn rpc_session_events_and_all_stream_variants_roundtrip() {
    for mut event in rpc_event_cases::events()
        .into_iter()
        .chain(rpc_event_cases::stream_events())
    {
        event["futureField"] = json!({"opaque":null});
        roundtrip(event);
    }
}

#[test]
fn rpc_invalid_envelopes_commands_and_responses_fail_typed_validation() {
    for value in [
        Value::Null,
        json!([]),
        json!(1),
        json!({}),
        json!({"type":"future"}),
        json!({"id":3,"type":"get_state"}),
        json!({"type":"prompt"}),
        json!({"type":"prompt","message":3}),
        json!({"type":"prompt","message":"x","images":[{"type":"text","text":"x"}]}),
        json!({"type":"compact","customInstructions":null}),
        json!({"type":"set_thinking_level","level":"invalid"}),
        json!({"type":"set_auto_retry","enabled":"false"}),
        json!({"type":"set_model","provider":"x"}),
        json!({"type":"fork","entryId":false}),
        json!({"type":"set_follow_up_mode","mode":"other"}),
        json!({"type":"response","command":"prompt","success":"true"}),
        json!({"type":"response","command":"future","success":true}),
        json!({"type":"response","command":"get_state","success":true}),
        json!({"type":"response","command":"prompt","success":false}),
        json!({"type":"response","command":"cycle_model","success":true}),
        json!({"type":"response","command":"get_last_assistant_text","success":true,"data":{}}),
        json!({"type":"prompt_settled","promptRunId":"p","outcome":"completed","durationMs":"<ms>"}),
        json!({"type":"summarization_retry_attempt_start","source":"compaction"}),
        json!({"type":"extension_ui_request","id":"ui","method":"confirm","title":"x"}),
    ] {
        invalid(value);
    }
    let mut state = response("get_state");
    state["data"]["isStreaming"] = json!("false");
    invalid(state);
    let mut msg = response("get_messages");
    msg["data"]["messages"][0]["usage"] = Value::Null;
    invalid(msg);
    let mut event = rpc_event_cases::stream_events()[0].clone();
    event["assistantMessageEvent"]["partial"]["role"] = json!("user");
    invalid(event);
}

#[test]
fn rpc_raw_records_preserve_nested_lexemes_and_revalidate_typed_changes() {
    let line = r#"{"message":"\u0061","future":{"z":1e-7,"a":-0.0},"type":"prompt"}"#;
    let record: RpcRecord = serde_json::from_str(line).unwrap();
    assert_eq!(serde_json::to_string(&record).unwrap(), line);
    let mut typed = record.into_entry();
    if let RpcMessage::Input(RpcInput::Command(command)) = &mut typed {
        if let CommandBody::Prompt { message, .. } = &mut command.body.body {
            *message = "changed".into();
        } else {
            panic!("expected prompt");
        }
    } else {
        panic!("expected command");
    }
    let changed = RpcRecord::from_entry(typed).unwrap();
    assert_eq!(serde_json::to_value(changed).unwrap()["message"], "changed");
    let mut command: RpcCommand = serde_json::from_value(json!({"type":"get_state"})).unwrap();
    command.extra.insert("type".into(), json!("abort"));
    assert!(serde_json::to_string(&command).is_err());
    assert!(serde_json::from_str::<RpcRecord>(r#"{"type":"get_state","type":"abort"}"#).is_err());
}
