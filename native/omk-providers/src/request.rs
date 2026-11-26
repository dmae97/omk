use crate::request_cache::{self, Text};
use crate::request_history::{HistoryMessage, Message, messages};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json, value::RawValue};

/// Shared bounded Anthropic input; optional request policies require catalog dispatch.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Input {
    #[serde(default)]
    pub options: Option<crate::request_policy::Options>,
    #[serde(default)]
    pub system_prompt_cache_boundary: request_cache::Boundary,
    #[serde(default)]
    pub system_prompt_cache_boundary_bypass: bool,
    pub model: String,
    pub max_tokens: u32,
    pub system: String,
    pub user: String,
    pub tools: Vec<Tool>,
    #[serde(default)]
    history: Vec<HistoryMessage>,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Tool {
    pub(crate) name: String,
    pub(crate) description: String,
    pub(crate) properties: Box<RawValue>,
    pub(crate) required: Vec<String>,
}
#[derive(Serialize)]
struct Schema<'a> {
    r#type: &'a str,
    #[serde(serialize_with = "compact_raw")]
    properties: &'a RawValue,
    required: &'a [String],
}
pub(crate) fn compact_raw<S: serde::Serializer>(
    value: &RawValue,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    let mut quoted = false;
    let mut escaped = false;
    let compact: String = value
        .get()
        .chars()
        .filter(|c| {
            if quoted {
                if escaped {
                    escaped = false;
                } else if *c == '\\' {
                    escaped = true;
                } else if *c == '"' {
                    quoted = false;
                }
                true
            } else if *c == '"' {
                quoted = true;
                true
            } else {
                !matches!(c, ' ' | '\t' | '\r' | '\n')
            }
        })
        .collect();
    RawValue::from_string(compact)
        .map_err(serde::ser::Error::custom)?
        .serialize(serializer)
}
#[derive(Serialize)]
struct WireTool<'a> {
    name: &'a str,
    description: &'a str,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    eager_input_streaming: bool,
    input_schema: Schema<'a>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cache_control: Option<request_cache::Control>,
}
#[derive(Serialize)]
struct Body<'a> {
    model: &'a str,
    messages: Vec<Message<'a>>,
    max_tokens: u32,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    fallbacks: Option<&'a str>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    system: Vec<Text<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<serde_json::Number>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    tools: Vec<WireTool<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    thinking: Option<crate::request_policy::Thinking>,
    #[serde(skip_serializing_if = "Option::is_none")]
    output_config: Option<crate::request_policy::OutputConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    metadata: Option<crate::request_policy::Metadata<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_choice: Option<crate::request_policy::ToolChoice<'a>>,
}

pub fn build_request(input: &Input) -> Result<Value, String> {
    if input.options.is_some()
        || !input.system_prompt_cache_boundary.is_missing()
        || input.system_prompt_cache_boundary_bypass
    {
        return Err("request options require catalog dispatch".into());
    }
    let vision = input.model == "synthetic-anthropic-vision";
    if (!vision && input.model != "synthetic-anthropic") || input.max_tokens == 0 {
        return Err(
            "only the recorded synthetic model and positive maxTokens are supported".into(),
        );
    }
    Ok(json!({
        "url":"https://synthetic.invalid/v1/messages",
        "headers":{
            "accept":"application/json","anthropic-beta":"interleaved-thinking-2025-05-14",
            "anthropic-dangerous-direct-browser-access":"true","anthropic-version":"2023-06-01",
            "content-type":"application/json","x-api-key":"faux-key"
        },
        "body":build_body(input, vision, true, None, crate::request_policy::Policy::default())?
    }))
}
pub(crate) fn build_body<'a>(
    input: &'a Input,
    vision: bool,
    eager: bool,
    fallbacks: Option<&str>,
    policy: crate::request_policy::Policy<'a>,
) -> Result<String, String> {
    if input.max_tokens == 0 {
        return Err("invalid maxTokens".into());
    }
    let tools = crate::tool_schema::stable(&input.tools)?;
    let body = Body {
        model: &input.model,
        temperature: policy.temperature,
        thinking: policy.thinking,
        output_config: policy.output_config,
        metadata: policy.metadata,
        tool_choice: policy.tool_choice,
        messages: messages(
            &input.history,
            &input.user,
            vision,
            policy.cache,
            policy.allow_empty_signature,
        )?,
        max_tokens: input.max_tokens,
        stream: true,
        fallbacks,
        system: request_cache::system(input, policy.cache),
        tools: tools
            .iter()
            .enumerate()
            .map(|(index, (tool, properties))| WireTool {
                cache_control: if policy.cache_tools && index + 1 == tools.len() {
                    policy.cache
                } else {
                    None
                },
                name: &tool.name,
                description: &tool.description,
                eager_input_streaming: eager,
                input_schema: Schema {
                    r#type: "object",
                    properties,
                    required: &tool.required,
                },
            })
            .collect(),
    };
    serde_json::to_string(&body).map_err(|e| e.to_string())
}
