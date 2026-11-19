use omk_providers::anthropic::{Input, build_request, replay, replay_with_tool_arguments};
use serde::Deserialize;
use serde_json::json;
use std::io::{self, Read};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Recording {
    input: Input,
    chunks: Vec<Vec<u8>>,
    abort: bool,
    #[serde(rename = "abortAfterChunks")]
    abort_after_chunks: Option<usize>,
    #[serde(rename = "observeToolArguments", default)]
    observe_tool_arguments: bool,
}
fn run() -> Result<(), String> {
    let mut bytes = Vec::new();
    io::stdin()
        .take(16 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 16 * 1024 * 1024 {
        return Err("recording exceeds 16 MiB".into());
    }
    let recording: Recording = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    let request = build_request(&recording.input)?;
    let replay_fn = if recording.observe_tool_arguments {
        replay_with_tool_arguments
    } else {
        replay
    };
    let output = replay_fn(
        &recording.input.model,
        &recording.chunks,
        recording
            .abort
            .then_some(0)
            .or(recording.abort_after_chunks),
    )?;
    let mut result = json!({"request":request,"events":output.events,"result":output.result});
    if recording.observe_tool_arguments {
        result["toolArguments"] = output.tool_arguments;
    }
    println!("{result}");
    Ok(())
}
fn main() -> std::process::ExitCode {
    match run() {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("replay refused: {error}");
            std::process::ExitCode::FAILURE
        }
    }
}
