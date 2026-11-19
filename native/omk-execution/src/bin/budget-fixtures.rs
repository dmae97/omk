#![forbid(unsafe_code)]
use omk_execution_host::budget::Budget;
use std::io::{self, BufRead};

fn run() -> Result<(), String> {
    for line in io::stdin().lock().lines().take(100_001) {
        let line = line.map_err(|_| "read")?;
        if line.len() > 4096 {
            return Err("line_limit".into());
        }
        let cells: Vec<_> = line.split('\t').collect();
        if cells.len() != 4 {
            return Err("shape".into());
        }
        let mut budget = Budget::new(
            cells[1].parse().map_err(|_| "timeout")?,
            cells[2].parse().map_err(|_| "limit")?,
        )
        .map_err(str::to_owned)?;
        let mut results = Vec::new();
        for pair in cells[3].split(';') {
            let (elapsed, bytes) = pair.split_once(',').ok_or("event")?;
            let stop = budget.observe(
                elapsed.parse().map_err(|_| "elapsed")?,
                bytes.parse().map_err(|_| "bytes")?,
            );
            results.push(format!(
                "{},{}",
                stop.map_or("continue", |s| s.code()),
                budget.retained()
            ));
        }
        println!("{}\t{}", cells[0], results.join(";"));
    }
    Ok(())
}
fn main() {
    if run().is_err() {
        eprintln!("invalid_fixture");
        std::process::exit(1);
    }
}
