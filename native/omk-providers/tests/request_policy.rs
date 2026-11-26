use omk_providers::{
    anthropic::{Input, build_request},
    auth::{KeySources, Snapshot},
    catalog::Catalog,
    dispatch,
};
use serde_json::{Value, json};
fn recorded() -> Value {
    serde_json::from_str::<Value>(include_str!("fixtures/anthropic-policy.json")).unwrap()["cases"]
        [0]
    .clone()
}
#[test]
fn malformed_and_unsafe_options_fail_before_dispatch_without_echoing_values() {
    let case = recorded();
    let catalog = Catalog::load(case["overlay"].as_str());
    let snapshot = Snapshot::from_json(Ok(None));
    for options in [
        json!({"temperature":2}),
        json!({"temperature":-0.1}),
        json!({"thinkingBudgetTokens":-1}),
        json!({"thinkingBudgetTokens":1.5}),
        json!({"thinkingDisplay":"secret-marker"}),
        json!({"effort":"secret-marker"}),
        json!({"toolChoice":"secret-marker"}),
        json!({"toolChoice":{"type":"tool","name":""}}),
        json!({"toolChoice":{"type":"tool","name":"x".repeat(257)}}),
        json!({"toolChoice":{"type":"tool","name":"read","extra":true}}),
        json!({"unknown":"secret-marker"}),
    ] {
        let mut input = case["input"].clone();
        input["options"] = options;
        if let Ok(input) = serde_json::from_value::<Input>(input) {
            let error = match dispatch::prepare(
                &catalog,
                "anthropic",
                &input,
                &snapshot,
                KeySources {
                    runtime: Some("faux-key"),
                    environment: None,
                    fallback: None,
                    include_fallback: false,
                },
                |_| None,
            ) {
                Ok(_) => panic!("unsafe option admitted"),
                Err(e) => e,
            };
            assert_eq!(error, dispatch::Error::InvalidRequest);
            assert!(!error.to_string().contains("secret-marker"));
        }
    }
}
#[test]
fn synthetic_replay_does_not_silently_ignore_new_catalog_policies() {
    let mut input = recorded()["input"].clone();
    input["model"] = json!("synthetic-anthropic");
    let input: Input = serde_json::from_value(input).unwrap();
    assert_eq!(
        build_request(&input).unwrap_err(),
        "request options require catalog dispatch"
    );
}
