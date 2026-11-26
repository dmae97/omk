//! Port of buildParams' thinkingFormat branches (packages/ai/src/providers/openai-completions.ts).
//! `thinkingFormat` and `supportsReasoningEffort` are caller-resolved; only the Model Studio host
//! test that buildParams itself performs is reproduced here.
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Deserialize, Clone, Copy, Default, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub(super) enum Format {
    #[default]
    Openai,
    Openrouter,
    Deepseek,
    Together,
    Zai,
    Qwen,
    QwenChatTemplate,
    StringThinking,
    AntLing,
}
#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Level {
    Off,
    Minimal,
    Low,
    Medium,
    High,
    Xhigh,
    Max,
    Ultra,
}
impl Level {
    pub(crate) fn name(self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::Minimal => "minimal",
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
            Self::Xhigh => "xhigh",
            Self::Max => "max",
            Self::Ultra => "ultra",
        }
    }
}
/// Absent key and explicit null differ only for `off`; lookups otherwise treat both as missing.
pub(crate) type LevelMap = HashMap<Level, Option<String>>;

#[derive(Serialize)]
#[serde(untagged)]
enum Reasoning {
    Effort { effort: String },
    Enabled { enabled: bool },
}
#[derive(Serialize)]
struct TemplateKwargs {
    enable_thinking: bool,
    preserve_thinking: bool,
}
#[derive(Serialize)]
#[serde(untagged)]
enum Thinking {
    Toggle { r#type: &'static str },
    Level(String),
}
/// Field order covers every format's Node emission order (each format uses a disjoint subset).
#[derive(Serialize, Default)]
pub(super) struct Params {
    #[serde(skip_serializing_if = "Option::is_none")]
    enable_thinking: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    chat_template_kwargs: Option<TemplateKwargs>,
    #[serde(skip_serializing_if = "Option::is_none")]
    thinking: Option<Thinking>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning: Option<Reasoning>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning_effort: Option<String>,
}

pub(super) struct Model<'a> {
    pub id: &'a str,
    pub base_url: &'a str,
    pub reasoning: bool,
    pub format: Format,
    pub supports_effort: Option<bool>,
    pub effort: Option<Level>,
    pub map: Option<&'a LevelMap>,
}

/// buildParams' URL test; `base` has already passed `endpoint`'s canonical-URL admission.
fn model_studio(base: &str) -> bool {
    let Some(rest) = base.strip_prefix("https://") else {
        return false;
    };
    let host = rest.split(['/', ':']).next().unwrap_or("");
    host.ends_with(".maas.aliyuncs.com")
        || matches!(
            host,
            "dashscope.aliyuncs.com"
                | "dashscope-intl.aliyuncs.com"
                | "dashscope-us.aliyuncs.com"
                | "coding.dashscope.aliyuncs.com"
                | "coding-intl.dashscope.aliyuncs.com"
        )
}

pub(super) fn params(m: &Model) -> Result<Params, String> {
    if m.effort == Some(Level::Off) {
        return Err("reasoningEffort cannot be off; omit it instead".into());
    }
    if (m.effort.is_some() || m.map.is_some()) && m.supports_effort.is_none() {
        return Err("reasoning parameters need caller-resolved supportsReasoningEffort".into());
    }
    let supports = m.supports_effort.unwrap_or(false);
    let entry = |level: Level| m.map.and_then(|map| map.get(&level));
    let mapped = |level: Level| entry(level).cloned().flatten();
    let chosen = m
        .effort
        .map(|e| mapped(e).unwrap_or_else(|| e.name().into()));
    // Node: `map?.off !== null` (absent counts as not null); `map?.off ?? "none"`.
    let off_allowed = !matches!(entry(Level::Off), Some(None));
    let off_or_none = || mapped(Level::Off).unwrap_or_else(|| "none".into());
    let on = m.effort.is_some();
    let mut p = Params::default();
    if !m.reasoning {
        return Ok(p);
    }
    match m.format {
        Format::Zai => {
            p.enable_thinking = Some(on);
            p.reasoning_effort = chosen.filter(|_| supports);
        }
        Format::Qwen => {
            p.enable_thinking = Some(on);
            if let Some(effort) = m.effort.filter(|_| supports && model_studio(m.base_url)) {
                let fallback = if effort == Level::Minimal && m.id.starts_with("deepseek-v4-") {
                    "low"
                } else {
                    effort.name()
                };
                p.reasoning_effort = Some(mapped(effort).unwrap_or_else(|| fallback.into()));
            }
        }
        Format::QwenChatTemplate => {
            p.chat_template_kwargs = Some(TemplateKwargs {
                enable_thinking: on,
                preserve_thinking: true,
            });
        }
        Format::Deepseek => {
            p.thinking = Some(Thinking::Toggle {
                r#type: if on { "enabled" } else { "disabled" },
            });
            p.reasoning_effort = chosen.filter(|_| supports);
        }
        Format::Openrouter => {
            p.reasoning = match chosen {
                Some(effort) => Some(Reasoning::Effort { effort }),
                None if off_allowed => Some(match off_or_none() {
                    off if off == "none" => Reasoning::Enabled { enabled: false },
                    effort => Reasoning::Effort { effort },
                }),
                None => None,
            };
        }
        Format::AntLing if on => {
            p.reasoning = m
                .effort
                .and_then(mapped)
                .map(|effort| Reasoning::Effort { effort });
        }
        Format::Together => {
            p.reasoning = Some(Reasoning::Enabled { enabled: on });
            p.reasoning_effort = chosen.filter(|_| supports);
        }
        Format::StringThinking => {
            p.thinking = match chosen {
                Some(level) => Some(Thinking::Level(level)),
                None => off_allowed.then(|| Thinking::Level(off_or_none())),
            };
        }
        // OpenAI-style, plus ant-ling without an effort (Node's final else-if branches).
        Format::Openai | Format::AntLing => {
            p.reasoning_effort = chosen.or_else(|| mapped(Level::Off)).filter(|_| supports);
        }
    }
    Ok(p)
}
