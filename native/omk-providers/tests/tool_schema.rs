use omk_providers::anthropic::{Input, build_request};
use serde_json::Value;

fn input(tools: &str) -> Result<Input, serde_json::Error> {
    serde_json::from_str(&format!(
        r#"{{"model":"synthetic-anthropic","maxTokens":1,"system":"","user":"hello","tools":{tools}}}"#
    ))
}
fn body(tools: &str) -> Result<String, String> {
    let request = build_request(&input(tools).map_err(|e| e.to_string())?)?;
    Ok(request["body"].as_str().unwrap().to_string())
}

#[test]
fn raw_schema_literals_match_node_parse_and_canonicalization() {
    let corpus: Value =
        serde_json::from_str(include_str!("fixtures/anthropic-tool-schema.json")).unwrap();
    for case in corpus["schemas"].as_array().unwrap() {
        let text = case["text"].as_str().unwrap();
        let tools =
            format!(r#"[{{"name":"t","description":"d","properties":{text},"required":[]}}]"#);
        if text == r#"{"v":"\ud800"}"# {
            // Rust strings cannot hold lone surrogates; this is an admission bound.
            assert!(body(&tools).is_err(), "{text}");
            continue;
        }
        let expected = format!(
            r#""input_schema":{{"type":"object","properties":{},"required":[]}}"#,
            case["properties"].as_str().unwrap()
        );
        let actual = body(&tools).unwrap();
        assert!(actual.contains(&expected), "{text}\n{actual}");
    }
}

#[test]
fn unsupported_tool_names_are_refused_instead_of_misordered() {
    let tool = |name: &str| {
        format!(r#"{{"name":"{name}","description":"d","properties":{{}},"required":[]}}"#)
    };
    for tools in [
        format!("[{},{}]", tool("read"), tool("read")),
        format!("[{}]", tool("read.file")),
        format!("[{}]", tool("caf\u{e9}")),
        format!("[{}]", tool("read file")),
    ] {
        assert!(body(&tools).is_err(), "{tools}");
    }
}
