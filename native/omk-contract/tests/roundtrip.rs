use omk_contract::session::{FileEntry, SessionEntryBase};
use omk_contract::session_jsonl::SessionRecord;
use omk_contract::session_message::{KnownMessage, SessionMessage};
use serde_json::{Value, json};
use std::fs;
use std::path::Path;

fn record(line: &str) -> SessionRecord {
    serde_json::from_str(line).expect("valid typed session record")
}

fn assert_roundtrip(line: &str) -> SessionRecord {
    let decoded = record(line);
    assert_eq!(serde_json::to_string(&decoded).unwrap(), line);
    let typed = serde_json::to_value(decoded.entry()).unwrap();
    assert_eq!(typed, serde_json::from_str::<Value>(line).unwrap());
    decoded
}

fn entry(kind: Value) -> Value {
    let mut base = json!({"id":"entry-1","parentId":null,"timestamp":"2026-11-10T00:00:00Z"});
    base.as_object_mut()
        .unwrap()
        .extend(kind.as_object().unwrap().clone());
    base
}

#[test]
fn session_g0_jsonl_roundtrips_every_record_byte_for_byte() {
    let source = include_str!("fixtures/g0/session.jsonl");
    let mut encoded = String::new();
    let mut headers = 0;
    let mut messages = 0;
    let mut custom = 0;
    for line in source.lines() {
        let parsed = assert_roundtrip(line);
        match parsed.entry() {
            FileEntry::Session { version, .. } => {
                headers += 1;
                assert_eq!(version.as_ref().unwrap().as_u64(), Some(3));
            }
            FileEntry::Message { message, .. } => {
                messages += 1;
                assert!(matches!(message, SessionMessage::Known(_)));
            }
            FileEntry::Custom { .. } => custom += 1,
            other => panic!("unexpected G0 entry: {other:?}"),
        }
        encoded.push_str(&serde_json::to_string(&parsed).unwrap());
        encoded.push('\n');
    }
    assert_eq!((headers, messages, custom), (1, 14, 9));
    assert_eq!(encoded.as_bytes(), source.as_bytes());
}

#[test]
fn session_archived_entry_projections_roundtrip_with_explicit_timestamp_normalization() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/session-equivalence");
    let mut scenarios = 0;
    let mut entries = 0;
    let mut metrics_only = 0;
    for path in fs::read_dir(dir).unwrap().map(|e| e.unwrap().path()) {
        assert_eq!(path.extension().unwrap(), "json");
        let fixture: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        if path.file_name().unwrap() == "spec103b-trace.json" {
            assert!(fixture["trace"].get("entries").is_none());
            metrics_only += 1;
            continue;
        }
        let trace = fixture["trace"]["entries"]
            .as_array()
            .expect("session trace entries");
        assert!(!trace.is_empty());
        scenarios += 1;
        for source in trace {
            let mut replay = source.clone();
            // These archived goldens replace numeric message timestamps with "<T>".
            // Never admit that sentinel into the production contract or rewrite a golden.
            if let Some(message) = replay.get_mut("message") {
                assert_eq!(message["timestamp"], "<T>");
                message["timestamp"] = json!(0);
            }
            assert_roundtrip(&serde_json::to_string(&replay).unwrap());
            entries += 1;
        }
    }
    assert_eq!((scenarios, entries, metrics_only), (6, 22, 1));
}

#[test]
fn session_all_nine_entry_variants_preserve_typed_and_opaque_fields() {
    let kinds = [
        json!({"type":"message","message":{"role":"user","content":"hello","timestamp":1}}),
        json!({"type":"thinking_level_change","thinkingLevel":"extension-level"}),
        json!({"type":"model_change","provider":"extension-provider","modelId":"model"}),
        json!({"type":"compaction","summary":"summary","firstKeptEntryId":"kept","tokensBefore":4,"details":{"schemaVersion":2},"fromHook":true}),
        json!({"type":"branch_summary","summary":"branch","fromId":"source","details":null,"fromHook":false}),
        json!({"type":"custom","customType":"extension-state","data":[null,{"nested":true}]}),
        json!({"type":"custom_message","customType":"extension-context","content":[{"type":"image","data":"AA==","mimeType":"image/png"}],"display":false,"details":null}),
        json!({"type":"label","targetId":"target"}),
        json!({"type":"session_info","name":"synthetic"}),
    ];
    for kind in kinds {
        let mut value = entry(kind);
        value["futureField"] = json!({"unknown":[1,null,true]});
        let typed: FileEntry = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(&typed).unwrap(), value);
        let built = SessionRecord::from_entry(typed).unwrap();
        assert_roundtrip(&serde_json::to_string(&built).unwrap());
    }
}

#[test]
fn session_header_optional_fields_and_required_nullable_parent_are_distinct() {
    for line in [
        r#"{"type":"session","id":"s","timestamp":"iso","cwd":"<repo>"}"#,
        r#"{"type":"session","version":3,"id":"s","timestamp":"iso","cwd":"<repo>","parentSession":"relative.jsonl","future":true}"#,
    ] {
        assert_roundtrip(line);
    }
    let base: SessionEntryBase =
        serde_json::from_value(json!({"id":"e","parentId":null,"timestamp":"iso"})).unwrap();
    assert!(base.parent_id.is_none());
    assert!(
        serde_json::from_value::<SessionEntryBase>(json!({"id":"e","timestamp":"iso"})).is_err()
    );
    let null_data = entry(json!({"type":"custom","customType":"x","data":null}));
    let typed: FileEntry = serde_json::from_value(null_data.clone()).unwrap();
    assert_eq!(serde_json::to_value(typed).unwrap(), null_data);
}

#[test]
fn session_message_roles_content_and_provider_metadata_roundtrip() {
    let usage = json!({"input":1,"output":2,"cacheRead":0,"cacheWrite":0,"cacheWrite1h":0,"cacheWriteUnknown":true,"totalTokens":3,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0,"billed":0.1},"future":true});
    let messages = [
        json!({"role":"user","content":[{"type":"text","text":"한글","textSignature":"signature"},{"type":"image","data":"AA==","mimeType":"image/png"}],"timestamp":1.25}),
        json!({"role":"assistant","content":[{"type":"thinking","thinking":"redacted","thinkingSignature":"opaque","redacted":true},{"type":"toolCall","id":"t","name":"echo","arguments":{"text":"hello"},"thoughtSignature":"opaque"}],"api":"extension-api","provider":"extension","model":"m","usage":usage,"stopReason":"toolUse","responseId":"r","responseModel":"actual","diagnostics":[],"errorMessage":"synthetic","timestamp":2}),
        json!({"role":"toolResult","toolCallId":"t","toolName":"echo","content":[],"isError":false,"details":null,"timestamp":3}),
        json!({"role":"bashExecution","command":"echo synthetic","output":"synthetic","cancelled":false,"truncated":true,"fullOutputPath":"<tmp>/output","excludeFromContext":true,"timestamp":4}),
        json!({"role":"custom","customType":"x","content":"synthetic","display":false,"details":null,"timestamp":5}),
        json!({"role":"branchSummary","summary":"synthetic","fromId":"e","timestamp":6}),
        json!({"role":"compactionSummary","summary":"synthetic","tokensBefore":7,"timestamp":7}),
        json!({"role":"extensionRole","payload":{"anything":true}}),
    ];
    for mut message in messages {
        message["futureMessageField"] = json!({"retained":true});
        let decoded: SessionMessage = serde_json::from_value(message.clone()).unwrap();
        assert_eq!(serde_json::to_value(decoded).unwrap(), message);
        assert_roundtrip(
            &serde_json::to_string(&entry(json!({"type":"message","message":message}))).unwrap(),
        );
    }
    let msg: SessionMessage =
        serde_json::from_value(json!({"role":"user","content":"text","timestamp":0})).unwrap();
    assert!(matches!(
        msg,
        SessionMessage::Known(known) if matches!(*known, KnownMessage::User { .. })
    ));
}

#[test]
fn session_lossless_record_preserves_order_numbers_escapes_and_nested_extension_data() {
    let line = r#"{"customType":"x","data":{"z":1e-7,"a":9007199254740993,"nested":{"b":2,"a":"\u0061"}},"type":"custom","timestamp":"iso","parentId":null,"id":"e","future":-0.0}"#;
    let parsed = record(line);
    assert_eq!(serde_json::to_string(&parsed).unwrap(), line);
    let mut typed = parsed.into_entry();
    if let FileEntry::Custom { custom_type, .. } = &mut typed {
        *custom_type = "changed".into();
    }
    let changed = SessionRecord::from_entry(typed).unwrap();
    assert_eq!(
        serde_json::to_value(changed).unwrap()["customType"],
        "changed"
    );
}

#[test]
fn session_assistant_usage_stop_reason_and_optional_fields_are_checked() {
    let source: Value = include_str!("fixtures/g0/session.jsonl")
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        .find(|entry| entry["message"]["role"] == "assistant")
        .unwrap();
    for reason in ["stop", "length", "toolUse", "error", "aborted"] {
        let mut value = source.clone();
        value["message"]["stopReason"] = json!(reason);
        assert_roundtrip(&serde_json::to_string(&value).unwrap());
    }
    for (pointer, invalid) in [
        ("/message/usage/cacheWriteUnknown", json!(false)),
        ("/message/stopReason", json!("future")),
        ("/message/usage/cost", Value::Null),
        ("/message/content/0/arguments", json!([])),
        ("/message/responseId", Value::Null),
    ] {
        let mut value = source.clone();
        let parent = pointer.rsplit_once('/').unwrap();
        value.pointer_mut(parent.0).unwrap()[parent.1] = invalid;
        assert!(
            serde_json::from_str::<SessionRecord>(&serde_json::to_string(&value).unwrap()).is_err()
        );
    }
}

#[test]
fn session_invalid_shapes_never_fall_back_to_opaque_extensions() {
    for line in ["null", "[]", "{}", "{", r#"{"type":"future","id":"e"}"#] {
        assert!(
            serde_json::from_str::<SessionRecord>(line).is_err(),
            "{line}"
        );
    }
    let valid =
        entry(json!({"type":"message","message":{"role":"user","content":"x","timestamp":0}}));
    let mut invalid = Vec::new();
    for field in ["id", "parentId", "timestamp", "message"] {
        let mut value = valid.clone();
        value.as_object_mut().unwrap().remove(field);
        invalid.push(value);
    }
    for message in [
        json!({"role":"user","content":"x","timestamp":"<T>"}),
        json!({"role":"assistant","content":[],"timestamp":0}),
        json!({"role":"toolResult","content":[],"timestamp":0}),
        json!({"role":"user","content":[{"type":"thinking","thinking":"no"}],"timestamp":0}),
        json!({"role":"user","content":null,"timestamp":0}),
        json!({"role":8}),
    ] {
        invalid.push(entry(json!({"type":"message","message":message})));
    }
    invalid.push(entry(
        json!({"type":"custom_message","customType":"x","content":"x","display":"false"}),
    ));
    invalid.push(entry(
        json!({"type":"compaction","summary":"s","firstKeptEntryId":"e","tokensBefore":"1"}),
    ));
    for value in invalid {
        assert!(
            serde_json::from_str::<SessionRecord>(&serde_json::to_string(&value).unwrap()).is_err(),
            "{value}"
        );
    }
    let duplicate = r#"{"type":"session","id":"a","id":"b","timestamp":"iso","cwd":"<repo>"}"#;
    assert!(serde_json::from_str::<SessionRecord>(duplicate).is_err());
}

#[path = "support/rpc_roundtrip.rs"]
mod rpc_roundtrip;
