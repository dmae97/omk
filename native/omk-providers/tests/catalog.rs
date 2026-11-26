use omk_providers::catalog::Catalog;
use serde_json::{Value, json};
use std::{
    io::Write,
    process::{Command, Stdio},
};
#[test]
fn independent_node_catalog_matches_library_and_executable() {
    let corpus: Value = serde_json::from_str(include_str!("fixtures/catalog.json")).unwrap();
    let providers = vec!["anthropic".into(), "synthetic".into()];
    let mut failures = Vec::new();
    for case in corpus["cases"].as_array().unwrap() {
        let overlay = case["overlay"].as_str().unwrap();
        let actual = Catalog::load(Some(overlay)).view(&providers, &providers);
        if actual != case["expected"] {
            failures.push(format!("{} library", case["id"]));
        }
        let mut child = Command::new(env!("CARGO_BIN_EXE_provider"))
            .arg("catalog")
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
                json!({"overlay":overlay,"providers":providers,"authenticated":providers})
                    .to_string()
                    .as_bytes(),
            )
            .unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(output.status.success());
        let cli: Value = serde_json::from_slice(&output.stdout).unwrap();
        if cli != case["expected"] {
            failures.push(format!("{} executable", case["id"]));
        }
    }
    assert!(failures.is_empty(), "Node oracle mismatches: {failures:?}");
}

#[test]
fn overlay_failures_preserve_builtins_and_explicit_visibility_fails_closed() {
    let auth = vec!["anthropic".to_string()];
    for overlay in [
        "null",
        "[]",
        "{\"providers\":null}",
        "{\"providers\":{\"anthropic\":{\"models\":[{\"id\":\"bad\",\"maxTokens\":0}]}}}",
    ] {
        let catalog = Catalog::load(Some(overlay));
        assert!(catalog.is_invalid());
        assert!(catalog.view(&auth, &auth)["total"].as_u64().unwrap() > 2000);
    }
    let hidden = Catalog::load(Some(
        "{// comment\n\"providers\":{},\"visibility\":{\"providers\":false},}",
    ));
    assert!(hidden.is_invalid());
    assert_eq!(hidden.view(&auth, &auth)["available"], json!([]));
    let huge = " ".repeat(1024 * 1024 + 1);
    assert!(Catalog::load(Some(&huge)).is_invalid());
    let unicode = Catalog::load(Some(
        r#"{"providers":{"anthropic":{"baseUrl":"https://synthetic.invalid/한글"}}}"#,
    ));
    assert!(!unicode.is_invalid());
}
