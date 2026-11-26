//! Explicit request caching; no environment reads or cache-affinity/session policy.
use crate::request::Input;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::borrow::Cow;

#[derive(Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Retention {
    #[default]
    None,
    Short,
    Long,
}

#[derive(Default)]
pub enum Boundary {
    #[default]
    Missing,
    Present(Value),
}
impl<'de> Deserialize<'de> for Boundary {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Value::deserialize(d).map(Self::Present)
    }
}
impl Boundary {
    pub(crate) fn is_missing(&self) -> bool {
        matches!(self, Self::Missing)
    }
}
#[derive(Clone, Copy, Serialize)]
pub(crate) struct Control {
    r#type: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    ttl: Option<&'static str>,
}
pub(crate) fn control(model: &Value, retention: Retention) -> Option<Control> {
    match retention {
        Retention::None => None,
        retention => Some(Control {
            r#type: "ephemeral",
            ttl: (matches!(retention, Retention::Long)
                && model["compat"]["supportsLongCacheRetention"]
                    .as_bool()
                    .unwrap_or(model["provider"] != "fireworks"))
            .then_some("1h"),
        }),
    }
}
#[derive(Serialize)]
pub(crate) struct Text<'a> {
    pub r#type: &'static str,
    pub text: Cow<'a, str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_control: Option<Control>,
}
pub(crate) fn system(input: &Input, cache: Option<Control>) -> Vec<Text<'_>> {
    if input.system.is_empty() {
        return vec![];
    }
    let bypass = input.system_prompt_cache_boundary_bypass;
    let units: Vec<_> = input.system.encode_utf16().collect();
    let boundary = match &input.system_prompt_cache_boundary {
        Boundary::Present(Value::Number(n)) if cache.is_some() && !bypass => n
            .as_f64()
            .filter(|n| *n > 0.0 && n.fract() == 0.0 && *n <= units.len() as f64)
            .map(|n| n as usize),
        _ => None,
    };
    if let Some(n) = boundary {
        let mut blocks = vec![Text {
            r#type: "text",
            text: char::decode_utf16(units[..n].iter().copied())
                .filter_map(Result::ok)
                .collect::<String>()
                .into(),
            cache_control: cache,
        }];
        if n < units.len() {
            blocks.push(Text {
                r#type: "text",
                text: char::decode_utf16(units[n..].iter().copied())
                    .filter_map(Result::ok)
                    .collect::<String>()
                    .into(),
                cache_control: None,
            });
        }
        blocks
    } else {
        vec![Text {
            r#type: "text",
            text: (&input.system).into(),
            cache_control: if bypass || !input.system_prompt_cache_boundary.is_missing() {
                None
            } else {
                cache
            },
        }]
    }
}
