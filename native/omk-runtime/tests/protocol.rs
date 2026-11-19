mod support;

use omk_native_wire::protocol::{MAX_SAFE_INTEGER, Request, parse_request};
use support::{identity, request};

fn rejects(text: &str) {
    assert!(parse_request(text.as_bytes()).is_err(), "{text}");
}

#[test]
fn accepts_typed_hello_execute_and_max_safe_integer_identity() {
    assert!(matches!(
        parse_request(request("hello", 1, &identity()).as_bytes()).unwrap(),
        Request::Hello(_)
    ));
    let id = identity().replace(
        "\"generation\":1",
        &format!("\"generation\":{MAX_SAFE_INTEGER}"),
    );
    assert!(matches!(
        parse_request(request("execute", 2, &id).as_bytes()).unwrap(),
        Request::Execute(_)
    ));
}

#[test]
fn rejects_arrays_at_top_data_and_identity_positions() {
    let id = identity();
    for kind in ["hello", "execute"] {
        rejects(&format!(r#"["{kind}",{{"identity":{id},"controlSeq":1}}]"#));
        rejects(&format!(r#"{{"type":"{kind}","data":[{id},1]}}"#));
        rejects(&request(
            kind,
            1,
            r#"["omk.native-agent.v1","launch","session","prompt","tool","scope",1,1,"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]"#,
        ));
        rejects(&request(kind, 1, "[]"));
    }
}

#[test]
fn rejects_unknown_fields_at_all_containers_and_wrong_message_tags() {
    let hello = request("hello", 1, &identity());
    rejects(&hello.replacen('{', "{\"extra\":false,", 1));
    rejects(&hello.replace("\"data\":{", "\"data\":{\"extra\":false,"));
    rejects(&hello.replace("\"identity\":{", "\"identity\":{\"extra\":false,"));
    for kind in ["ready", "result", "progress", "Hello", ""] {
        rejects(&request(kind, 1, &identity()));
    }
}

#[test]
fn rejects_duplicates_including_escaped_equivalent_keys_and_repeated_tags() {
    let hello = request("hello", 1, &identity());
    for (old, new) in [
        (
            "\"type\":\"hello\"",
            "\"type\":\"hello\",\"type\":\"hello\"",
        ),
        (
            "\"type\":\"hello\"",
            "\"type\":\"hello\",\"type\":\"execute\"",
        ),
        (
            "\"type\":\"hello\"",
            "\"type\":\"hello\",\"t\\u0079pe\":\"hello\"",
        ),
        ("\"data\":{", "\"data\":{},\"data\":{"),
        ("\"identity\":{", "\"identity\":{},\"identity\":{"),
        ("\"controlSeq\":1", "\"controlSeq\":1,\"controlSeq\":1"),
        (
            "\"controlSeq\":1",
            "\"controlSeq\":1,\"controlSe\\u0071\":1",
        ),
        (
            "\"version\":\"omk.native-agent.v1\"",
            "\"version\":\"omk.native-agent.v1\",\"version\":\"omk.native-agent.v1\"",
        ),
        (
            "\"launchId\":\"launch\"",
            "\"launchId\":\"launch\",\"launch\\u0049d\":\"launch\"",
        ),
    ] {
        rejects(&hello.replace(old, new));
    }
}

#[test]
fn rejects_valid_duplicate_containers_and_all_identity_keys_in_both_tag_orders() {
    let id = identity();
    let data = format!(r#"{{"identity":{id},"controlSeq":1}}"#);
    for kind in ["hello", "execute"] {
        rejects(&format!(
            r#"{{"type":"{kind}","data":{data},"data":{data}}}"#
        ));
        rejects(&format!(
            r#"{{"type":"{kind}","data":{data},"d\u0061ta":{data}}}"#
        ));
        let ordinary = request(kind, 1, &id);
        let data_first = format!(r#"{{"data":{data},"type":"{kind}"}}"#);
        for text in [&ordinary, &data_first] {
            assert!(parse_request(text.as_bytes()).is_ok());
            rejects(&text.replace(
                &format!(r#""identity":{id}"#),
                &format!(r#""identity":{id},"identity":{id}"#),
            ));
            for member in [
                r#""version":"omk.native-agent.v1""#.to_string(),
                r#""launchId":"launch""#.to_string(),
                r#""sessionId":"session""#.to_string(),
                r#""promptId":"prompt""#.to_string(),
                r#""toolCallId":"tool""#.to_string(),
                r#""scopeEpochId":"scope""#.to_string(),
                r#""generation":1"#.to_string(),
                r#""attempt":1"#.to_string(),
                format!(r#""grantDigest":"{}""#, "a".repeat(64)),
            ] {
                rejects(&text.replace(&member, &format!("{member},{member}")));
            }
            rejects(&text.replace(
                r#""launchId":"launch""#,
                r#""launchId":"launch","launch\u0049d":"launch""#,
            ));
        }
    }
}

#[test]
fn rejects_invalid_numbers_in_every_numeric_field() {
    let hello = request("hello", 1, &identity());
    for key in ["generation", "attempt", "controlSeq"] {
        for bad in [
            "0",
            "-1",
            "1.0",
            "1e0",
            "9007199254740992",
            "18446744073709551616",
            "1e999",
            "NaN",
            "null",
            "true",
            "\"1\"",
        ] {
            rejects(&hello.replace(&format!("\"{key}\":1"), &format!("\"{key}\":{bad}")));
        }
    }
}

#[test]
fn enforces_exact_version_digest_and_utf8_id_byte_bounds() {
    let hello = request("hello", 1, &identity());
    rejects(&hello.replace("omk.native-agent.v1", "omk.native-agent.v2"));
    for bad in [
        "a".repeat(63),
        "a".repeat(65),
        "A".repeat(64),
        "g".repeat(64),
    ] {
        rejects(&hello.replace(&"a".repeat(64), &bad));
    }
    for (key, value) in [
        ("launchId", "launch"),
        ("sessionId", "session"),
        ("promptId", "prompt"),
        ("toolCallId", "tool"),
        ("scopeEpochId", "scope"),
    ] {
        let field = format!("\"{key}\":\"{value}\"");
        for bad in ["".to_string(), "x".repeat(129), "é".repeat(65)] {
            rejects(&hello.replace(&field, &format!("\"{key}\":\"{bad}\"")));
        }
        let valid = hello.replace(&field, &format!("\"{key}\":\"{}\"", "é".repeat(64)));
        assert!(parse_request(valid.as_bytes()).is_ok());
    }
}

#[test]
fn rejects_missing_fields_nulls_wrong_types_trailing_values_and_deep_unknowns() {
    for bad in [
        "",
        "{}",
        "null",
        "true",
        "42",
        "{",
        r#"{"type":"hello"}"#,
        r#"{"data":{}}"#,
        r#"{"type":"hello","data":null}"#,
    ] {
        rejects(bad);
    }
    let hello = request("hello", 1, &identity());
    rejects(&(hello.clone() + "{}"));
    rejects(&hello.replace("\"launch\"", "null"));
    rejects(&hello.replace("\"launch\"", "[\"launch\"]"));
    rejects(&hello.replace("\"attempt\":1,", ""));
    rejects(&hello.replace(",\"controlSeq\":1", ""));
    rejects(&hello.replace(
        "\"data\":{",
        &format!(
            "\"data\":{{\"extra\":{}0{},",
            "[".repeat(150),
            "]".repeat(150)
        ),
    ));
}
