// Matches the non-command template grammar in core/resolve-config-value.ts.
use crate::auth::{Error, Secret, bounded_secret};

fn initial(byte: u8) -> bool {
    byte.is_ascii_alphabetic() || byte == b'_'
}
fn continuation(byte: u8) -> bool {
    initial(byte) || byte.is_ascii_digit()
}
fn variable(name: &str) -> bool {
    let bytes = name.as_bytes();
    bytes.first().is_some_and(|byte| initial(*byte)) && bytes.iter().all(|byte| continuation(*byte))
}
/// Does not read ambient environment or execute shell commands, including expanded commands.
pub fn resolve_config(
    config: &str,
    env: impl Fn(&str) -> Option<String>,
) -> Result<Option<Secret>, Error> {
    if config.len() > 65536 {
        return Err(Error::InvalidInput);
    }
    if config.starts_with('!') {
        return Err(Error::CommandRequiresHost);
    }
    let mut remaining = config;
    let mut output = String::new();
    while let Some(index) = remaining.find('$') {
        output.push_str(&remaining[..index]);
        remaining = &remaining[index + 1..];
        match remaining.as_bytes().first().copied() {
            Some(b'$' | b'!') => {
                output.push(char::from(remaining.as_bytes()[0]));
                remaining = &remaining[1..];
            }
            Some(b'{') => {
                if let Some(end) = remaining.find('}') {
                    let name = &remaining[1..end];
                    if variable(name) {
                        let Some(value) = env(name).filter(|value| !value.is_empty()) else {
                            return Ok(None);
                        };
                        if output.len().saturating_add(value.len()) > 65536 {
                            return Err(Error::InvalidInput);
                        }
                        output.push_str(&value);
                    } else {
                        output.push('$');
                        output.push_str(&remaining[..=end]);
                    }
                    remaining = &remaining[end + 1..];
                } else {
                    output.push('$');
                }
            }
            Some(byte) if initial(byte) => {
                let end = remaining
                    .bytes()
                    .take_while(|byte| continuation(*byte))
                    .count();
                let Some(value) = env(&remaining[..end]).filter(|value| !value.is_empty()) else {
                    return Ok(None);
                };
                if output.len().saturating_add(value.len()) > 65536 {
                    return Err(Error::InvalidInput);
                }
                output.push_str(&value);
                remaining = &remaining[end..];
            }
            _ => output.push('$'),
        }
        if output.len() > 65536 {
            return Err(Error::InvalidInput);
        }
    }
    output.push_str(remaining);
    bounded_secret(&output).map(Some)
}
