// Rust adaptation of partial-json 0.1.7, https://github.com/promplate/partial-json-parser-js
// Copyright (c) 2023 Promplate Dev Team, MIT. See PARTIAL-JSON-NOTICE.md.
// Compatibility quirks (prefix returns, skipped colon, lowercase exponent fallback)
// are intentional. The caller supplies bounded input and handles the root nullish fallback.
use crate::json_parse::{JsonError, strict};
use serde_json::{Map, Value};

fn invalid() -> JsonError {
    JsonError::Syntax("invalid partial JSON".into())
}
pub(crate) fn blank(ch: char) -> bool {
    matches!(ch, '\u{9}'..='\u{d}' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
}
pub(crate) fn parse(input: &str) -> Result<Value, JsonError> {
    let text = input.trim_matches(blank);
    Parser { text, index: 0 }.any(0)
}
struct Parser<'a> {
    text: &'a str,
    index: usize,
}
impl Parser<'_> {
    fn peek(&self) -> Option<char> {
        self.text.get(self.index..)?.chars().next()
    }
    fn bump(&mut self) {
        if let Some(ch) = self.peek() {
            self.index += ch.len_utf8();
        }
    }
    fn skip_blank(&mut self) {
        while self
            .peek()
            .is_some_and(|c| matches!(c, ' ' | '\n' | '\r' | '\t'))
        {
            self.bump();
        }
    }
    fn any(&mut self, depth: usize) -> Result<Value, JsonError> {
        if depth > 64 {
            return Err(JsonError::Limit("JSON nesting exceeds 64"));
        }
        self.skip_blank();
        match self.peek().ok_or_else(invalid)? {
            '"' => self.string(),
            '{' => self.object(depth),
            '[' => self.array(depth),
            _ => {
                let rest = &self.text[self.index..];
                for (token, value) in [
                    ("null", Value::Null),
                    ("true", Value::Bool(true)),
                    ("false", Value::Bool(false)),
                    ("Infinity", Value::Null),
                    ("-Infinity", Value::Null),
                    ("NaN", Value::Null),
                ] {
                    if rest.starts_with(token)
                        || (token.starts_with(rest) && (token != "-Infinity" || rest.len() > 1))
                    {
                        self.index = self.index.saturating_add(token.len());
                        return Ok(value);
                    }
                }
                self.number()
            }
        }
    }
    fn string(&mut self) -> Result<Value, JsonError> {
        let start = self.index;
        self.bump();
        let mut escape = false;
        while let Some(ch) = self.peek() {
            if ch == '"' && !escape {
                self.bump();
                return strict(&self.text[start..self.index], true);
            }
            escape = ch == '\\' && !escape;
            self.bump();
        }
        let end = self.index.saturating_sub(usize::from(escape));
        if let Ok(value) = strict(&format!("{}\"", &self.text[start..end]), true) {
            return Ok(value);
        }
        // JS substring swaps start/end when an earlier escape is the last one.
        let end = self.text.rfind('\\').unwrap_or(0);
        strict(
            &format!("{}\"", &self.text[start.min(end)..start.max(end)]),
            true,
        )
    }
    fn object(&mut self, depth: usize) -> Result<Value, JsonError> {
        self.bump();
        self.skip_blank();
        let mut object = Map::new();
        while self.peek() != Some('}') {
            self.skip_blank();
            if self.peek().is_none() {
                return Ok(Value::Object(object));
            }
            let key = match self.string() {
                Ok(Value::String(key)) => key,
                _ => return Ok(Value::Object(object)),
            };
            self.skip_blank();
            self.bump(); // Node's partial parser skips the colon without validating it.
            let value = match self.any(depth + 1) {
                Ok(value) => value,
                Err(error @ (JsonError::Limit(_) | JsonError::Unsupported(_))) => {
                    return Err(error);
                }
                Err(JsonError::Syntax(_)) => return Ok(Value::Object(object)),
            };
            // JS's __proto__ setter is not an enumerable own property. Rust never executes it.
            if key != "__proto__" {
                object.insert(key, value);
            }
            self.skip_blank();
            if self.peek() == Some(',') {
                self.bump();
            }
        }
        self.bump();
        Ok(Value::Object(object))
    }
    fn array(&mut self, depth: usize) -> Result<Value, JsonError> {
        self.bump();
        let mut values = Vec::new();
        while self.peek() != Some(']') {
            match self.any(depth + 1) {
                Ok(value) => values.push(value),
                Err(error @ (JsonError::Limit(_) | JsonError::Unsupported(_))) => {
                    return Err(error);
                }
                Err(JsonError::Syntax(_)) => return Ok(Value::Array(values)),
            }
            self.skip_blank();
            if self.peek() == Some(',') {
                self.bump();
            }
        }
        self.bump();
        Ok(Value::Array(values))
    }
    fn number(&mut self) -> Result<Value, JsonError> {
        let start = self.index;
        let end = if start == 0 {
            self.text.len()
        } else {
            while self.peek().is_some_and(|c| !matches!(c, ',' | ']' | '}')) {
                self.bump();
            }
            self.index
        };
        match strict(&self.text[start..end], true) {
            Ok(value) => return Ok(value),
            Err(JsonError::Syntax(_)) => {}
            Err(error) => return Err(error),
        }
        let end = self.text.rfind('e').unwrap_or(0);
        strict(&self.text[start.min(end)..start.max(end)], true)
    }
}
