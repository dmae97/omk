use omk_providers::{
    anthropic::{Input, build_request},
    request_cache::Boundary,
};
use serde_json::{Value, json};

fn recorded() -> Value {
    serde_json::from_str::<Value>(include_str!("fixtures/anthropic-cache.json")).unwrap()["cases"]
        [0]["input"]
        .clone()
}
#[test]
fn cache_retention_and_bypass_shapes_are_strict_without_widening_replay() {
    let original = recorded();
    for value in [
        json!("forever"),
        json!(42),
        json!({}),
        json!(true),
        Value::Null,
    ] {
        let mut input = original.clone();
        input["options"]["cacheRetention"] = value;
        assert!(serde_json::from_value::<Input>(input).is_err());
    }
    let mut input = original.clone();
    input["systemPromptCacheBoundaryBypass"] = json!("true");
    assert!(serde_json::from_value::<Input>(input).is_err());
    let mut input = original;
    input["model"] = json!("synthetic-anthropic");
    let parsed: Input = serde_json::from_value(input.clone()).unwrap();
    assert!(
        build_request(&parsed)
            .unwrap_err()
            .contains("catalog dispatch")
    );
    input.as_object_mut().unwrap().remove("options");
    input["systemPromptCacheBoundary"] = Value::Null;
    let parsed: Input = serde_json::from_value(input).unwrap();
    assert!(matches!(
        parsed.system_prompt_cache_boundary,
        Boundary::Present(Value::Null)
    ));
    assert!(
        build_request(&parsed)
            .unwrap_err()
            .contains("catalog dispatch")
    );
}

#[test]
fn missing_null_and_numeric_boundary_metadata_are_not_conflated() {
    let input: Input = serde_json::from_value(recorded()).unwrap();
    assert!(matches!(
        input.system_prompt_cache_boundary,
        Boundary::Missing
    ));
    for raw in ["null", "6.0", "1e100", "\"6\"", "{}", "[]"] {
        let boundary: Boundary = serde_json::from_str(raw).unwrap();
        assert!(matches!(boundary, Boundary::Present(_)), "{raw}");
    }
}
