use omk_providers::{
    anthropic::Input,
    auth::{KeySources, Snapshot},
    catalog::Catalog,
    dispatch,
    transport::{Cancellation, Limits, Transport},
};
use serde::Deserialize;
use serde_json::json;
use std::{
    collections::BTreeMap,
    io::{self, Read, Write},
    time::Duration,
};
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CatalogInput {
    overlay: Option<String>,
    #[serde(default)]
    providers: Vec<String>,
    #[serde(default)]
    authenticated: Vec<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StreamInput {
    overlay: Option<String>,
    provider: String,
    input: Input,
    store: Option<String>,
    runtime: Option<String>,
    environment: Option<String>,
    #[serde(default)]
    env: BTreeMap<String, String>,
    timeout_ms: Option<u64>,
    max_response_bytes: Option<usize>,
}
fn run() -> Result<(), String> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.len() != 1 || !matches!(args[0].as_str(), "catalog" | "stream") {
        return Err("expected catalog or stream command".into());
    }
    let mut raw = String::new();
    io::stdin()
        .take(2 * 1024 * 1024 + 1)
        .read_to_string(&mut raw)
        .map_err(|_| "input read failed")?;
    if raw.len() > 2 * 1024 * 1024 {
        return Err("input exceeds 2 MiB".into());
    }
    if args[0] == "catalog" {
        let input: CatalogInput =
            serde_json::from_str(&raw).map_err(|_| "invalid catalog input")?;
        println!(
            "{}",
            Catalog::load(input.overlay.as_deref()).view(&input.providers, &input.authenticated)
        );
        return Ok(());
    }
    let input: StreamInput = serde_json::from_str(&raw).map_err(|_| "invalid stream input")?;
    let timeout = input.timeout_ms.unwrap_or(30000);
    if timeout == 0 || timeout > 30000 {
        return Err("timeoutMs must be 1 through 30000".into());
    }
    let bound = input.max_response_bytes.unwrap_or(8 * 1024 * 1024);
    if bound > 8 * 1024 * 1024 {
        return Err("response bound exceeds 8 MiB".into());
    }
    let catalog = Catalog::load(input.overlay.as_deref());
    let snapshot = Snapshot::from_json(Ok(input.store.as_deref()));
    let prepared = dispatch::prepare(
        &catalog,
        &input.provider,
        &input.input,
        &snapshot,
        KeySources {
            runtime: input.runtime.as_deref(),
            environment: input.environment.as_deref(),
            fallback: None,
            include_fallback: true,
        },
        |key| input.env.get(key).cloned(),
    )
    .map_err(|e| e.to_string())?;
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|_| "runtime unavailable")?;
    runtime.block_on(async {
        let transport = Transport::new().map_err(|_| "transport unavailable")?;
        let cancellation = Cancellation::default();
        let mut stdout = io::stdout().lock();
        let mut failed = false;
        let result = prepared
            .send(
                &transport,
                Limits {
                    deadline: tokio::time::Instant::now() + Duration::from_millis(timeout),
                    max_response_bytes: bound,
                },
                &cancellation,
                |event| {
                    if writeln!(stdout, "{}", json!({"event":event}))
                        .and_then(|()| stdout.flush())
                        .is_err()
                    {
                        failed = true;
                        cancellation.cancel();
                    }
                },
            )
            .await
            .map_err(|e| e.to_string())?;
        if failed {
            return Err("output failed".into());
        }
        writeln!(stdout, "{}", json!({"result":result.result}))
            .and_then(|()| stdout.flush())
            .map_err(|_| "output failed".into())
    })
}
fn main() {
    if let Err(error) = run() {
        eprintln!("provider refused: {error}");
        std::process::exit(1);
    }
}
