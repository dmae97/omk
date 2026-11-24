//! Bounded port of packages/ai/src/providers/openai-responses.ts buildParams/createClient and
//! openai-responses-shared.ts convertResponsesMessages/convertResponsesTools (MIT; root
//! LICENSE/NOTICE). Request bytes only for text history (see history.rs): no images, Codex turn
//! metadata, Copilot/Cloudflare clients or response parser.
mod headers;
mod history;
use crate::{
    openai_completions::{
        cache,
        effort::{Level, LevelMap},
        endpoint,
    },
    request::Tool,
    request_cache::{Boundary, Retention},
    tool_schema,
};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Value, json, value::RawValue};

#[derive(Deserialize)]
#[serde(try_from = "Request")]
pub struct Input(Request);
impl TryFrom<Request> for Input {
    type Error = String;
    fn try_from(mut req: Request) -> Result<Self, String> {
        if matches!(
            req.provider.as_str(),
            "github-copilot" | "cloudflare-workers-ai" | "cloudflare-ai-gateway"
        ) {
            return Err(format!(
                "provider-specific client not ported: {}",
                req.provider
            ));
        }
        if req.compat.send_codex_turn_metadata == Some(true) {
            return Err("sendCodexTurnMetadata is not ported".into());
        }
        if req.reasoning_effort == Some(Level::Off) {
            return Err("reasoningEffort off is not a Responses option".into());
        }
        // Checked before pairing so dropped turns cannot hide an unresolved capability.
        if req.vision.is_none() && history::has_images(&req.messages) {
            return Err("images require explicit vision capability".into());
        }
        history::prepare(&mut req.messages, &req.provider, &req.model);
        Ok(Self(req))
    }
}

/// Model compat as given; Node's `?? true` / `?? false` defaults are applied here.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Compat {
    send_session_id_header: Option<bool>,
    supports_long_cache_retention: Option<bool>,
    send_codex_turn_metadata: Option<bool>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    provider: String,
    base_url: String,
    model: String,
    reasoning: bool,
    /// Caller-resolved `model.input` includes "image"; required once history has images.
    vision: Option<bool>,
    #[serde(default)]
    compat: Compat,
    thinking_level_map: Option<LevelMap>,
    system: String,
    messages: Vec<history::Message>,
    #[serde(default)]
    tools: Vec<Tool>,
    max_tokens: Option<u32>,
    // Node forwards an explicit null for these, so null is refused rather than read as absent.
    #[serde(default, deserialize_with = "present")]
    temperature: Option<serde_json::Number>,
    #[serde(default, deserialize_with = "present")]
    service_tier: Option<ServiceTier>,
    reasoning_effort: Option<Level>,
    reasoning_summary: Option<Summary>,
    cache_retention: Option<Retention>,
    #[serde(default, deserialize_with = "present")]
    session_id: Option<String>,
    #[serde(default)]
    system_prompt_cache_boundary: Boundary,
    #[serde(default)]
    system_prompt_cache_boundary_bypass: bool,
    /// `model.headers`, then `options.headers` merged last.
    model_headers: Option<headers::Headers>,
    headers: Option<headers::Headers>,
}
fn present<'de, D: Deserializer<'de>, T: Deserialize<'de>>(d: D) -> Result<Option<T>, D::Error> {
    T::deserialize(d).map(Some)
}
#[derive(Deserialize, Serialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
enum ServiceTier {
    Auto,
    Default,
    Flex,
    Scale,
    Priority,
}
#[derive(Deserialize, Serialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
enum Summary {
    Auto,
    Detailed,
    Concise,
}
#[derive(Serialize)]
struct Parameters<'a> {
    properties: &'a RawValue,
    required: &'a [String],
    r#type: &'static str,
}
#[derive(Serialize)]
struct WireTool<'a> {
    r#type: &'static str,
    name: &'a str,
    description: &'a str,
    parameters: Parameters<'a>,
    strict: bool,
}
#[derive(Serialize)]
struct Reasoning<'a> {
    effort: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    summary: Option<Summary>,
}
#[derive(Serialize)]
struct Body<'a> {
    model: &'a str,
    input: Vec<history::Item<'a>>,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    prompt_cache_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    prompt_cache_retention: Option<&'static str>,
    store: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_output_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<Box<RawValue>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    service_tier: Option<ServiceTier>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<Vec<WireTool<'a>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning: Option<Reasoning<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    include: Option<[&'static str; 1]>,
}

/// buildParams' reasoning branch: explicit effort/summary, else the model's `off` value.
fn reasoning(req: &Request) -> (Option<Reasoning<'_>>, bool) {
    if !req.reasoning {
        return (None, false);
    }
    let mapped = |level: Level| {
        req.thinking_level_map
            .as_ref()
            .and_then(|m| m.get(&level))
            .and_then(Option::as_deref)
    };
    if req.reasoning_effort.is_some() || req.reasoning_summary.is_some() {
        let effort = req
            .reasoning_effort
            .map_or("medium", |l| mapped(l).unwrap_or(l.name()));
        let summary = req.reasoning_summary.unwrap_or(Summary::Auto);
        return (
            Some(Reasoning {
                effort,
                summary: Some(summary),
            }),
            true,
        );
    }
    let off = req
        .thinking_level_map
        .as_ref()
        .and_then(|m| m.get(&Level::Off));
    match off {
        // `thinkingLevelMap.off === null` suppresses the parameter.
        Some(None) => (None, false),
        _ => (
            Some(Reasoning {
                effort: mapped(Level::Off).unwrap_or("none"),
                summary: None,
            }),
            false,
        ),
    }
}

/// Builds the exact `{url, headers, body}` the Node SDK sends for the admitted surface.
pub fn build_request(input: &Input, api_key: &str) -> Result<Value, String> {
    let req = &input.0;
    let url = endpoint(&req.base_url, "responses")?;
    let tools = tool_schema::stable(&req.tools)?;
    // Node's default without OMK_CACHE_RETENTION, which is never read.
    let retention = req.cache_retention.unwrap_or(Retention::Short);
    let cached = !matches!(retention, Retention::None);
    let session = req.session_id.as_deref().filter(|_| cached);
    let prompt_cache_key = if cached {
        cache::key(&cache::Policy {
            base_url: &req.base_url,
            provider: Some(&req.provider),
            model: &req.model,
            system: &req.system,
            tools: &tools,
            retention: Some(retention),
            supports_long: req.compat.supports_long_cache_retention,
            session,
            boundary: &req.system_prompt_cache_boundary,
            bypass: req.system_prompt_cache_boundary_bypass,
        })?
    } else {
        None
    };
    let long = matches!(retention, Retention::Long)
        && req.compat.supports_long_cache_retention.unwrap_or(true);
    let temperature = req
        .temperature
        .as_ref()
        .map(|n| {
            tool_schema::js_number(&n.to_string())
                .and_then(|s| RawValue::from_string(s).map_err(|e| e.to_string()))
        })
        .transpose()?;
    let (reasoning, include) = reasoning(req);
    let body = Body {
        model: &req.model,
        input: history::items(
            &req.messages,
            &req.provider,
            &req.model,
            req.reasoning,
            req.vision,
            &req.system,
        )?,
        stream: true,
        prompt_cache_key,
        prompt_cache_retention: long.then_some("24h"),
        store: false,
        max_output_tokens: req.max_tokens.filter(|n| *n > 0),
        temperature,
        service_tier: req.service_tier,
        tools: (!tools.is_empty()).then(|| {
            tools
                .iter()
                .map(|(tool, properties)| WireTool {
                    r#type: "function",
                    name: &tool.name,
                    description: &tool.description,
                    parameters: Parameters {
                        properties,
                        required: &tool.required,
                        r#type: "object",
                    },
                    strict: false,
                })
                .collect()
        }),
        reasoning,
        include: include.then_some(["reasoning.encrypted_content"]),
    };
    let headers = headers::merge(&headers::Merge {
        model: req.model_headers.as_ref(),
        session: session.filter(|s| !s.is_empty()),
        send_session_id: req.compat.send_session_id_header.unwrap_or(true),
        options: req.headers.as_ref(),
        api_key,
    })?;
    Ok(json!({
        "url": url,
        "headers": headers,
        "body": serde_json::to_string(&body).map_err(|e| e.to_string())?,
    }))
}
