use omk_execution_host::protocol::{Control, Start, frame};
use std::io::Cursor;

fn request() -> serde_json::Value {
    serde_json::json!({"version":1,"requestId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","workspace":"/tmp",
        "argv":["/bin/true"],"writable":false,"timeoutMs":100,"cleanupMs":100,"maxOutputBytes":1024})
}

#[test]
fn refuses_non_objects_and_unterminated_or_oversized_frames() {
    for input in [b"[]\n".as_slice(), b"{}", b"{}\r\n", b"\n", b"{     }\n"] {
        assert!(frame(&mut Cursor::new(input), 6).is_err());
    }
    assert_eq!(
        frame(&mut Cursor::new(b"{}\n"), 3).expect("frame"),
        Some(b"{}\n".to_vec())
    );
}

#[test]
fn exact_start_schema_rejects_unknown_and_duplicate_fields() {
    let mut value = request();
    value["approve"] = true.into();
    assert!(serde_json::from_value::<Start>(value).is_err());
    let duplicate =
        serde_json::to_string(&request())
            .expect("json")
            .replacen('{', "{\"version\":1,", 1);
    assert!(serde_json::from_str::<Start>(&duplicate).is_err());
    assert!(
        serde_json::from_str::<Control>(r#"{"type":"commit","requestId":"a","requestId":"b"}"#)
            .is_err()
    );
}

#[test]
fn accepts_a_boot_bound_phase_deadline_without_loosening_the_schema() {
    let mut input = request();
    input["phaseDeadline"] = serde_json::json!({
        "bootId": "0123abcd-0000-4000-8000-00000000beef", "deadlineMs": 1000
    });
    assert!(
        serde_json::from_value::<Start>(input.clone())
            .expect("clock-bound input")
            .validate()
            .is_ok()
    );
    for value in [
        serde_json::json!(0),
        serde_json::json!(9007199254740992_u64),
    ] {
        input["phaseDeadline"]["deadlineMs"] = value;
        assert!(
            serde_json::from_value::<Start>(input.clone())
                .expect("typed clock")
                .validate()
                .is_err()
        );
    }
    input["phaseDeadline"]["deadlineMs"] = serde_json::json!(1000);
    input["phaseDeadline"]["approve"] = serde_json::json!(true);
    assert!(serde_json::from_value::<Start>(input).is_err());
}

#[test]
fn rejects_invalid_bounds_and_executable_shapes_before_spawn() {
    for (field, value) in [
        ("version", serde_json::json!(2)),
        ("requestId", serde_json::json!("wrong")),
        ("workspace", serde_json::json!(".")),
        ("workspace", serde_json::json!("/")),
        ("argv", serde_json::json!([])),
        ("argv", serde_json::json!(["sh"])),
        ("argv", serde_json::json!(["/bin/true", "\u{0}"])),
        ("timeoutMs", serde_json::json!(0)),
        ("cleanupMs", serde_json::json!(60_001)),
        ("maxOutputBytes", serde_json::json!(16_777_217)),
        ("detachable", serde_json::json!(true)),
        ("recordDir", serde_json::json!("relative")),
        ("bindingDigest", serde_json::json!("short")),
        ("bindingDigest", serde_json::json!("F".repeat(64))),
        ("witnessDir", serde_json::json!("/nonexistent-omk-dir")),
    ] {
        let mut input = request();
        input[field] = value;
        assert!(
            serde_json::from_value::<Start>(input)
                .expect("typed input")
                .validate()
                .is_err(),
            "{field}"
        );
    }
    assert!(
        serde_json::from_value::<Start>(request())
            .expect("valid input")
            .validate()
            .is_ok()
    );
}
