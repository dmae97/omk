use omk_providers::anthropic::{Input, build_request};
use serde_json::{Value, json};

fn input() -> Value {
    let corpus: Value =
        serde_json::from_str(include_str!("fixtures/anthropic-signature.json")).unwrap();
    corpus["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "true-missing")
        .unwrap()["input"]
        .clone()
}
#[test]
fn compatibility_does_not_widen_legacy_replay_or_invalid_redacted_shapes() {
    let mut value = input();
    value["model"] = json!("synthetic-anthropic");
    let request = build_request(&serde_json::from_value::<Input>(value.clone()).unwrap()).unwrap();
    let body: Value = serde_json::from_str(request["body"].as_str().unwrap()).unwrap();
    assert_eq!(
        body["messages"][0]["content"][0],
        json!({"type":"text","text":"thought"})
    );
    value["compat"] = json!({"allowEmptySignature":true});
    assert!(serde_json::from_value::<Input>(value).is_err());
    let mut value = input();
    value["history"][0]["content"][0]["redacted"] = json!(true);
    assert!(serde_json::from_value::<Input>(value).is_err());
}
