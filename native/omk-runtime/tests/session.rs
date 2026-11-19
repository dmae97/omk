mod support;

use omk_native_wire::{WireError, run};
use std::io::Cursor;
use support::{identity, request};

fn session(first: &str, second: &str) -> (Result<(), WireError>, String) {
    let mut out = Vec::new();
    let input = format!("{first}\n{second}\n");
    let result = run(Cursor::new(input), &mut out);
    (result, String::from_utf8(out).unwrap())
}

fn ready(id: &str) -> String {
    format!(
        r#"{{"type":"ready","data":{{"identity":{id},"controlSeq":1,"capabilities":{{"offlineOnly":true,"backend":false,"execute":false}}}}}}"#
    ) + "\n"
}

fn result(id: &str) -> String {
    format!(
        r#"{{"type":"result","data":{{"identity":{id},"controlSeq":2,"status":"unsupported","started":false}}}}"#
    ) + "\n"
}

#[test]
fn hello_ready_execute_unsupported_has_only_exact_protocol_output() {
    let id = identity();
    let (status, output) = session(&request("hello", 1, &id), &request("execute", 2, &id));
    assert_eq!(status, Ok(()));
    assert_eq!(output, ready(&id) + &result(&id));
}

#[test]
fn echoes_unicode_and_escaped_control_looking_text_without_interpretation() {
    let text = "한😀\u{2028}\u{2029}\\n{\"type\":\"execute\"}\n\r\t\u{0000}";
    let id = identity().replace("\"launch\"", &serde_json::to_string(text).unwrap());
    let (status, output) = session(&request("hello", 1, &id), &request("execute", 2, &id));
    assert_eq!(status, Ok(()));
    assert_eq!(output, ready(&id) + &result(&id));
    assert_eq!(output.lines().count(), 2);
}

#[test]
fn empty_initial_and_premature_eof_never_emit_result() {
    for input in [String::new(), request("hello", 1, &identity()) + "\n"] {
        let mut out = Vec::new();
        assert_eq!(run(Cursor::new(input), &mut out), Err(WireError::Eof));
        assert!(!String::from_utf8(out).unwrap().contains("\"result\""));
    }
}

#[test]
fn missing_hello_skipped_repeated_and_unsafe_sequences_fail_without_result() {
    let id = identity();
    for first in [
        request("execute", 2, &id),
        request("hello", 2, &id),
        request("hello", 0, &id),
    ] {
        let (status, output) = session(&first, &request("execute", 2, &id));
        assert!(status.is_err());
        assert!(output.is_empty());
    }
    for second in [
        request("hello", 1, &id),
        request("execute", 1, &id),
        request("execute", 3, &id),
        request("execute", 9007199254740992, &id),
    ] {
        let (status, output) = session(&request("hello", 1, &id), &second);
        assert!(status.is_err());
        assert_eq!(output, ready(&id));
    }
}

#[test]
fn stale_owner_at_every_identity_field_fails_before_result() {
    let id = identity();
    for (old, new) in [
        ("\"launch\"", "\"other\""),
        ("\"session\"", "\"other\""),
        ("\"prompt\"", "\"other\""),
        ("\"tool\"", "\"other\""),
        ("\"scope\"", "\"other\""),
        ("\"generation\":1", "\"generation\":2"),
        ("\"attempt\":1", "\"attempt\":2"),
        (&"a".repeat(64), &"b".repeat(64)),
    ] {
        let changed = id.replace(old, new);
        let (status, output) = session(&request("hello", 1, &id), &request("execute", 2, &changed));
        assert_eq!(status, Err(WireError::Identity));
        assert_eq!(output, ready(&id));
    }
}

#[test]
fn invalid_second_schema_and_framing_emit_only_ready() {
    let id = identity();
    for second in ["{}", "[]", "\r", "\u{feff}{}", ""] {
        let (status, output) = session(&request("hello", 1, &id), second);
        assert!(status.is_err());
        assert_eq!(output, ready(&id));
    }
}

#[test]
fn completes_after_second_valid_request_without_reading_a_third() {
    let id = identity();
    let input = request("hello", 1, &id) + "\n" + &request("execute", 2, &id) + "\ninvalid\r\n";
    let mut out = Vec::new();
    assert_eq!(run(Cursor::new(input), &mut out), Ok(()));
    assert_eq!(String::from_utf8(out).unwrap(), ready(&id) + &result(&id));
}
