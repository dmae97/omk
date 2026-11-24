//! Explicit single-attempt Anthropic dispatch; never reads ambient credentials.
use crate::{
    anthropic::{Input, Replay, Stream},
    auth::{KeySources, Snapshot, resolve_config},
    catalog::Catalog,
    request::build_body,
    transport::{self, Cancellation, Limits, Transport},
};
use reqwest::{
    Url,
    header::{HeaderMap, HeaderName, HeaderValue},
};
use serde_json::{Value, json};
#[derive(Debug, PartialEq, Eq)]
pub enum Error {
    InvalidCatalog,
    UnknownModel,
    UnsupportedProvider,
    InvalidRequest,
    MissingCredential,
    Authentication,
    Headers,
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "provider dispatch refused: {self:?}")
    }
}
impl std::error::Error for Error {}
/// Does not implement Debug/Serialize: headers and body may contain user secrets.
pub struct Prepared {
    endpoint: String,
    headers: HeaderMap,
    body: Vec<u8>,
    provider: String,
    model: String,
}
pub fn prepare(
    catalog: &Catalog,
    provider: &str,
    input: &Input,
    snapshot: &Snapshot,
    sources: KeySources<'_>,
    env: impl Fn(&str) -> Option<String>,
) -> Result<Prepared, Error> {
    if catalog.is_invalid() {
        return Err(Error::InvalidCatalog);
    }
    let model = catalog
        .find(provider, &input.model)
        .ok_or(Error::UnknownModel)?;
    if model["api"] != "anthropic-messages"
        || matches!(
            provider,
            "github-copilot" | "cloudflare-ai-gateway" | "kimi-coding"
        )
    {
        return Err(Error::UnsupportedProvider);
    }
    let config = catalog.provider_config(provider);
    let sources = KeySources {
        runtime: sources.runtime,
        environment: sources.environment,
        fallback: sources.fallback.or_else(|| config["apiKey"].as_str()),
        include_fallback: sources.include_fallback,
    };
    let key = snapshot
        .resolve(provider, sources, &env)
        .map_err(|_| Error::Authentication)?
        .filter(|s| !s.expose().is_empty())
        .ok_or(Error::MissingCredential)?;
    if key.expose().contains("sk-ant-oat") {
        return Err(Error::Authentication);
    }
    let eager = model["compat"]["supportsEagerToolInputStreaming"]
        .as_bool()
        .unwrap_or(provider != "fireworks");
    let fallback = provider == "anthropic"
        && matches!(
            input.model.as_str(),
            "claude-fable-5"
                | "claude-fable-5-1"
                | "claude-fable-5-2"
                | "claude-opus-5"
                | "claude-opus-5-5"
                | "claude-sonnet-5-5"
        )
        && Url::parse(model["baseUrl"].as_str().ok_or(Error::InvalidRequest)?)
            .is_ok_and(|u| u.origin().ascii_serialization() == "https://api.anthropic.com");
    let vision = model["input"]
        .as_array()
        .is_some_and(|types| types.contains(&json!("image")));
    let body = build_body(
        input,
        vision,
        eager,
        fallback.then_some("default"),
        crate::request_policy::Policy::new(model, input.options.as_ref())
            .map_err(|_| Error::InvalidRequest)?,
    )
    .map_err(|_| Error::InvalidRequest)?
    .into_bytes();
    if body.len() > 8 * 1024 * 1024 {
        return Err(Error::InvalidRequest);
    }
    let mut headers = HeaderMap::new();
    for (name, value) in [
        ("accept", "application/json"),
        ("anthropic-dangerous-direct-browser-access", "true"),
        ("anthropic-version", "2023-06-01"),
        ("content-type", "application/json"),
        ("x-api-key", key.expose()),
    ] {
        insert(&mut headers, name, value)?;
    }
    let mut beta = Vec::new();
    if fallback {
        beta.push("server-side-fallback-2026-07-01");
    }
    if !input.tools.is_empty() && !eager {
        beta.push("fine-grained-tool-streaming-2025-05-14");
    }
    if model["compat"]["forceAdaptiveThinking"] != true {
        beta.push("interleaved-thinking-2025-05-14");
    }
    if !beta.is_empty() {
        insert(&mut headers, "anthropic-beta", &beta.join(","))?;
    }
    for source in [
        model.get("headers"),
        config.get("headers"),
        catalog.model_headers(provider, &input.model),
    ]
    .into_iter()
    .flatten()
    {
        for (name, value) in source.as_object().ok_or(Error::Headers)? {
            let value = resolve_config(value.as_str().ok_or(Error::Headers)?, &env)
                .map_err(|_| Error::Headers)?
                .ok_or(Error::Headers)?;
            insert(&mut headers, name, value.expose())?;
        }
    }
    if config["authHeader"] == true {
        insert(
            &mut headers,
            "authorization",
            &format!("Bearer {}", key.expose()),
        )?;
    }
    let base = model["baseUrl"].as_str().ok_or(Error::InvalidRequest)?;
    let endpoint = format!("{}/v1/messages", base.trim_end_matches('/'));
    // Validate before any I/O; transport independently enforces its endpoint/framing boundary.
    let url = Url::parse(&endpoint).map_err(|_| Error::InvalidRequest)?;
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(Error::InvalidRequest);
    }
    if headers.contains_key("host")
        || headers.contains_key("content-length")
        || headers.contains_key("transfer-encoding")
    {
        return Err(Error::Headers);
    }
    Ok(Prepared {
        endpoint,
        headers,
        body,
        provider: provider.into(),
        model: input.model.clone(),
    })
}
fn insert(headers: &mut HeaderMap, name: &str, value: &str) -> Result<(), Error> {
    let name = HeaderName::from_bytes(name.as_bytes()).map_err(|_| Error::Headers)?;
    let mut value = HeaderValue::from_str(value).map_err(|_| Error::Headers)?;
    value.set_sensitive(true);
    headers.insert(name, value);
    Ok(())
}
impl Prepared {
    pub async fn send(
        self,
        transport: &Transport,
        limits: Limits,
        cancellation: &Cancellation,
        mut on_event: impl FnMut(Value),
    ) -> Result<Replay, Error> {
        let mut stream = Stream::recorded(&self.model, false);
        let mut parser_failed = false;
        let mut http_status = None;
        // Do not emit start until request preparation and credential resolution have succeeded.
        for event in stream.take_events() {
            on_event(event);
        }
        let response = transport
            .post(
                &self.endpoint,
                self.headers,
                self.body,
                limits,
                cancellation,
                |response, bytes| {
                    if !(200..300).contains(&response.status) {
                        http_status = Some(response.status);
                        return Err(());
                    }
                    let result = stream.feed(bytes);
                    for event in stream.take_events() {
                        on_event(event);
                    }
                    parser_failed = result.is_err();
                    result.map_err(|_| ())
                },
            )
            .await;
        if let Ok(response) = &response
            && !(200..300).contains(&response.status)
        {
            http_status = Some(response.status);
        }
        let aborted = matches!(response, Err(transport::Error::Cancelled));
        let error = http_status
            .map(|_| "provider HTTP status failed".to_string())
            .or_else(|| response.err().map(|e| e.to_string()));
        let mut replay = stream.finish(error, aborted);
        // Provider/SSE errors can contain echoed secrets; this dispatch boundary never exposes their raw bytes.
        if parser_failed || replay.result.get("errorMessage").is_some() {
            replay.result["errorMessage"] = json!(if aborted {
                "Request was aborted"
            } else {
                "provider response failed"
            });
        }
        replay.result["provider"] = json!(self.provider);
        for event in replay.events.as_array().unwrap().iter().cloned() {
            on_event(event);
        }
        Ok(replay)
    }
}
