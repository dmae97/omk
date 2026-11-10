#![forbid(unsafe_code)]

use omk_workbench_wire::{MAX_FRAME_BYTES, consume_stream, decode_frame};
use std::io::{self, Read, Write};

fn run_once() -> Result<(), ()> {
    let mut bytes = Vec::new();
    io::stdin()
        .lock()
        .take((MAX_FRAME_BYTES + 2) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| ())?;
    let snapshot = decode_frame(&bytes).map_err(|_| ())?;
    let mut output = serde_json::to_vec(&snapshot).map_err(|_| ())?;
    output.push(b'\n');
    let mut stdout = io::stdout().lock();
    stdout
        .write_all(&output)
        .and_then(|()| stdout.flush())
        .map_err(|_| ())
}

fn run() -> Result<(), ()> {
    let mut args = std::env::args_os().skip(1);
    match args.next() {
        None => run_once(),
        Some(arg) if arg == "--stream" && args.next().is_none() => {
            consume_stream(&mut io::stdin().lock(), &mut io::stdout().lock())
                .map(|_| ())
                .map_err(|_| ())
        }
        _ => Err(()),
    }
}

fn main() -> std::process::ExitCode {
    if run().is_ok() {
        std::process::ExitCode::SUCCESS
    } else {
        eprintln!("workbench: invalid_observation");
        std::process::ExitCode::FAILURE
    }
}
