//! Explicit Anthropic options; no ambient cache preference or simple-option inference.
use serde::{Deserialize, Serialize};
use serde_json::{Number, Value};

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Options {
    #[serde(default)]
    cache_retention: crate::request_cache::Retention,
    temperature: Option<Number>,
    thinking_enabled: Option<bool>,
    thinking_budget_tokens: Option<u32>,
    thinking_display: Option<ThinkingDisplay>,
    effort: Option<Effort>,
    metadata: Option<Value>,
    tool_choice: Option<Choice>,
}
#[derive(Clone, Copy, Default, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ThinkingDisplay {
    #[default]
    Summarized,
    Omitted,
}
#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum Effort {
    Low,
    Medium,
    High,
    Xhigh,
    Max,
}
#[derive(Deserialize)]
#[serde(untagged)]
enum Choice {
    Mode(Mode),
    Tool(NamedTool),
}
#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Mode {
    Auto,
    Any,
    None,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NamedTool {
    r#type: ToolTag,
    name: String,
}
#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
enum ToolTag {
    Tool,
}
#[derive(Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub(crate) enum Thinking {
    Adaptive {
        display: ThinkingDisplay,
    },
    Enabled {
        budget_tokens: u32,
        display: ThinkingDisplay,
    },
    Disabled,
}
#[derive(Serialize)]
pub(crate) struct OutputConfig {
    effort: Effort,
}
#[derive(Serialize)]
pub(crate) struct Metadata<'a> {
    user_id: &'a str,
}
#[derive(Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub(crate) enum ToolChoice<'a> {
    Auto,
    Any,
    None,
    Tool { name: &'a str },
}
#[derive(Default)]
pub(crate) struct Policy<'a> {
    pub allow_empty_signature: bool,
    pub cache: Option<crate::request_cache::Control>,
    pub cache_tools: bool,
    pub temperature: Option<Number>,
    pub thinking: Option<Thinking>,
    pub output_config: Option<OutputConfig>,
    pub metadata: Option<Metadata<'a>>,
    pub tool_choice: Option<ToolChoice<'a>>,
}
impl<'a> Policy<'a> {
    pub fn new(model: &Value, options: Option<&'a Options>) -> Result<Self, String> {
        let mut p = Self {
            allow_empty_signature: model["compat"]["allowEmptySignature"] == true,
            ..Self::default()
        };
        let Some(o) = options else {
            return Ok(p);
        };
        p.cache = crate::request_cache::control(model, o.cache_retention);
        p.cache_tools = model["compat"]["supportsCacheControlOnTools"]
            .as_bool()
            .unwrap_or(model["provider"] != "fireworks");
        if let Some(n) = &o.temperature {
            let n = n
                .as_f64()
                .filter(|n| (0.0..=1.0).contains(n))
                .ok_or("invalid temperature")?;
            if o.thinking_enabled != Some(true) && model["compat"]["supportsTemperature"] != false {
                p.temperature = Some(if n == 0.0 || n == 1.0 {
                    Number::from(n as u8)
                } else {
                    Number::from_f64(n).unwrap()
                });
            }
        }
        if model["reasoning"] == true {
            if o.thinking_enabled == Some(true) {
                let display = o.thinking_display.unwrap_or_default();
                if model["compat"]["forceAdaptiveThinking"] == true {
                    p.thinking = Some(Thinking::Adaptive { display });
                    p.output_config = o.effort.map(|effort| OutputConfig { effort });
                } else {
                    p.thinking = Some(Thinking::Enabled {
                        budget_tokens: o.thinking_budget_tokens.filter(|n| *n != 0).unwrap_or(1024),
                        display,
                    });
                }
            } else if o.thinking_enabled == Some(false)
                && model["compat"]["supportsDisabledThinking"]
                    .as_bool()
                    .unwrap_or_else(|| !always_thinks(model["id"].as_str().unwrap_or_default()))
            {
                p.thinking = Some(Thinking::Disabled);
            }
        }
        p.metadata = o
            .metadata
            .as_ref()
            .and_then(|m| m["user_id"].as_str())
            .map(|user_id| Metadata { user_id });
        p.tool_choice = match &o.tool_choice {
            Some(Choice::Mode(Mode::Auto)) => Some(ToolChoice::Auto),
            Some(Choice::Mode(Mode::Any)) => Some(ToolChoice::Any),
            Some(Choice::Mode(Mode::None)) => Some(ToolChoice::None),
            Some(Choice::Tool(tool)) => {
                if tool.name.is_empty() || tool.name.len() > 256 {
                    return Err("invalid tool choice".into());
                }
                let ToolTag::Tool = tool.r#type;
                Some(ToolChoice::Tool { name: &tool.name })
            }
            None => None,
        };
        Ok(p)
    }
}
fn always_thinks(id: &str) -> bool {
    std::iter::once(id)
        .chain(id.match_indices(['/', '.']).map(|(i, _)| &id[i + 1..]))
        .any(|part| {
            part.starts_with("claude-fable-")
                || ["claude-opus-5.5", "claude-opus-5-5"].iter().any(|prefix| {
                    part.strip_prefix(prefix).is_some_and(|tail| {
                        tail.as_bytes().first().is_none_or(|b| !b.is_ascii_digit())
                    })
                })
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn disabled_thinking_defaults_match_observed_node_model_names_and_override() {
        let options: Options = serde_json::from_value(json!({"thinkingEnabled":false})).unwrap();
        for (id, disabled) in [
            ("claude-fable-5", false),
            ("proxy/claude-fable-5", false),
            ("proxy.claude-fable-5", false),
            ("claude-opus-5.5", false),
            ("claude-opus-5-5-beta", false),
            ("claude-opus-5-50", true),
            ("xclaude-fable-5", true),
            ("claude-sonnet-5-5", true),
        ] {
            let mut model = json!({"id":id,"reasoning":true});
            assert_eq!(
                Policy::new(&model, Some(&options))
                    .unwrap()
                    .thinking
                    .is_some(),
                disabled,
                "{id}"
            );
            model["compat"] = json!({"supportsDisabledThinking":!disabled});
            assert_eq!(
                Policy::new(&model, Some(&options))
                    .unwrap()
                    .thinking
                    .is_some(),
                !disabled
            );
        }
    }
    #[test]
    fn numeric_temperature_spelling_is_canonical_and_ignored_metadata_is_not_emitted() {
        for (raw, expected) in [("-0.0", "0"), ("0.0", "0"), ("1.0", "1"), ("1e-1", "0.1")] {
            let options: Options = serde_json::from_str(&format!(
                "{{\"temperature\":{raw},\"metadata\":{{\"user_id\":123}}}}"
            ))
            .unwrap();
            let p = Policy::new(&json!({}), Some(&options)).unwrap();
            assert_eq!(p.temperature.unwrap().to_string(), expected);
            assert!(p.metadata.is_none());
        }
    }
}
