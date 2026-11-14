#![forbid(unsafe_code)]

use std::{io, io::Write, process::ExitCode};

fn main() -> ExitCode {
    match omk_native_wire::run(io::stdin().lock(), io::stdout().lock()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            let _ = writeln!(io::stderr().lock(), "{}", error.code());
            ExitCode::FAILURE
        }
    }
}
