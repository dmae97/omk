// Port of packages/ai/src/providers/anthropic.ts (OMK/Pi MIT lineage; root LICENSE/NOTICE).
use crate::json_parse::parse_streaming_json;
use serde_json::{Value, json};

pub(crate) struct Reducer {
    pub events: Vec<Value>,
    pub result: Value,
    pub tool_arguments: Vec<Value>,
    observe: bool,
    observed_bytes: usize,
    pub started: bool,
    pub stopped: bool,
    indices: Vec<Option<u64>>,
    partial_json: Vec<String>,
    raw_stop: String,
}
fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
    value[key]
        .as_str()
        .ok_or_else(|| format!("invalid Anthropic field: {key}"))
}
impl Reducer {
    pub fn new(model: &str, observe: bool) -> Self {
        Self {
            events: vec![json!({"type":"start"})],
            tool_arguments: vec![],
            observe,
            observed_bytes: 0,
            started: false,
            stopped: false,
            indices: vec![],
            partial_json: vec![],
            raw_stop: String::new(),
            result: json!({"role":"assistant","content":[],"api":"anthropic-messages","provider":"anthropic","model":model,"stopReason":"stop",
                "usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0}}),
        }
    }
    fn usage(&mut self, usage: &Value, initial: bool) -> Result<(), String> {
        for key in [
            "input_tokens",
            "output_tokens",
            "cache_read_input_tokens",
            "cache_creation_input_tokens",
        ] {
            if !usage[key].is_null()
                && usage[key]
                    .as_u64()
                    .is_none_or(|n| n > 9_007_199_254_740_991)
            {
                return Err(format!("invalid usage: {key}"));
            }
        }
        for (source, target) in [
            ("input_tokens", "input"),
            ("output_tokens", "output"),
            ("cache_read_input_tokens", "cacheRead"),
            ("cache_creation_input_tokens", "cacheWrite"),
        ] {
            if initial || usage[source].is_u64() {
                self.result["usage"][target] = json!(usage[source].as_u64().unwrap_or(0));
            }
        }
        if initial {
            self.result["usage"]["cacheWrite1h"] = json!(
                usage["cache_creation"]["ephemeral_1h_input_tokens"]
                    .as_u64()
                    .unwrap_or(0)
            );
        }
        let sum: u64 = ["input", "output", "cacheRead", "cacheWrite"]
            .iter()
            .map(|key| self.result["usage"][key].as_u64().unwrap_or(0))
            .sum();
        self.result["usage"]["totalTokens"] = json!(sum);
        Ok(())
    }
    pub fn apply(&mut self, event: Value) -> Result<(), String> {
        match text(&event, "type")? {
            "message_start" => {
                self.started = true;
                self.result["responseId"] = json!(text(&event["message"], "id")?);
                if let Some(model) = event["message"]["model"].as_str() {
                    self.result["model"] = json!(model);
                }
                self.usage(&event["message"]["usage"], true)?;
            }
            "message_stop" => self.stopped = true,
            "message_delta" => {
                if let Some(reason) = event["delta"]["stop_reason"].as_str() {
                    self.raw_stop = reason.into();
                    self.result["stopReason"] = json!(match reason {
                        "end_turn" | "stop_sequence" | "pause_turn" | "sticky" => "stop",
                        "max_tokens" => "length",
                        "tool_use" => "toolUse",
                        "refusal" | "sensitive" => "error",
                        _ => return Err(format!("unrecorded stop reason: {reason}")),
                    });
                }
                self.usage(&event["usage"], false)?;
            }
            "content_block_start" => {
                let raw = &event["content_block"];
                let block = match text(raw, "type")? {
                    "text" => json!({"type":"text","text":""}),
                    "thinking" => json!({"type":"thinking","thinking":"","thinkingSignature":""}),
                    "redacted_thinking" => {
                        json!({"type":"thinking","thinking":"[Reasoning redacted]","thinkingSignature":text(raw,"data")?,"redacted":true})
                    }
                    "tool_use" => {
                        json!({"type":"toolCall","id":text(raw,"id")?,"name":text(raw,"name")?,"arguments":raw["input"]})
                    }
                    other => return Err(format!("unrecorded block type: {other}")),
                };
                let blocks = self.result["content"]
                    .as_array_mut()
                    .ok_or("invalid content")?;
                let index = blocks.len();
                let kind = match block["type"].as_str() {
                    Some("text") => "text_start",
                    Some("thinking") => "thinking_start",
                    _ => "toolcall_start",
                };
                blocks.push(block);
                self.indices
                    .push(Some(event["index"].as_u64().ok_or("invalid index")?));
                self.partial_json.push(String::new());
                self.events.push(json!({"type":kind,"contentIndex":index}));
                if kind == "toolcall_start" {
                    self.observe_tool(kind, index)?;
                }
            }
            "content_block_delta" | "content_block_stop" => self.block_event(&event)?,
            other => return Err(format!("unrecorded event type: {other}")),
        }
        Ok(())
    }
    fn observe_tool(&mut self, kind: &str, index: usize) -> Result<(), String> {
        if !self.observe {
            return Ok(());
        }
        let arguments = &self.result["content"][index]["arguments"];
        let bytes = serde_json::to_vec(arguments)
            .map_err(|e| e.to_string())?
            .len();
        if self.tool_arguments.len() >= 4096 || bytes > 8 * 1024 * 1024 - self.observed_bytes {
            return Err("tool argument observation budget exceeded".into());
        }
        self.observed_bytes += bytes;
        self.tool_arguments
            .push(json!({"type":kind,"contentIndex":index,"arguments":arguments}));
        Ok(())
    }
    fn block_event(&mut self, event: &Value) -> Result<(), String> {
        let wire_index = event["index"].as_u64().ok_or("invalid index")?;
        let Some(index) = self.indices.iter().position(|i| *i == Some(wire_index)) else {
            return Ok(());
        };
        let block = &mut self.result["content"][index];
        if event["type"] == "content_block_stop" {
            self.indices[index] = None;
            if block["type"] == "text" {
                self.events
                    .push(json!({"type":"text_end","contentIndex":index,"content":block["text"]}));
            } else if block["type"] == "thinking" {
                self.events.push(
                    json!({"type":"thinking_end","contentIndex":index,"content":block["thinking"]}),
                );
            } else {
                block["arguments"] =
                    parse_streaming_json(&self.partial_json[index]).map_err(|e| e.to_string())?;
                self.events
                    .push(json!({"type":"toolcall_end","contentIndex":index,"toolCall":block}));
                self.observe_tool("toolcall_end", index)?;
            }
        } else {
            let delta = &event["delta"];
            match text(delta, "type")? {
                "text_delta" if block["type"] == "text" => {
                    let value = text(delta, "text")?;
                    let next = format!("{}{value}", text(block, "text")?);
                    block["text"] = json!(next);
                    self.events
                        .push(json!({"type":"text_delta","contentIndex":index,"delta":value}));
                }
                "thinking_delta" if block["type"] == "thinking" => {
                    let value = text(delta, "thinking")?;
                    block["thinking"] = json!(format!("{}{value}", text(block, "thinking")?));
                    self.events
                        .push(json!({"type":"thinking_delta","contentIndex":index,"delta":value}));
                }
                "signature_delta" if block["type"] == "thinking" => {
                    block["thinkingSignature"] = json!(format!(
                        "{}{}",
                        text(block, "thinkingSignature")?,
                        text(delta, "signature")?
                    ));
                }
                "input_json_delta" if block["type"] == "toolCall" => {
                    let value = text(delta, "partial_json")?;
                    self.partial_json[index].push_str(value);
                    block["arguments"] = parse_streaming_json(&self.partial_json[index])
                        .map_err(|e| e.to_string())?;
                    self.events
                        .push(json!({"type":"toolcall_delta","contentIndex":index,"delta":value}));
                    self.observe_tool("toolcall_delta", index)?;
                }
                other => return Err(format!("unrecorded delta: {other}")),
            }
        }
        Ok(())
    }
    pub fn finish(mut self, error: Option<String>, aborted: bool) -> (Value, Value) {
        let deliverable = self.result["content"].as_array().is_some_and(|blocks| {
            blocks.iter().any(|b| {
                b["type"] == "text" && b["text"].as_str().is_some_and(|t| !t.trim().is_empty())
            })
        });
        let error = error.or_else(|| (self.started && !self.stopped).then(|| "Response incomplete: stream ended before message_stop".into())).or_else(|| {
            (self.result["stopReason"] == "error" && !deliverable).then(|| format!("Model ended the turn with a content/safety stop (stop_reason={}); the response was not completed. Often a false positive on benign input — rephrase or retry.", self.raw_stop))
        });
        if let Some(error) = error {
            let reason = if aborted { "aborted" } else { "error" };
            self.result["stopReason"] = json!(reason);
            self.result["errorMessage"] = json!(error);
            self.events.push(json!({"type":"error","reason":reason}));
        } else {
            if self.result["stopReason"] == "error"
                && ["refusal", "sensitive"].contains(&self.raw_stop.as_str())
                && deliverable
            {
                self.result["stopReason"] = json!("stop");
            }
            self.events
                .push(json!({"type":"done","reason":self.result["stopReason"]}));
        }
        (json!(self.events), self.result)
    }
}
