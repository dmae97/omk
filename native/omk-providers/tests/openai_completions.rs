use omk_providers::openai_completions::{Input, build_request};
use serde_json::{Value, json};
use std::{
    io::Write,
    process::{Command, Stdio},
};

fn corpus() -> Vec<Value> {
    [
        include_str!("fixtures/openai-completions.json"),
        include_str!("fixtures/openai-completions-images.json"),
    ]
    .into_iter()
    .flat_map(|raw| {
        serde_json::from_str::<Value>(raw).unwrap()["cases"]
            .as_array()
            .unwrap()
            .clone()
    })
    .collect()
}
fn executable(input: &str) -> std::process::Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_request-openai-completions"))
        .env_clear()
        .env("OPENAI_API_KEY", "ambient-must-not-win")
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

#[test]
fn tool_histories_match_sdk_body_bytes() {
    #[derive(serde::Deserialize)]
    struct Case {
        id: String,
        input: Box<serde_json::value::RawValue>,
        request: Value,
    }
    #[derive(serde::Deserialize)]
    struct Corpus {
        cases: Vec<Case>,
    }
    let cases = [
        include_str!("fixtures/openai-completions-tools.json"),
        include_str!("fixtures/openai-completions-cross.json"),
        include_str!("fixtures/openai-completions-reasoning.json"),
    ]
    .into_iter()
    .flat_map(|s| serde_json::from_str::<Corpus>(s).unwrap().cases);
    for c in cases {
        let out = executable(c.input.get());
        assert!(
            out.status.success(),
            "{}: {}",
            c.id,
            String::from_utf8_lossy(&out.stderr)
        );
        let parsed: Input = serde_json::from_str(c.input.get()).unwrap();
        for req in [
            build_request(&parsed, "faux-key").unwrap(),
            serde_json::from_slice(&out.stdout).unwrap(),
        ] {
            assert_eq!(
                req["body"].as_str().unwrap().as_bytes(),
                c.request["body"].as_str().unwrap().as_bytes(),
                "{}",
                c.id
            );
            assert_eq!(req, c.request, "{}", c.id);
        }
    }
}
#[test]
fn reasoning_effort_parameters_match_sdk_body_bytes() {
    request_parameters_match(include_str!("fixtures/openai-completions-effort.json"), 45);
}
#[test]
fn prompt_cache_key_and_retention_match_sdk_body_bytes() {
    request_parameters_match(include_str!("fixtures/openai-completions-cache.json"), 35);
}
#[test]
fn session_affinity_headers_match_sdk_requests() {
    request_parameters_match(
        include_str!("fixtures/openai-completions-affinity.json"),
        12,
    );
}
fn request_parameters_match(raw: &str, count: usize) {
    #[derive(serde::Deserialize)]
    struct Case {
        id: String,
        input: Box<serde_json::value::RawValue>,
        request: Value,
    }
    #[derive(serde::Deserialize)]
    struct Corpus {
        cases: Vec<Case>,
    }
    let cases = serde_json::from_str::<Corpus>(raw).unwrap().cases;
    assert_eq!(cases.len(), count);
    for c in cases {
        let out = executable(c.input.get());
        assert!(
            out.status.success(),
            "{}: {}",
            c.id,
            String::from_utf8_lossy(&out.stderr)
        );
        let parsed: Input = serde_json::from_str(c.input.get()).unwrap();
        for req in [
            build_request(&parsed, "faux-key").unwrap(),
            serde_json::from_slice(&out.stdout).unwrap(),
        ] {
            assert_eq!(
                req["body"].as_str().unwrap().as_bytes(),
                c.request["body"].as_str().unwrap().as_bytes(),
                "{}",
                c.id
            );
            assert_eq!(req, c.request, "{}", c.id);
        }
    }
}
#[test]
fn handoff_refuses_ambiguous_identity_and_split_surrogate_without_output() {
    let fixture: Value =
        serde_json::from_str(include_str!("fixtures/openai-completions-cross.json")).unwrap();
    let base = &fixture["cases"][7]["input"];
    let mut no_target = base.clone();
    no_target.as_object_mut().unwrap().remove("provider");
    let mut no_source = base.clone();
    no_source["messages"][0]
        .as_object_mut()
        .unwrap()
        .remove("source");
    let mut split = base.clone();
    split["messages"][0]["content"][4]["id"] = json!(format!("{}😀", "x".repeat(39)));
    for bad in [no_target, no_source, split] {
        let out = executable(&bad.to_string());
        assert!(!out.status.success());
        assert!(out.stdout.is_empty());
    }
}
#[test]
fn library_matches_every_independent_node_request() {
    for case in corpus() {
        let input: Input = serde_json::from_value(case["input"].clone()).unwrap();
        let request =
            build_request(&input, "faux-key").unwrap_or_else(|e| panic!("{}: {e}", case["id"]));
        assert_eq!(request, case["request"], "{}", case["id"]);
        assert_eq!(request["body"].as_str(), case["request"]["body"].as_str());
    }
}

#[test]
fn executable_matches_every_independent_node_request() {
    for case in corpus() {
        let output = executable(&case["input"].to_string());
        assert!(
            output.status.success(),
            "{}: {}",
            case["id"],
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(output.stderr.is_empty());
        let request: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(request, case["request"], "{}", case["id"]);
    }
}

#[test]
fn unsupported_shapes_are_refused_without_partial_output() {
    let base = corpus()[0]["input"].clone();
    let edit = |f: &dyn Fn(&mut Value)| {
        let mut value = base.clone();
        f(&mut value);
        value
    };
    let refused = [
        edit(&|v| v["apiKey"] = json!("x")),
        edit(&|v| v["compat"]["thinkingFormat"] = json!("unknown-format")),
        edit(&|v| v["reasoningEffort"] = json!("high")),
        edit(&|v| v["thinkingLevelMap"] = json!({"off":"none"})),
        edit(&|v| {
            v["compat"]["supportsReasoningEffort"] = json!(true);
            v["reasoningEffort"] = json!("off");
        }),
        edit(&|v| {
            v["compat"]["supportsReasoningEffort"] = json!(true);
            v["reasoningEffort"] = json!("extreme");
        }),
        edit(&|v| {
            v["compat"]["supportsReasoningEffort"] = json!(true);
            v["thinkingLevelMap"] = json!({"turbo":"x"});
        }),
        edit(&|v| {
            v["compat"]["supportsReasoningEffort"] = json!(true);
            v["thinkingLevelMap"] = json!({"high":1});
        }),
        edit(&|v| {
            v["compat"].as_object_mut().unwrap().remove("supportsStore");
        }),
        edit(&|v| v["compat"]["maxTokensField"] = json!("tokens")),
        edit(&|v| v["messages"] = json!([{"role":"toolResult","content":[]}])),
        edit(&|v| v["messages"] = json!([{"role":"assistant","content":"text"}])),
        edit(
            &|v| v["messages"] = json!([{"role":"user","content":[{"type":"image","data":"AAAA","mimeType":"image/png"}]}]),
        ),
        edit(&|v| {
            v["vision"] = json!(true);
            v["messages"] = json!([{"role":"assistant","content":[{"type":"image","data":"AA==","mimeType":"image/png"}]}]);
        }),
        edit(&|v| {
            v["vision"] = json!(false);
            v["messages"] = json!([{"role":"user","content":[{"type":"image","data":"AA=="}]}]);
        }),
        edit(&|v| {
            v["vision"] = json!(true);
            v["messages"] = json!([{"role":"user","content":vec![json!({"type":"image","data":"AA==","mimeType":"image/png"});4097]}]);
        }),
        edit(&|v| v["toolChoice"] = json!("any")),
        edit(&|v| v["temperature"] = json!("0.5")),
        edit(&|v| v["cacheRetention"] = json!("forever")),
        edit(&|v| v["cacheRetention"] = json!("long")),
        edit(&|v| v["sessionId"] = json!(7)),
        // Header values Node's Headers would trim, Latin-1 encode or reject.
        edit(&|v| {
            v["compat"]["sendSessionAffinityHeaders"] = json!(true);
            v["sessionId"] = json!(" s");
        }),
        edit(&|v| {
            v["compat"]["sendSessionAffinityHeaders"] = json!(true);
            v["sessionId"] = json!("s\t");
        }),
        edit(&|v| {
            v["compat"]["sendSessionAffinityHeaders"] = json!(true);
            v["sessionId"] = json!("é");
        }),
        edit(&|v| {
            v["compat"]["sendSessionAffinityHeaders"] = json!(true);
            v["sessionId"] = json!("a\nb");
        }),
        edit(&|v| v["compat"]["sendSessionAffinityHeaders"] = json!("true")),
        edit(&|v| v["systemPromptCacheBoundaryBypass"] = json!("yes")),
        edit(&|v| v["compat"]["supportsLongCacheRetention"] = json!("true")),
        edit(&|v| {
            v["baseUrl"] = json!("https://api.openai.com/v1");
            v["system"] = json!("😀 tail");
            v["systemPromptCacheBoundary"] = json!(1);
        }),
        edit(&|v| {
            v["baseUrl"] = json!("https://api.openai.com/v1");
            v.as_object_mut().unwrap().remove("provider");
            v["systemPromptCacheBoundary"] = json!(3);
        }),
        edit(&|v| v["baseUrl"] = json!("https://Synthetic.invalid/v1")),
        edit(&|v| v["baseUrl"] = json!("https://synthetic.invalid:443/v1")),
        edit(&|v| v["baseUrl"] = json!("https://synthetic.invalid/v1/../v2")),
        edit(&|v| v["baseUrl"] = json!("https://synthetic.invalid/v1?x=1")),
        edit(&|v| v["baseUrl"] = json!("https://user@synthetic.invalid/v1")),
        edit(&|v| v["baseUrl"] = json!("ftp://synthetic.invalid/v1")),
        edit(&|v| {
            v["tools"] = json!([{"name":"a.b","description":"d","properties":{},"required":[]}])
        }),
    ];
    for input in refused {
        let library = serde_json::from_value::<Input>(input.clone())
            .map_err(|e| e.to_string())
            .and_then(|i| build_request(&i, "faux-key"));
        assert!(library.is_err(), "{input}");
        let output = executable(&input.to_string());
        assert!(!output.status.success(), "{input}");
        assert!(output.stdout.is_empty(), "{input}");
    }
}
