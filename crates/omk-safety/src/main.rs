use std::env;
use std::process;

use omk_safety::{
    SafetyError, resolve_run_artifact_path, run_self_test, sanitize_run_id, validate_artifact_path,
    validate_run_artifact, validate_run_id,
};

fn json_escape(value: &str) -> String {
    value
        .chars()
        .flat_map(|c| match c {
            '\\' => "\\\\".chars().collect::<Vec<_>>(),
            '"' => "\\\"".chars().collect::<Vec<_>>(),
            '\n' => "\\n".chars().collect::<Vec<_>>(),
            '\r' => "\\r".chars().collect::<Vec<_>>(),
            '\t' => "\\t".chars().collect::<Vec<_>>(),
            _ => vec![c],
        })
        .collect()
}

fn print_ok_value(value: &str) {
    println!("{{\"ok\":true,\"value\":\"{}\"}}", json_escape(value));
}

fn print_error(err: &SafetyError) {
    println!(
        "{{\"ok\":false,\"error\":\"{}\"}}",
        json_escape(&err.message)
    );
}

fn print_run_artifact_ok(run_id: &str, artifact: &str) {
    println!(
        "{{\"ok\":true,\"runId\":\"{}\",\"artifact\":\"{}\"}}",
        json_escape(run_id),
        json_escape(artifact)
    );
}

fn print_resolved_ok(run_id: &str, artifact: &str, path: &str) {
    println!(
        "{{\"ok\":true,\"runId\":\"{}\",\"artifact\":\"{}\",\"path\":\"{}\"}}",
        json_escape(run_id),
        json_escape(artifact),
        json_escape(path)
    );
}

fn print_self_test_ok(checks: usize) {
    println!("{{\"ok\":true,\"checks\":{checks}}}");
}

fn usage() -> ! {
    eprintln!(
        "Usage: omk-safety <self-test|validate-run-id|sanitize-run-id|validate-artifact-path|validate-run-artifact|resolve-run-artifact> <args...>"
    );
    process::exit(2);
}

fn next_arg(args: &mut impl Iterator<Item = String>) -> String {
    args.next().unwrap_or_else(|| usage())
}

fn exit_err(err: SafetyError) -> ! {
    print_error(&err);
    process::exit(1);
}

fn main() {
    let mut args = env::args().skip(1);
    let Some(command) = args.next() else {
        usage();
    };

    match command.as_str() {
        "self-test" => match run_self_test() {
            Ok(checks) => print_self_test_ok(checks),
            Err(err) => exit_err(err),
        },
        "validate-run-id" => {
            let value = next_arg(&mut args);
            match validate_run_id(&value) {
                Ok(valid) => print_ok_value(valid),
                Err(err) => exit_err(err),
            }
        }
        "sanitize-run-id" => {
            let value = next_arg(&mut args);
            let fallback = args.next().unwrap_or_else(|| "run".to_string());
            print_ok_value(&sanitize_run_id(&value, &fallback));
        }
        "validate-artifact-path" => {
            let value = next_arg(&mut args);
            match validate_artifact_path(&value) {
                Ok(valid) => print_ok_value(&valid),
                Err(err) => exit_err(err),
            }
        }
        "validate-run-artifact" => {
            let run_id = next_arg(&mut args);
            let artifact = next_arg(&mut args);
            match validate_run_artifact(&run_id, &artifact) {
                Ok((valid_run_id, valid_artifact)) => {
                    print_run_artifact_ok(valid_run_id, &valid_artifact)
                }
                Err(err) => exit_err(err),
            }
        }
        "resolve-run-artifact" => {
            let runs_dir = next_arg(&mut args);
            let run_id = next_arg(&mut args);
            let artifact = next_arg(&mut args);
            match resolve_run_artifact_path(&runs_dir, &run_id, &artifact) {
                Ok(path) => print_resolved_ok(&run_id, &artifact, &path.to_string_lossy()),
                Err(err) => exit_err(err),
            }
        }
        _ => usage(),
    }
}
