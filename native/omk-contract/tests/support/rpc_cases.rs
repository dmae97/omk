use serde_json::{Value, json};

pub fn commands() -> Vec<Value> {
    vec![
        json!({"type":"prompt","message":"hello","images":[{"type":"image","data":"AA==","mimeType":"image/png"}],"streamingBehavior":"followUp"}),
        json!({"type":"steer","message":"hello"}),
        json!({"type":"follow_up","message":"hello"}),
        json!({"type":"abort"}),
        json!({"type":"new_session","parentSession":"parent.jsonl"}),
        json!({"type":"get_state"}),
        json!({"type":"set_model","provider":"extension","modelId":"model"}),
        json!({"type":"cycle_model"}),
        json!({"type":"get_available_models"}),
        json!({"type":"set_thinking_level","level":"ultra"}),
        json!({"type":"cycle_thinking_level"}),
        json!({"type":"set_steering_mode","mode":"all"}),
        json!({"type":"set_follow_up_mode","mode":"one-at-a-time"}),
        json!({"type":"compact","customInstructions":"keep rules"}),
        json!({"type":"set_auto_compaction","enabled":true}),
        json!({"type":"set_auto_retry","enabled":false}),
        json!({"type":"abort_retry"}),
        json!({"type":"bash","command":"echo synthetic","excludeFromContext":true}),
        json!({"type":"abort_bash"}),
        json!({"type":"get_session_stats"}),
        json!({"type":"export_html","outputPath":"export.html"}),
        json!({"type":"switch_session","sessionPath":"other.jsonl"}),
        json!({"type":"fork","entryId":"e"}),
        json!({"type":"clone"}),
        json!({"type":"get_fork_messages"}),
        json!({"type":"get_last_assistant_text"}),
        json!({"type":"set_session_name","name":"synthetic"}),
        json!({"type":"get_messages"}),
        json!({"type":"get_commands"}),
    ]
}

pub fn transcript() -> Vec<Value> {
    include_str!("../fixtures/rpc-transcript.jsonl")
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect()
}
pub fn state() -> Value {
    transcript()[1]["message"]["data"].clone()
}
pub fn assistant() -> Value {
    transcript()
        .into_iter()
        .find(|r| r["message"]["message"]["role"] == "assistant")
        .unwrap()["message"]["message"]
        .clone()
}
pub fn termination() -> Value {
    transcript()
        .into_iter()
        .find(|r| r["message"]["type"] == "session_termination")
        .unwrap()["message"]["termination"]
        .clone()
}

pub fn response(command: &str) -> Value {
    let mut result = json!({"id":"r","type":"response","command":command,"success":true});
    let data = match command {
        "new_session" | "switch_session" | "clone" => Some(json!({"cancelled":false})),
        "get_state" => Some(state()),
        "set_model" => Some(state()["model"].clone()),
        "cycle_model" => {
            Some(json!({"model":state()["model"],"thinkingLevel":"high","isScoped":true}))
        }
        "get_available_models" => Some(json!({"models":[state()["model"].clone()]})),
        "cycle_thinking_level" => Some(json!({"level":"off"})),
        "compact" => Some(
            json!({"summary":"synthetic","firstKeptEntryId":"e","tokensBefore":3,"details":null}),
        ),
        "bash" => Some(json!({"output":"synthetic","cancelled":false,"truncated":false})),
        "get_session_stats" => Some(
            json!({"sessionId":"s","userMessages":1,"assistantMessages":1,"toolCalls":0,"toolResults":0,"totalMessages":2,"tokens":{"input":1,"output":1,"cacheRead":0,"cacheWrite":0,"total":2},"promptCache":{"providerEligibleInputTokens":1,"providerHitRate":0,"keyChanges":0,"boundaryBypasses":0,"stablePrefixCharacters":0},"cost":0,"contextUsage":{"tokens":null,"contextWindow":100,"percent":null}}),
        ),
        "export_html" => Some(json!({"path":"export.html"})),
        "fork" => Some(json!({"text":"synthetic","cancelled":false})),
        "get_fork_messages" => Some(json!({"messages":[{"entryId":"e","text":"synthetic"}]})),
        "get_last_assistant_text" => Some(json!({"text":null})),
        "get_messages" => Some(json!({"messages":[assistant()]})),
        "get_commands" => Some(
            json!({"commands":[{"name":"synthetic","source":"extension","sourceInfo":{"path":"relative.ts","source":"local","scope":"project","origin":"top-level"}}]}),
        ),
        _ => None,
    };
    if let Some(data) = data {
        result["data"] = data;
    }
    result
}

pub fn ui_requests() -> Vec<Value> {
    [
        json!({"method":"select","title":"synthetic","options":["one"],"timeout":1}),
        json!({"method":"confirm","title":"synthetic","message":"continue?"}),
        json!({"method":"input","title":"synthetic","placeholder":"text"}),
        json!({"method":"editor","title":"synthetic","prefill":"text"}),
        json!({"method":"notify","message":"synthetic","notifyType":"warning"}),
        json!({"method":"setStatus","statusKey":"key"}),
        json!({"method":"setWidget","widgetKey":"key","widgetLines":["line"],"widgetPlacement":"belowEditor"}),
        json!({"method":"setTitle","title":"synthetic"}),json!({"method":"set_editor_text","text":"synthetic"}),
    ].into_iter().map(|mut v|{v["type"]=json!("extension_ui_request");v["id"]=json!("ui");v}).collect()
}
