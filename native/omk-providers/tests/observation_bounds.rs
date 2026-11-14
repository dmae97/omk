use omk_providers::anthropic::{replay, replay_with_tool_arguments};
use serde_json::{Value, json};

fn frame(value: Value) -> Vec<u8> {
    format!(
        "event: {}\ndata: {value}\n\n",
        value["type"].as_str().unwrap()
    )
    .into_bytes()
}
fn stream(part: &str, repeats: usize) -> Vec<Vec<u8>> {
    let mut chunks = vec![
        frame(
            json!({"type":"message_start","message":{"id":"synthetic-bounds","model":"synthetic-anthropic","usage":{}}}),
        ),
        frame(
            json!({"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tool-1","name":"inspect","input":{}}}),
        ),
        frame(
            json!({"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":part}}),
        ),
    ];
    chunks.extend((0..repeats).map(|_| frame(json!({"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":""}}))));
    chunks.push(frame(json!({"type":"content_block_stop","index":0})));
    chunks.push(frame(json!({"type":"message_stop"})));
    chunks
}

#[test]
fn argument_observations_are_opt_in_and_have_count_and_byte_budgets() {
    for chunks in [
        stream("", 4100),
        stream(&json!({"text":"x".repeat(900_000)}).to_string(), 10),
    ] {
        let default = replay("synthetic-anthropic", &chunks, None).unwrap();
        assert_eq!(default.result["stopReason"], "stop");
        assert_eq!(default.tool_arguments, json!([]));
        let observed = replay_with_tool_arguments("synthetic-anthropic", &chunks, None).unwrap();
        assert_eq!(observed.result["stopReason"], "error");
        assert_eq!(
            observed.result["errorMessage"],
            "tool argument observation budget exceeded"
        );
        assert!(observed.tool_arguments.as_array().unwrap().len() <= 4096);
        let bytes: usize = observed
            .tool_arguments
            .as_array()
            .unwrap()
            .iter()
            .map(|row| serde_json::to_vec(&row["arguments"]).unwrap().len())
            .sum();
        assert!(bytes <= 8 * 1024 * 1024);
    }
}
