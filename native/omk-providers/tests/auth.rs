use omk_providers::auth::{Error, KeySources, Snapshot, resolve_config};
use serde_json::{Value, json};
use std::{
    io::Write,
    process::{Command, Output, Stdio},
};

fn cli(input: &str) -> Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_replay-auth"))
        .env_clear()
        .env("SYN_KEY", "ambient-must-not-be-used")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(input.as_bytes())
        .unwrap();
    child.wait_with_output().unwrap()
}
fn sources<'a>(
    runtime: Option<&'a str>,
    environment: Option<&'a str>,
    fallback: Option<&'a str>,
) -> KeySources<'a> {
    KeySources {
        runtime,
        environment,
        fallback,
        include_fallback: true,
    }
}
#[test]
fn every_independent_node_case_matches_library_and_executable() {
    let corpus: Value = serde_json::from_str(include_str!("fixtures/auth.json")).unwrap();
    let cases = corpus["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 52);
    let mut mismatches = Vec::new();
    for case in cases {
        let input = &case["input"];
        let env = |name: &str| input["env"][name].as_str().map(String::from);
        let result = if let Some(config) = input["config"].as_str() {
            resolve_config(config, env)
        } else {
            let snapshot = Snapshot::from_json(if input["loadError"] == true {
                Err(())
            } else {
                Ok(input["store"].as_str())
            });
            let mut sources = sources(
                input["runtime"].as_str(),
                input["environment"].as_str(),
                input["fallback"].as_str(),
            );
            sources.include_fallback = input["includeFallback"].as_bool().unwrap_or(true);
            snapshot.resolve("anthropic", sources, env)
        };
        let actual = match result {
            Ok(key) => json!({"key":key.as_ref().map(|key| key.expose()),"blocked":false}),
            Err(Error::UnavailableStore) => json!({"key":null,"blocked":true}),
            Err(error) => panic!("{}: {error}", case["id"]),
        };
        if actual != case["expected"] {
            mismatches.push(format!("{} library: {actual}", case["id"]));
        }
        let output = cli(&input.to_string());
        assert!(
            output.status.success(),
            "{}: {}",
            case["id"],
            String::from_utf8_lossy(&output.stderr)
        );
        let actual: Value = serde_json::from_slice(&output.stdout).unwrap();
        if actual != case["expected"] {
            mismatches.push(format!("{} executable: {actual}", case["id"]));
        }
    }
    assert!(
        mismatches.is_empty(),
        "{} mismatches: {}",
        mismatches.len(),
        mismatches.join("\n")
    );
}
#[test]
fn secrets_are_redacted_and_host_only_policies_never_substitute_credentials() {
    let key = resolve_config("sensitive-marker", |_| None)
        .unwrap()
        .unwrap();
    assert_eq!(format!("{key:?}"), "[REDACTED]");
    assert_eq!(
        resolve_config("!echo sensitive-marker", |_| None).unwrap_err(),
        Error::CommandRequiresHost
    );
    for (text, expected) in [
        (
            r#"{"anthropic":{"type":"oauth","access":"sensitive-marker"}}"#,
            Error::OAuthRequiresHost,
        ),
        (
            r#"{"anthropic":{"type":"api_key","key":123}}"#,
            Error::InvalidCredential,
        ),
        (
            r#"{"anthropic":{"type":"unknown"}}"#,
            Error::InvalidCredential,
        ),
    ] {
        let error = Snapshot::from_json(Ok(Some(text)))
            .resolve(
                "anthropic",
                sources(None, Some("faux-environment"), Some("faux-fallback")),
                |_| None,
            )
            .unwrap_err();
        assert_eq!(error, expected);
        assert!(!format!("{error:?} {error}").contains("sensitive-marker"));
    }
    for input in [
        json!({"config":"!echo sensitive-marker"}),
        json!({"config":"sensitive-marker","store":"{}"}),
        json!({"unexpected":"sensitive-marker"}),
        json!({"config":123,"runtime":"sensitive-marker"}),
    ] {
        let output = cli(&input.to_string());
        assert!(!output.status.success());
        assert!(output.stdout.is_empty());
        assert!(!String::from_utf8_lossy(&output.stderr).contains("sensitive-marker"));
    }
}
#[test]
fn bounded_snapshots_and_templates_fail_closed_without_reading_ambient_environment() {
    assert!(matches!(
        resolve_config(&"x".repeat(65537), |_| None),
        Err(Error::InvalidInput)
    ));
    for text in ["[]", "null", "123", "\"sensitive-marker\""] {
        assert!(matches!(
            Snapshot::from_json(Ok(Some(text))).resolve(
                "anthropic",
                sources(None, Some("faux-environment"), None),
                |_| None
            ),
            Err(Error::UnavailableStore)
        ));
    }
    let big = format!(r#"{{"padding":"{}"}}"#, "x".repeat(1024 * 1024));
    let store = Snapshot::from_json(Ok(Some(&big)));
    assert!(matches!(
        store.resolve(
            "anthropic",
            sources(None, Some("faux-environment"), None),
            |_| None
        ),
        Err(Error::UnavailableStore)
    ));
    assert!(resolve_config("$SYN_KEY", |_| None).unwrap().is_none());
    let output = cli(r#"{"config":"$SYN_KEY"}"#);
    assert!(output.status.success());
    assert_eq!(
        serde_json::from_slice::<Value>(&output.stdout).unwrap(),
        json!({"key":null,"blocked":false})
    );
}
#[test]
fn exact_limits_and_expanded_output_are_bounded() {
    let exact = "x".repeat(65536);
    assert_eq!(
        resolve_config(&exact, |_| None).unwrap().unwrap().expose(),
        exact
    );
    for config in ["${X}tail", "$X$X", "prefix$X"] {
        assert!(matches!(
            resolve_config(config, |_| Some(exact.clone())),
            Err(Error::InvalidInput)
        ));
    }
    let padding = "x".repeat(1024 * 1024 - r#"{"padding":""}"#.len());
    let store = format!(r#"{{"padding":"{padding}"}}"#);
    assert_eq!(store.len(), 1024 * 1024);
    assert!(
        Snapshot::from_json(Ok(Some(&store)))
            .resolve("anthropic", sources(None, None, None), |_| None)
            .unwrap()
            .is_none()
    );
    let oversized = cli(&" ".repeat(2 * 1024 * 1024 + 1));
    assert!(!oversized.status.success());
    assert!(oversized.stdout.is_empty());
    assert_eq!(
        String::from_utf8(oversized.stderr).unwrap(),
        "auth replay refused: input exceeds 2 MiB\n"
    );
}
