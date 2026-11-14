use serde::{Deserialize, Serialize};

/// Only the same-model text history covered by the independent Node oracle.
#[derive(Deserialize)]
#[serde(tag = "role", rename_all = "lowercase", deny_unknown_fields)]
pub(crate) enum HistoryMessage {
    User { text: String },
    Assistant { text: String },
}

#[derive(Serialize)]
pub(crate) struct Text<'a> {
    pub r#type: &'a str,
    pub text: &'a str,
}

#[derive(Serialize)]
#[serde(untagged)]
enum Content<'a> {
    Text(&'a str),
    Blocks([Text<'a>; 1]),
}

#[derive(Serialize)]
pub(crate) struct Message<'a> {
    role: &'a str,
    content: Content<'a>,
}

// ECMAScript trim's whitespace set differs from Rust's, notably U+0085 and U+FEFF.
fn nonblank(text: &str) -> bool {
    text.chars().any(|c| {
        !matches!(c, '\u{0009}'..='\u{000d}' | ' ' | '\u{00a0}' | '\u{1680}'
            | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}'
            | '\u{205f}' | '\u{3000}' | '\u{feff}')
    })
}

pub(crate) fn messages<'a>(history: &'a [HistoryMessage], user: &'a str) -> Vec<Message<'a>> {
    let mut result = Vec::new();
    for message in history {
        let (role, text) = match message {
            HistoryMessage::User { text } => ("user", text.as_str()),
            HistoryMessage::Assistant { text } => ("assistant", text.as_str()),
        };
        if !nonblank(text) {
            continue;
        }
        result.push(Message {
            role,
            content: match message {
                HistoryMessage::User { .. } => Content::Text(text),
                HistoryMessage::Assistant { .. } => Content::Blocks([Text {
                    r#type: "text",
                    text,
                }]),
            },
        });
    }
    if nonblank(user) {
        result.push(Message {
            role: "user",
            content: Content::Text(user),
        });
    }
    result
}
