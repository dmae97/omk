//! Port of buildParams' prompt_cache_key/prompt_cache_retention and resolveOpenAIPromptCacheKey
//! (openai-prompt-cache.ts, prompt-cache.ts). Retention and supportsLongCacheRetention are
//! caller-resolved; OMK_CACHE_RETENTION is never read.
use super::handoff::short_hash;
use crate::{
    request::Tool,
    request_cache::{Boundary, Retention},
    tool_schema,
};
use serde_json::{Value, value::RawValue};

pub(crate) struct Policy<'a> {
    pub base_url: &'a str,
    pub provider: Option<&'a str>,
    pub model: &'a str,
    pub system: &'a str,
    pub tools: &'a [(&'a Tool, Box<RawValue>)],
    pub retention: Option<Retention>,
    pub supports_long: Option<bool>,
    pub session: Option<&'a str>,
    pub boundary: &'a Boundary,
    pub bypass: bool,
}

/// Returns `(prompt_cache_key, prompt_cache_retention)`.
pub(super) fn fields(p: &Policy) -> Result<(Option<String>, Option<&'static str>), String> {
    // Node's default without OMK_CACHE_RETENTION.
    let retention = p.retention.unwrap_or(Retention::Short);
    let long = match (retention, p.supports_long) {
        (Retention::Long, None) => {
            return Err(
                "long cacheRetention needs caller-resolved supportsLongCacheRetention".into(),
            );
        }
        (Retention::Long, Some(supported)) => supported,
        _ => false,
    };
    let keyed =
        (p.base_url.contains("api.openai.com") && !matches!(retention, Retention::None)) || long;
    let key = if keyed { key(p)? } else { None };
    Ok((key, long.then_some("24h")))
}

pub(crate) fn key(p: &Policy) -> Result<Option<String>, String> {
    let units: Vec<u16> = p.system.encode_utf16().collect();
    let boundary = match p.boundary {
        Boundary::Present(Value::Number(n)) if !p.bypass && !units.is_empty() => n
            .as_f64()
            .filter(|n| *n > 0.0 && n.fract() == 0.0 && *n <= units.len() as f64)
            .map(|n| n as usize),
        _ => None,
    };
    if let Some(n) = boundary {
        return content_key(p, &units[..n]).map(Some);
    }
    if p.bypass || !p.boundary.is_missing() {
        return Ok(None);
    }
    // clampOpenAIPromptCacheKey: first 64 code points.
    Ok(p.session.map(|s| s.chars().take(64).collect()))
}

/// deriveContextPromptCacheKey: canonicalJsonStringify({prefix, scope, tools, version: 1}).
fn content_key(p: &Policy, prefix: &[u16]) -> Result<String, String> {
    let prefix = String::from_utf16(prefix)
        .map_err(|_| "cache boundary splitting a surrogate pair is not supported".to_string())?;
    let provider = p
        .provider
        .ok_or("a content cache key needs an explicit provider")?;
    let json = |s: &str| serde_json::to_string(s).map_err(|e| e.to_string());
    let mut tools = Vec::with_capacity(p.tools.len());
    for (tool, properties) in p.tools {
        let required = tool
            .required
            .iter()
            .map(|r| json(r))
            .collect::<Result<Vec<_>, _>>()?;
        tools.push(format!(
            r#"{{"description":{},"name":{},"parameters":{{"properties":{},"required":[{}],"type":"object"}}}}"#,
            json(&tool.description)?,
            json(&tool.name)?,
            tool_schema::canonical_json(properties)?,
            required.join(","),
        ));
    }
    let fingerprint = format!(
        r#"{{"prefix":{},"scope":{},"tools":[{}],"version":1}}"#,
        json(&prefix)?,
        json(&format!("{provider}/{}", p.model))?,
        tools.join(","),
    );
    Ok(format!("omk-{}", short_hash(&fingerprint)))
}
