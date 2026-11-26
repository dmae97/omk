use omk_providers::openai_completions::{Input, build_request};
use std::io::{self, Read};

const LIMIT: u64 = 2 * 1024 * 1024;

fn run() -> Result<(), String> {
    let mut bytes = Vec::new();
    io::stdin()
        .take(LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > LIMIT {
        return Err("input exceeds 2 MiB".into());
    }
    let input: Input = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    // Synthetic replay only: the credential is fixed and never read from the environment.
    println!("{}", build_request(&input, "faux-key")?);
    Ok(())
}
fn main() -> std::process::ExitCode {
    match run() {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("request refused: {error}");
            std::process::ExitCode::FAILURE
        }
    }
}
