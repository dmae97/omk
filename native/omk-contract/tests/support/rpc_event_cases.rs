use super::rpc_cases::{assistant, termination};
use omk_contract::rpc::RpcRecord;
use serde_json::{Value, json};

#[test]
fn rpc_schema_versions_and_termination_metadata_are_checked() {
    let event = json!({"type":"session_termination","termination":termination()});
    for (key, value) in [
        ("schemaVersion", json!(2)),
        ("kind", json!("future")),
        ("causeCode", json!("provider.future")),
        ("sideEffects", json!("unknown")),
        ("retryable", json!("true")),
    ] {
        let mut invalid = event.clone();
        invalid["termination"][key] = value;
        super::invalid(invalid);
    }
    let source = serde_json::to_string(&event)
        .unwrap()
        .replace("\"schemaVersion\":1", "\"schemaVersion\":1.0");
    let parsed: RpcRecord = serde_json::from_str(&source).unwrap();
    assert_eq!(serde_json::to_string(&parsed).unwrap(), source);
}

#[test]
fn rpc_task_facts_and_provider_boundary_validate_without_promoting_claims() {
    let mut task = events()
        .into_iter()
        .find(|v| v["type"] == "task_result")
        .unwrap();
    task["projection"]["facts"] = json!([{"id":"c","source":"host_receipt","status":"passed","required":true,"tests":{"executed":1,"matched":"unknown","skipped":0},"attempts":[{"attempt":1,"status":"failed"}]}]);
    task["projection"]["modelClaims"] =
        json!([{"source":"model_text","says":"passed","text":"synthetic"}]);
    super::roundtrip(task.clone());
    task["projection"]["facts"][0]["tests"]["executed"] = json!("unavailable");
    super::invalid(task);
    let mut provider = events()
        .into_iter()
        .find(|v| v["type"] == "provider_request")
        .unwrap();
    provider["boundary"] = json!("future");
    super::invalid(provider);
}

pub fn events() -> Vec<Value> {
    let msg = assistant();
    let partial = json!({"type":"text_delta","contentIndex":0,"delta":"x","partial":msg});
    vec![
        json!({"type":"agent_start"}),
        json!({"type":"turn_start"}),
        json!({"type":"agent_end","messages":[msg],"willRetry":false}),
        json!({"type":"turn_end","message":msg,"toolResults":[]}),
        json!({"type":"message_start","message":msg}),
        json!({"type":"message_end","message":msg}),
        json!({"type":"message_update","message":msg,"assistantMessageEvent":partial}),
        json!({"type":"tool_execution_start","toolCallId":"t","toolName":"x","args":null}),
        json!({"type":"tool_execution_update","toolCallId":"t","toolName":"x","args":{},"partialResult":null}),
        json!({"type":"tool_execution_end","toolCallId":"t","toolName":"x","result":null,"isError":false}),
        json!({"type":"tool_execution_late_settlement","toolCallId":"t","toolName":"x","disposition":"timeout","outcome":"resolved"}),
        json!({"type":"provider_denied","requestId":"r","deniedReason":"aborted"}),
        json!({"type":"provider_request","requestId":"r","provider":"extension","model":"m","maxOutputTokens":2,"boundary":"stream-dispatch"}),
        json!({"type":"provider_request_end","requestId":"r","outcome":"completed","boundary":"stream-dispatch"}),
        json!({"type":"prompt_settled","promptRunId":"p","outcome":"completed","durationMs":0}),
        json!({"type":"queue_update","steering":[],"followUp":["next"]}),
        json!({"type":"compaction_start","reason":"manual"}),
        json!({"type":"compaction_end","reason":"threshold","aborted":false,"willRetry":false}),
        json!({"type":"session_info_changed"}),
        json!({"type":"thinking_level_changed","level":"off"}),
        json!({"type":"auto_retry_start","attempt":1,"maxAttempts":2,"delayMs":1,"errorMessage":"synthetic"}),
        json!({"type":"auto_retry_end","success":true,"attempt":1}),
        json!({"type":"pinned_quota_failover","from":"a","to":"b","message":"synthetic"}),
        json!({"type":"bash_execution_update","id":"r","delta":"x"}),
        json!({"type":"summarization_retry_scheduled","attempt":1,"maxAttempts":2,"delayMs":1,"errorMessage":"synthetic"}),
        json!({"type":"summarization_retry_attempt_start","source":"branchSummary"}),
        json!({"type":"summarization_retry_attempt_start","source":"compaction","reason":"overflow"}),
        json!({"type":"summarization_retry_finished"}),
        json!({"type":"session_termination","termination":termination()}),
        json!({"type":"workspace_mutation","source":"tool_late_settlement","toolCallId":"t","toolName":"x","payload":{"root":"<repo>","paths":[]}}),
        json!({"type":"extension_error","extensionPath":"relative.ts","event":"input","error":"synthetic"}),
        json!({"type":"task_result","version":2,"projection":{"version":2,"promptRunId":"p","execution":"completed","check":"none","checkSource":"none","coverage":{"checksRun":0,"checksTotal":"unknown","receiptsObserved":0},"facts":[],"modelClaims":[]}}),
        json!({"type":"task_result_downgrade","version":2,"promptRunId":"p","from":"passed","fact":{"id":"check","source":"host_receipt","status":"insufficient","required":true}}),
    ]
}

pub fn stream_events() -> Vec<Value> {
    [
        json!({"type":"start","partial":assistant()}),
        json!({"type":"text_start","partial":assistant(),"contentIndex":0}),
        json!({"type":"text_delta","partial":assistant(),"contentIndex":0,"delta":"x"}),
        json!({"type":"text_end","partial":assistant(),"contentIndex":0,"content":"x"}),
        json!({"type":"thinking_start","partial":assistant(),"contentIndex":0}),
        json!({"type":"thinking_delta","partial":assistant(),"contentIndex":0,"delta":"x"}),
        json!({"type":"thinking_end","partial":assistant(),"contentIndex":0,"content":"x"}),
        json!({"type":"toolcall_start","partial":assistant(),"contentIndex":0}),
        json!({"type":"toolcall_delta","partial":assistant(),"contentIndex":0,"delta":"{}"}),
        json!({"type":"toolcall_end","partial":assistant(),"contentIndex":0,"toolCall":{"type":"toolCall","id":"t","name":"x","arguments":{}}}),
        json!({"type":"done","reason":"stop","message":assistant()}),
        json!({"type":"error","reason":"aborted","error":assistant()}),
    ].into_iter().map(|stream|json!({"type":"message_update","message":assistant(),"assistantMessageEvent":stream})).collect()
}
