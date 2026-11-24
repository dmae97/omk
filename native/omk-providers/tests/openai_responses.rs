use omk_providers::openai_responses::{Input, build_request};
use serde_json::{Value, json, value::RawValue};
use std::{
    io::Write,
    process::{Command, Stdio},
};

#[derive(serde::Deserialize)]
struct Case {
    id: String,
    input: Box<RawValue>,
    request: Value,
}
#[derive(serde::Deserialize)]
struct Corpus {
    cases: Vec<Case>,
}
fn corpus() -> Vec<Case> {
    load(include_str!("fixtures/openai-responses.json"))
}
fn load(raw: &str) -> Vec<Case> {
    serde_json::from_str::<Corpus>(raw).unwrap().cases
}
fn executable(input: &str) -> std::process::Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_request-openai-responses"))
        .env_clear()
        .env("OPENAI_API_KEY", "ambient-must-not-win")
        .env("OMK_CACHE_RETENTION", "long")
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
fn library_and_executable_match_every_independent_node_request() {
    matches(corpus(), 47);
}
#[test]
fn assistant_reasoning_and_tool_history_match_sdk_requests() {
    matches(
        load(include_str!("fixtures/openai-responses-history.json")),
        19,
    );
}
#[test]
fn model_and_option_headers_merge_like_the_sdk() {
    matches(
        load(include_str!("fixtures/openai-responses-headers.json")),
        16,
    );
}
#[test]
fn user_and_tool_result_images_match_sdk_requests() {
    matches(
        load(include_str!("fixtures/openai-responses-images.json")),
        10,
    );
}
fn matches(cases: Vec<Case>, count: usize) {
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
fn unsupported_shapes_are_refused_without_partial_output() {
    let base: Value = serde_json::from_str(corpus()[0].input.get()).unwrap();
    let edit = |f: &dyn Fn(&mut Value)| {
        let mut value = base.clone();
        f(&mut value);
        value
    };
    let refused = [
        edit(&|v| v["apiKey"] = json!("x")),
        edit(&|v| v["provider"] = json!("github-copilot")),
        edit(&|v| v["provider"] = json!("cloudflare-ai-gateway")),
        edit(&|v| v["provider"] = json!("cloudflare-workers-ai")),
        edit(&|v| {
            v.as_object_mut().unwrap().remove("provider");
        }),
        edit(&|v| v["compat"] = json!({"sendCodexTurnMetadata": true})),
        edit(&|v| v["compat"] = json!({"unknown": true})),
        // Header names/values the SDK or Fetch would reject, trim or never let reach the wire.
        edit(&|v| v["headers"] = json!({"x": 1})),
        edit(&|v| v["headers"] = json!({"x": null})),
        edit(&|v| v["headers"] = json!(["x", "y"])),
        edit(&|v| v["modelHeaders"] = json!({"bad name": "v"})),
        edit(&|v| v["modelHeaders"] = json!({"": "v"})),
        edit(&|v| v["headers"] = json!({"x-é": "v"})),
        edit(&|v| v["headers"] = json!({"x": " padded"})),
        edit(&|v| v["headers"] = json!({"x": "é"})),
        edit(&|v| v["headers"] = json!({"x": "a\nb"})),
        edit(&|v| v["headers"] = json!({"User-Agent": "u"})),
        edit(&|v| v["modelHeaders"] = json!({"X-Stainless-Lang": "rust"})),
        // Node rejects these header values (ByteString/HTTP whitespace) or trims them.
        edit(&|v| v["sessionId"] = json!(format!("{}😀", "a".repeat(63)))),
        edit(&|v| v["sessionId"] = json!(" s")),
        edit(&|v| v["sessionId"] = json!("é")),
        edit(&|v| v["sessionId"] = json!("a\nb")),
        edit(&|v| v["sessionId"] = json!(7)),
        edit(&|v| v["reasoningEffort"] = json!("off")),
        edit(&|v| v["reasoningEffort"] = json!("extreme")),
        edit(&|v| v["reasoningSummary"] = json!("")),
        edit(&|v| v["thinkingLevelMap"] = json!({"turbo": "x"})),
        edit(&|v| v["serviceTier"] = json!("fast")),
        edit(&|v| v["serviceTier"] = json!(null)),
        edit(&|v| v["temperature"] = json!("0.5")),
        edit(&|v| v["cacheRetention"] = json!("forever")),
        edit(&|v| v["messages"] = json!([{"role": "assistant", "content": []}])),
        edit(&|v| v["messages"] = json!([{"role": "toolResult", "content": []}])),
        edit(
            &|v| v["messages"] = json!([{"role": "user", "content": [{"type": "image", "data": "AA==", "mimeType": "image/png"}]}]),
        ),
        edit(
            &|v| v["messages"] = json!([{"role": "user", "content": [{"type": "text", "text": "a", "textSignature": "s"}]}]),
        ),
        edit(&|v| {
            v["system"] = json!("😀 tail");
            v["systemPromptCacheBoundary"] = json!(1);
        }),
        edit(&|v| v["baseUrl"] = json!("https://Synthetic.invalid/v1")),
        edit(&|v| v["baseUrl"] = json!("https://synthetic.invalid/v1?x=1")),
        edit(&|v| {
            v["tools"] = json!([{"name":"a.b","description":"d","properties":{},"required":[]}])
        }),
    ];
    let source =
        json!({"provider": "synthetic", "api": "openai-responses", "model": "synthetic-responses"});
    let history = |messages: Value| edit(&|v| v["messages"] = messages.clone());
    let assistant = |block: Value| {
        history(json!([{"role": "assistant", "source": source, "content": [block]}]))
    };
    let refused = refused.into_iter().chain([
        assistant(json!({"type": "thinking", "thinking": "t", "thinkingSignature": "not json"})),
        assistant(json!({"type": "thinking", "thinking": "t", "thinkingSignature": "[1]"})),
        assistant(json!({"type": "thinking", "thinking": "t", "thinkingSignature": "{\"a\":1,\"a\":2}"})),
        assistant(json!({"type": "text", "text": "t", "textSignature": "{oops"})),
        assistant(json!({"type": "text", "text": "t", "textSignature": "{\"v\":1,\"id\":\"\\ud800\"}"})),
        assistant(json!({"type": "toolCall", "id": "c", "name": "f", "arguments": [1]})),
        assistant(json!({"type": "image", "data": "AA==", "mimeType": "image/png"})),
        assistant(json!({"type": "text", "text": "t", "extra": 1})),
        history(json!([{"role": "assistant", "content": [{"type": "text", "text": "t"}]}])),
        history(json!([{"role": "user", "source": source, "content": "t"}])),
        history(json!([{"role": "assistant", "source": {"provider": "synthetic"}, "content": []}])),
        history(json!([{"role": "toolResult", "toolCallId": "c", "content": [{"type": "image", "data": "AA==", "mimeType": "image/png"}]}])),
        history(json!([{"role": "toolResult", "toolName": "f", "content": []}])),
        edit(&|v| {
            v["vision"] = json!("true");
            v["messages"] = json!([{"role": "user", "content": [{"type": "image", "data": "AA==", "mimeType": "image/png"}]}]);
        }),
        edit(&|v| {
            v["vision"] = json!(true);
            v["messages"] = json!([{"role": "user", "content": [{"type": "image", "data": "AA=="}]}]);
        }),
        edit(&|v| {
            v["vision"] = json!(false);
            v["messages"] = json!([{"role": "user", "content": [{"type": "image", "data": "AA==", "mimeType": "image/png", "detail": "high"}]}]);
        }),
        edit(&|v| {
            v["vision"] = json!(true);
            v["messages"] = json!([{"role": "user", "content": vec![json!({"type": "image", "data": "AA==", "mimeType": "image/png"}); 4097]}]);
        }),
        edit(&|v| {
            v["vision"] = json!(false);
            v["messages"] = json!([{"role": "user", "content": vec![json!({"type": "image", "data": "AA==", "mimeType": "image/png"}); 4097]}]);
        }),
    ]);
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
