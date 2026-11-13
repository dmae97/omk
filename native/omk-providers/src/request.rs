use serde::{Deserialize, Serialize};
use serde_json::{Value, json, value::RawValue};

/// Deliberately bounded API-key, no-cache synthetic request surface.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Input {
    pub model: String,
    pub max_tokens: u32,
    pub system: String,
    pub user: String,
    pub tools: Vec<Tool>,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Tool {
    name: String,
    description: String,
    properties: Box<RawValue>,
    required: Vec<String>,
}
#[derive(Serialize)]
struct Message<'a> {
    role: &'a str,
    content: &'a str,
}
#[derive(Serialize)]
struct Text<'a> {
    r#type: &'a str,
    text: &'a str,
}
#[derive(Serialize)]
struct Schema<'a> {
    r#type: &'a str,
    #[serde(serialize_with = "compact_raw")]
    properties: &'a RawValue,
    required: &'a [String],
}
fn compact_raw<S: serde::Serializer>(value: &RawValue, serializer: S) -> Result<S::Ok, S::Error> {
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
    eager_input_streaming: bool,
    input_schema: Schema<'a>,
}
#[derive(Serialize)]
struct Body<'a> {
    model: &'a str,
    messages: Vec<Message<'a>>,
    max_tokens: u32,
    stream: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    system: Vec<Text<'a>>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    tools: Vec<WireTool<'a>>,
}

pub fn build_request(input: &Input) -> Result<Value, String> {
    if input.model != "synthetic-anthropic" || input.max_tokens == 0 {
        return Err(
            "only the recorded synthetic model and positive maxTokens are supported".into(),
        );
    }
    let body = Body {
        model: &input.model,
        messages: vec![Message {
            role: "user",
            content: &input.user,
        }],
        max_tokens: input.max_tokens,
        stream: true,
        system: if input.system.is_empty() {
            vec![]
        } else {
            vec![Text {
                r#type: "text",
                text: &input.system,
            }]
        },
        tools: input
            .tools
            .iter()
            .map(|tool| WireTool {
                name: &tool.name,
                description: &tool.description,
                eager_input_streaming: true,
                input_schema: Schema {
                    r#type: "object",
                    properties: &tool.properties,
                    required: &tool.required,
                },
            })
            .collect(),
    };
    Ok(json!({
        "url": "https://synthetic.invalid/v1/messages",
        "headers": {
            "accept": "application/json", "anthropic-beta": "interleaved-thinking-2025-05-14",
            "anthropic-dangerous-direct-browser-access": "true", "anthropic-version": "2023-06-01",
            "content-type": "application/json", "x-api-key": "faux-key"
        },
        "body": serde_json::to_string(&body).map_err(|e| e.to_string())?
    }))
}
