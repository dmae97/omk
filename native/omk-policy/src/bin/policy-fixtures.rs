use omk_policy_probe::{MAX_NODES, reduce};
use std::{
    fs::File,
    io::{self, Read, Write},
    path::Path,
};

const LIMIT: u64 = 16 * 1024 * 1024;

fn number(text: &str) -> Result<usize, &'static str> {
    let value = text.parse::<usize>().map_err(|_| "integer field")?;
    if value.to_string() != text {
        return Err("noncanonical integer");
    }
    Ok(value)
}

fn decode(text: &str, n: usize) -> Result<Vec<Vec<usize>>, &'static str> {
    if n > MAX_NODES {
        return Err("node limit");
    }
    if n == 0 {
        return if text == "~" {
            Ok(vec![])
        } else {
            Err("empty graph")
        };
    }
    let rows: Vec<_> = text.split('/').collect();
    if rows.len() != n {
        return Err("graph row count");
    }
    rows.into_iter()
        .map(|row| {
            if row == "-" {
                Ok(vec![])
            } else {
                row.split(',').map(number).collect()
            }
        })
        .collect()
}

fn encode(graph: &[Vec<usize>]) -> String {
    if graph.is_empty() {
        return "~".into();
    }
    graph
        .iter()
        .map(|row| {
            if row.is_empty() {
                "-".into()
            } else {
                row.iter()
                    .map(usize::to_string)
                    .collect::<Vec<_>>()
                    .join(",")
            }
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn run() -> Result<(), &'static str> {
    let args: Vec<_> = std::env::args_os().collect();
    if args.len() != 2 {
        return Err("bundle argument");
    }
    let mut output = io::BufWriter::new(io::stdout().lock());
    writeln!(output, "RUST_POLICY_V1").map_err(|_| "output")?;
    for (kind, header, width, count) in [
        (
            "dag",
            "graph_id\tkind\tn\tmask\tbudget\tpredecessors\treduced\tstrategy\tclosure_bytes",
            9,
            2214,
        ),
        (
            "memory",
            "n\tbudget\tsum_bytes\tstrategy\tclosure_bytes\tpredecessors\treduced",
            7,
            16,
        ),
    ] {
        let path = Path::new(&args[1]).join(format!("{kind}.tsv"));
        if !path
            .symlink_metadata()
            .map_err(|_| "input metadata")?
            .is_file()
        {
            return Err("regular file required");
        }
        let mut text = String::new();
        File::open(path)
            .map_err(|_| "input open")?
            .take(LIMIT + 1)
            .read_to_string(&mut text)
            .map_err(|_| "input read")?;
        if text.len() as u64 > LIMIT || !text.ends_with('\n') {
            return Err("input bound/terminator");
        }
        let mut rows = text.lines();
        if rows.next() != Some(header) {
            return Err("input header");
        }
        let mut seen = 0;
        for row in rows {
            seen += 1;
            if seen > count {
                return Err("case count");
            }
            let fields: Vec<_> = row.split('\t').collect();
            if fields.len() != width {
                return Err("column count");
            }
            // Only fixed inputs enter the policy. Expected reduction/strategy columns
            // are not used to generate Rust results.
            let (n, budget, input) = if kind == "dag" {
                (fields[2], fields[4], fields[5])
            } else {
                (fields[0], fields[1], fields[5])
            };
            let graph = decode(input, number(n)?)?;
            let budget = number(budget)?;
            let result = reduce(&graph, budget).map_err(|_| "policy domain")?;
            writeln!(
                output,
                "{kind}\t{}\t{budget}\t{}\t{}\t{}",
                number(fields[0])?,
                encode(&result.dependencies),
                result.strategy.as_str(),
                result.closure_bytes
            )
            .map_err(|_| "output")?;
        }
        if seen != count {
            return Err("case count");
        }
    }
    output.flush().map_err(|_| "output")
}

fn main() {
    if run().is_err() {
        eprintln!("policy fixture input or output rejected");
        std::process::exit(1);
    }
}
