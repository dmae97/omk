//! Bounded port of packages/ai/src/providers/openai-completions.ts buildParams/convertMessages
//! (MIT; root LICENSE/NOTICE). Request bytes only: no provider detection, client or response parser.
pub(crate) mod arguments;
pub(crate) mod cache;
pub(crate) mod effort;
pub(crate) mod handoff;
mod history;
mod pairing;
use crate::{
    request::Tool,
    request_cache::{Boundary, Retention},
    tool_schema,
};
use history::{WireMessage, messages};
use pairing::Message;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json, value::RawValue};

/// Caller-resolved model compatibility; provider/URL detection is not ported.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Compat {
    supports_store: bool,
    supports_developer_role: bool,
    supports_usage_in_streaming: bool,
    max_tokens_field: MaxTokensField,
    supports_strict_mode: bool,
    requires_system_message_first: bool,
    #[serde(default)]
    requires_tool_result_name: bool,
    #[serde(default)]
    requires_assistant_after_tool_result: bool,
    #[serde(default)]
    requires_thinking_as_text: bool,
    #[serde(default)]
    requires_reasoning_content_on_assistant_messages: bool,
    /// Node's documented default is "openai" when absent.
    #[serde(default)]
    thinking_format: effort::Format,
    supports_reasoning_effort: Option<bool>,
    supports_long_cache_retention: Option<bool>,
    /// Caller-resolved; Node detection never enables it.
    #[serde(default)]
    send_session_affinity_headers: bool,
}
#[derive(Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum MaxTokensField {
    MaxTokens,
    MaxCompletionTokens,
}

#[derive(Deserialize)]
#[serde(try_from = "Request")]
pub struct Input(Request);
impl TryFrom<Request> for Input {
    type Error = String;
    fn try_from(mut req: Request) -> Result<Self, String> {
        handoff::prepare(&mut req.messages, req.provider.as_deref(), &req.model)?;
        Ok(Self(req))
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    provider: Option<String>,
    base_url: String,
    model: String,
    reasoning: bool,
    vision: Option<bool>,
    compat: Compat,
    system: String,
    messages: Vec<Message>,
    #[serde(default)]
    tools: Vec<Tool>,
    max_tokens: Option<u32>,
    temperature: Option<serde_json::Number>,
    tool_choice: Option<ToolChoice>,
    reasoning_effort: Option<effort::Level>,
    thinking_level_map: Option<effort::LevelMap>,
    cache_retention: Option<Retention>,
    session_id: Option<String>,
    /// Missing and present (even null or invalid) boundaries differ, as in Node.
    #[serde(default)]
    system_prompt_cache_boundary: Boundary,
    #[serde(default)]
    system_prompt_cache_boundary_bypass: bool,
}
#[derive(Deserialize, Serialize)]
#[serde(untagged)]
enum ToolChoice {
    Mode(Mode),
    Function(FunctionChoice),
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum Mode {
    Auto,
    None,
    Required,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct FunctionChoice {
    r#type: FunctionTag,
    function: Named,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum FunctionTag {
    Function,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Named {
    name: String,
}

#[derive(Serialize)]
struct Parameters<'a> {
    properties: &'a RawValue,
    required: &'a [String],
    r#type: &'static str,
}
#[derive(Serialize)]
struct Function<'a> {
    name: &'a str,
    description: &'a str,
    parameters: Parameters<'a>,
    #[serde(skip_serializing_if = "Option::is_none")]
    strict: Option<bool>,
}
#[derive(Serialize)]
struct WireTool<'a> {
    r#type: &'static str,
    function: Function<'a>,
}
#[derive(Serialize)]
struct StreamOptions {
    include_usage: bool,
}
#[derive(Serialize)]
struct Body<'a> {
    model: &'a str,
    messages: Vec<WireMessage<'a>>,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    prompt_cache_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    prompt_cache_retention: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stream_options: Option<StreamOptions>,
    #[serde(skip_serializing_if = "Option::is_none")]
    store: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_completion_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<Box<RawValue>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<Vec<WireTool<'a>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_choice: Option<&'a ToolChoice>,
    #[serde(flatten)]
    reasoning: effort::Params,
}

/// Admits only URLs whose WHATWG serialization is the input itself, then appends the SDK path.
pub(crate) fn endpoint(base: &str, suffix: &str) -> Result<String, String> {
    let refuse = || Err(format!("unsupported baseUrl: {base}"));
    let Some((scheme, rest)) = base.split_once("://") else {
        return refuse();
    };
    let default_port = match scheme {
        "https" => "443",
        "http" => "80",
        _ => return refuse(),
    };
    let (authority, path) = rest.split_once('/').unwrap_or((rest, ""));
    let (host, port) = match authority.split_once(':') {
        Some((host, port)) => (host, Some(port)),
        None => (authority, None),
    };
    let labels: Vec<&str> = host.split('.').collect();
    let label = |l: &&str| {
        !l.is_empty()
            && !l.starts_with("xn--")
            && l.bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    };
    let numeric = labels
        .last()
        .is_some_and(|l| l.bytes().next().is_some_and(|b| b.is_ascii_digit()));
    let canonical_octet = |l: &&str| l.parse::<u8>().is_ok_and(|n| n.to_string() == *l);
    let host_ok = if numeric {
        labels.len() == 4 && labels.iter().all(canonical_octet)
    } else {
        labels.iter().all(label)
    };
    let port_ok =
        port.is_none_or(|p| !p.starts_with('0') && p != default_port && p.parse::<u16>().is_ok());
    let segments: Vec<&str> = path.split('/').collect();
    let path_ok = segments.iter().enumerate().all(|(i, s)| {
        (s.is_empty() && i + 1 == segments.len())
            || (!s.is_empty()
                && !s.bytes().all(|b| b == b'.')
                && s.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~')))
    });
    if !(host_ok && port_ok && path_ok) {
        return refuse();
    }
    let separator = if base.ends_with('/') { "" } else { "/" };
    Ok(format!("{base}{separator}{suffix}"))
}

/// Node createClient: headers carry the session unless retention is "none".
fn affinity_session(input: &Request) -> Result<Option<&str>, String> {
    let session = input
        .session_id
        .as_deref()
        .filter(|s| !s.is_empty() && input.compat.send_session_affinity_headers);
    let Some(session) = session.filter(|_| !matches!(input.cache_retention, Some(Retention::None)))
    else {
        return Ok(None);
    };
    plain_header_value(session).map(Some)
}

/// Fetch Headers trims HTTP whitespace, Latin-1 encodes or rejects anything else.
pub(crate) fn plain_header_value(value: &str) -> Result<&str, String> {
    let edge = |c: char| matches!(c, ' ' | '\t');
    if value.starts_with(edge)
        || value.ends_with(edge)
        || !value.chars().all(|c| edge(c) || c.is_ascii_graphic())
    {
        return Err("session header value is not plain visible ASCII".into());
    }
    Ok(value)
}

/// Builds the exact `{url, headers, body}` the Node SDK sends for the admitted surface.
pub fn build_request(input: &Input, api_key: &str) -> Result<Value, String> {
    let input = &input.0;
    let url = endpoint(&input.base_url, "chat/completions")?;
    let tools = tool_schema::stable(&input.tools)?;
    let (prompt_cache_key, prompt_cache_retention) = cache::fields(&cache::Policy {
        base_url: &input.base_url,
        provider: input.provider.as_deref(),
        model: &input.model,
        system: &input.system,
        tools: &tools,
        retention: input.cache_retention,
        supports_long: input.compat.supports_long_cache_retention,
        session: input.session_id.as_deref(),
        boundary: &input.system_prompt_cache_boundary,
        bypass: input.system_prompt_cache_boundary_bypass,
    })?;
    let temperature = input
        .temperature
        .as_ref()
        .map(|n| {
            tool_schema::js_number(&n.to_string())
                .and_then(|s| RawValue::from_string(s).map_err(|e| e.to_string()))
        })
        .transpose()?;
    let max_tokens = input.max_tokens.filter(|n| *n > 0);
    let legacy = input.compat.max_tokens_field == MaxTokensField::MaxTokens;
    let body = Body {
        model: &input.model,
        messages: messages(input)?,
        stream: true,
        prompt_cache_key,
        prompt_cache_retention,
        stream_options: input
            .compat
            .supports_usage_in_streaming
            .then_some(StreamOptions {
                include_usage: true,
            }),
        store: input.compat.supports_store.then_some(false),
        max_completion_tokens: max_tokens.filter(|_| !legacy),
        max_tokens: max_tokens.filter(|_| legacy),
        temperature,
        tools: (!tools.is_empty() || input.messages.iter().any(Message::has_tools)).then(|| {
            tools
                .iter()
                .map(|(tool, properties)| WireTool {
                    r#type: "function",
                    function: Function {
                        name: &tool.name,
                        description: &tool.description,
                        parameters: Parameters {
                            properties,
                            required: &tool.required,
                            r#type: "object",
                        },
                        strict: input.compat.supports_strict_mode.then_some(false),
                    },
                })
                .collect()
        }),
        tool_choice: input.tool_choice.as_ref(),
        reasoning: effort::params(&effort::Model {
            id: &input.model,
            base_url: &input.base_url,
            reasoning: input.reasoning,
            format: input.compat.thinking_format,
            supports_effort: input.compat.supports_reasoning_effort,
            effort: input.reasoning_effort,
            map: input.thinking_level_map.as_ref(),
        })?,
    };
    let mut headers = json!({
        "accept": "application/json",
        "authorization": format!("Bearer {api_key}"),
        "content-type": "application/json",
    });
    if let Some(session) = affinity_session(input)? {
        for name in ["session_id", "x-client-request-id", "x-session-affinity"] {
            headers[name] = json!(session);
        }
    }
    Ok(json!({
        "url": url,
        "headers": headers,
        "body": serde_json::to_string(&body).map_err(|e| e.to_string())?,
    }))
}
