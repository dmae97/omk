//! Image conversion ported from the Node Anthropic provider and transform-messages.ts (MIT).
use crate::{
    request_blocks::{ImageSource, WireBlock},
    request_images::omission,
};
use serde::Deserialize;

pub(crate) const USER_IMAGE: &str = "(image omitted: model does not support images)";
pub(crate) const TOOL_IMAGE: &str = "(tool image omitted: model does not support images)";

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
pub(crate) enum InputContent {
    Text {
        text: String,
    },
    Image {
        data: String,
        #[serde(rename = "mimeType")]
        mime_type: String,
    },
}

pub(crate) fn texts<'a>(
    content: &'a [InputContent],
    placeholder: &'a str,
) -> Result<Vec<&'a str>, String> {
    if content.len() > 4096 {
        return Err("history content exceeds 4096 blocks".into());
    }
    let mut result = Vec::new();
    let mut previous_was_placeholder = false;
    for block in content {
        match block {
            InputContent::Text { text } => {
                result.push(text.as_str());
                previous_was_placeholder = text == placeholder;
            }
            InputContent::Image { .. } => {
                if !previous_was_placeholder {
                    result.push(placeholder);
                }
                previous_was_placeholder = true;
            }
        }
    }
    Ok(result)
}

pub(crate) fn convert<'a>(
    content: &'a [InputContent],
    vision: bool,
    placeholder: &'a str,
) -> Result<Vec<WireBlock<'a>>, String> {
    if !vision {
        return Ok(texts(content, placeholder)?
            .into_iter()
            .map(|text| WireBlock::Text { text: text.into() })
            .collect());
    }
    if content.len() > 4096 {
        return Err("history content exceeds 4096 blocks".into());
    }
    Ok(content
        .iter()
        .map(|block| match block {
            InputContent::Text { text } => WireBlock::Text { text: text.into() },
            InputContent::Image { data, mime_type } => match omission(data) {
                Some(text) => WireBlock::Text { text: text.into() },
                None => WireBlock::Image {
                    source: ImageSource {
                        r#type: "base64",
                        media_type: mime_type,
                        data,
                    },
                },
            },
        })
        .collect())
}
