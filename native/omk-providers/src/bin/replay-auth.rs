//! Offline diagnostic: only supplied stdin data is resolved; no files, ambient env or dispatch.
use omk_providers::auth::{KeySources, Snapshot, resolve_config};
use serde::Deserialize;
use serde_json::json;
use std::{
    collections::BTreeMap,
    io::{self, Read},
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Input {
    config: Option<String>,
    store: Option<String>,
    runtime: Option<String>,
    environment: Option<String>,
    fallback: Option<String>,
    include_fallback: Option<bool>,
    #[serde(default)]
    load_error: bool,
    #[serde(default)]
    env: BTreeMap<String, String>,
}
fn run() -> Result<(), &'static str> {
    let mut bytes = Vec::new();
    io::stdin()
        .take(2 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "input read failed")?;
    if bytes.len() > 2 * 1024 * 1024 {
        return Err("input exceeds 2 MiB");
    }
    let input: Input = serde_json::from_slice(&bytes).map_err(|_| "invalid replay input")?;
    let env = |name: &str| input.env.get(name).cloned();
    let result = if let Some(config) = input.config {
        if input.store.is_some()
            || input.runtime.is_some()
            || input.environment.is_some()
            || input.fallback.is_some()
            || input.include_fallback.is_some()
            || input.load_error
        {
            return Err("ambiguous replay input");
        }
        resolve_config(&config, env)
    } else {
        Snapshot::from_json(if input.load_error {
            Err(())
        } else {
            Ok(input.store.as_deref())
        })
        .resolve(
            "anthropic",
            KeySources {
                runtime: input.runtime.as_deref(),
                environment: input.environment.as_deref(),
                fallback: input.fallback.as_deref(),
                include_fallback: input.include_fallback.unwrap_or(true),
            },
            env,
        )
    };
    match result {
        Ok(key) => println!(
            "{}",
            json!({"key":key.as_ref().map(|key| key.expose()),"blocked":false})
        ),
        Err(omk_providers::auth::Error::UnavailableStore) => {
            println!("{}", json!({"key":null,"blocked":true}))
        }
        Err(_) => return Err("unsupported credential policy"),
    }
    Ok(())
}
fn main() -> std::process::ExitCode {
    match run() {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("auth replay refused: {error}");
            std::process::ExitCode::FAILURE
        }
    }
}
