#![forbid(unsafe_code)]

use omk_workbench_wire::{MAX_FRAME_BYTES, decode_frame};
use std::io::{self, Read, Write};

fn run() -> Result<(), ()> {
    if std::env::args_os().len() != 1 {
        return Err(());
    }
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

fn main() -> std::process::ExitCode {
    if run().is_ok() {
        std::process::ExitCode::SUCCESS
    } else {
        eprintln!("workbench: invalid_observation");
        std::process::ExitCode::FAILURE
    }
}
