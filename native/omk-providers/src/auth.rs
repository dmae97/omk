//! Read-only credential snapshots. The host owns file locks, environment selection and refresh.
use serde_json::Value;
use std::{collections::BTreeMap, fmt};

#[derive(Debug, PartialEq, Eq)]
pub enum Error {
    InvalidInput,
    UnavailableStore,
    InvalidCredential,
    CommandRequiresHost,
    OAuthRequiresHost,
}
impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::InvalidInput => "credential input exceeds its bound",
            Self::UnavailableStore => "credential store unavailable",
            Self::InvalidCredential => "invalid stored credential",
            Self::CommandRequiresHost => "credential command requires host execution",
            Self::OAuthRequiresHost => "OAuth credential requires host refresh ownership",
        })
    }
}
impl std::error::Error for Error {}
/// Deliberately neither serializable nor printable. Exposure is an explicit caller action.
pub struct Secret(pub(crate) String);
impl Secret {
    pub fn expose(&self) -> &str {
        &self.0
    }
}
impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("[REDACTED]")
    }
}
/// `environment` is already selected by the host's provider-specific environment policy.
pub struct KeySources<'a> {
    pub runtime: Option<&'a str>,
    pub environment: Option<&'a str>,
    pub fallback: Option<&'a str>,
    pub include_fallback: bool,
}
/// An unreadable/malformed store is retained as failure, never converted to an empty map.
pub struct Snapshot(Result<BTreeMap<String, Value>, ()>);
impl Snapshot {
    pub fn from_json(raw: Result<Option<&str>, ()>) -> Self {
        Self(raw.and_then(|text| {
            let text = text.filter(|text| !text.is_empty()).unwrap_or("{}");
            if text.len() > 1024 * 1024 {
                return Err(());
            }
            let mut data: BTreeMap<String, Value> = serde_json::from_str(text).map_err(|_| ())?;
            data.remove("grok-oauth-proxy");
            Ok(data)
        }))
    }
    pub fn resolve(
        &self,
        provider: &str,
        sources: KeySources<'_>,
        env: impl Fn(&str) -> Option<String>,
    ) -> Result<Option<Secret>, Error> {
        if let Some(key) = sources.runtime.filter(|key| !key.is_empty()) {
            return bounded_secret(key).map(Some);
        }
        let data = self.0.as_ref().map_err(|_| Error::UnavailableStore)?;
        if let Some(credential) = data.get(provider) {
            match credential.get("type").and_then(Value::as_str) {
                Some("api_key") => {
                    let key = credential
                        .get("key")
                        .and_then(Value::as_str)
                        .ok_or(Error::InvalidCredential)?;
                    // A missing referenced variable must not silently select another account.
                    return resolve_config(key, env);
                }
                Some("oauth") => return Err(Error::OAuthRequiresHost),
                _ => return Err(Error::InvalidCredential),
            }
        }
        if let Some(key) = sources.environment.filter(|key| !key.is_empty()) {
            return bounded_secret(key).map(Some);
        }
        if sources.include_fallback
            && let Some(config) = sources.fallback
        {
            return resolve_config(config, env);
        }
        Ok(None)
    }
}
pub(crate) fn bounded_secret(value: &str) -> Result<Secret, Error> {
    if value.len() > 65536 {
        return Err(Error::InvalidInput);
    }
    Ok(Secret(value.into()))
}
pub use crate::config_value::resolve_config;
