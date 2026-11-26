// models.json merge semantics from packages/coding-agent/src/core/model-registry.ts (MIT).
use serde::{
    Deserialize,
    de::{MapAccess, Visitor},
};
use serde_json::{Value, json};
use std::fmt;

fn clean(text: &str) -> Result<String, ()> {
    if text.len() > 1024 * 1024 {
        return Err(());
    }
    // Match Node's line comments and trailing commas, without changing quoted strings.
    let mut out = String::new();
    let mut chars = text.chars().peekable();
    let (mut quoted, mut escaped) = (false, false);
    while let Some(c) = chars.next() {
        if quoted {
            out.push(c);
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == '"' {
                quoted = false;
            }
        } else if c == '"' {
            quoted = true;
            out.push(c);
        } else if c == '/' && chars.peek() == Some(&'/') {
            for next in chars.by_ref() {
                if next == '\n' {
                    out.push('\n');
                    break;
                }
            }
        } else {
            out.push(c);
        }
    }
    let mut chars = out.chars().peekable();
    let mut clean = String::new();
    (quoted, escaped) = (false, false);
    while let Some(c) = chars.next() {
        if !quoted && c == ',' {
            let mut look = chars.clone();
            if matches!(
                look.find(|c| matches!(c, '}' | ']') || !c.is_whitespace()),
                Some('}' | ']')
            ) {
                continue;
            }
        }
        clean.push(c);
        if escaped {
            escaped = false;
        } else if quoted && c == '\\' {
            escaped = true;
        } else if c == '"' {
            quoted = !quoted;
        }
    }
    Ok(clean)
}
pub(crate) fn has_visibility(text: &str) -> bool {
    clean(text)
        .ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .is_some_and(|v| v.get("visibility").is_some())
}
pub(crate) fn parse(text: &str) -> Result<(Value, Vec<String>), ()> {
    let clean = clean(text)?;
    let config: Value = serde_json::from_str(&clean).map_err(|_| ())?;
    let providers = config
        .get("providers")
        .and_then(Value::as_object)
        .ok_or(())?;
    if providers.len() > 4096 {
        return Err(());
    }
    for (name, provider) in providers {
        if name == "grok-oauth-proxy" {
            continue;
        }
        super::catalog::validate_provider(provider)?;
    }
    if let Some(visibility) = config.get("visibility") {
        let visibility = visibility.as_object().ok_or(())?;
        if let Some(p) = visibility.get("providers") {
            strings(p)?;
        }
        if let Some(models) = visibility.get("models") {
            for ids in models.as_object().ok_or(())?.values() {
                strings(ids)?;
            }
        }
    }
    #[derive(Deserialize)]
    struct Ordered {
        providers: Order,
    }
    let ordered: Ordered = serde_json::from_str(&clean).map_err(|_| ())?;
    Ok((config, ordered.providers.0))
}
struct Order(Vec<String>);
impl<'de> Deserialize<'de> for Order {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct Keys;
        impl<'de> Visitor<'de> for Keys {
            type Value = Order;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("provider map")
            }
            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Order, A::Error> {
                let mut keys = Vec::new();
                while let Some((key, _)) = map.next_entry::<String, Value>()? {
                    if !keys.contains(&key) {
                        keys.push(key);
                    }
                }
                // ECMAScript enumerates integer property keys before insertion-ordered strings.
                keys.sort_by_key(|key| {
                    key.parse::<u32>()
                        .ok()
                        .filter(|n| *n < u32::MAX && n.to_string() == *key)
                        .map_or((1, 0), |n| (0, n))
                });
                Ok(Order(keys))
            }
        }
        d.deserialize_map(Keys)
    }
}
pub(crate) fn strings(v: &Value) -> Result<(), ()> {
    if v.as_array()
        .ok_or(())?
        .iter()
        .any(|s| s.as_str().is_none_or(str::is_empty))
    {
        return Err(());
    }
    Ok(())
}
pub(crate) fn normalize(model: &mut Value) {
    if model["api"] != "anthropic-messages" {
        return;
    }
    if let Some(url) = model["baseUrl"].as_str() {
        let end = url.strip_suffix('/').unwrap_or(url);
        if let Some((base, version)) = end.rsplit_once('/')
            && version
                .strip_prefix(['v', 'V'])
                .is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
        {
            model["baseUrl"] = json!(base);
        }
    }
}
pub(crate) fn merge(base: &Value, overlay: &Value) -> Value {
    if !overlay.is_object() {
        return base.clone();
    }
    let mut merged = base.as_object().cloned().unwrap_or_default();
    for (key, value) in overlay.as_object().unwrap() {
        merged.insert(key.clone(), value.clone());
    }
    for key in ["openRouterRouting", "vercelGatewayRouting"] {
        if base[key].is_object() || overlay[key].is_object() {
            merged.insert(key.into(), merge(&base[key], &overlay[key]));
        }
    }
    Value::Object(merged)
}
pub(crate) fn apply(model: &mut Value, overlay: &Value) {
    for key in ["name", "reasoning", "input", "contextWindow", "maxTokens"] {
        if let Some(value) = overlay.get(key) {
            model[key] = value.clone();
        }
    }
    for key in ["cost", "compat", "thinkingLevelMap"] {
        if overlay.get(key).is_some() {
            model[key] = merge(&model[key], &overlay[key]);
        }
    }
}
