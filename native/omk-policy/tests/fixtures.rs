use std::{
    fs,
    process::{Command, Output},
    sync::atomic::{AtomicUsize, Ordering},
};

static NEXT: AtomicUsize = AtomicUsize::new(0);
const HEADER: &str =
    "graph_id\tkind\tn\tmask\tbudget\tpredecessors\treduced\tstrategy\tclosure_bytes\n";
const ROW: &str = "0\texhaustive\t1\t0\t0\t-\t-\talready-reduced\t0\n";

struct Owned(std::path::PathBuf);
impl Owned {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "omk-policy-input-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).unwrap();
        let owned = Self(path);
        owned.dag(ROW);
        fs::write(
            owned.0.join("memory.tsv"),
            format!(
                "n\tbudget\tsum_bytes\tstrategy\tclosure_bytes\tpredecessors\treduced\n{}",
                "1\t0\t0\talready-reduced\t0\t-\t-\n".repeat(16)
            ),
        )
        .unwrap();
        owned
    }
    fn dag(&self, first: &str) {
        let mut text = format!("{HEADER}{first}");
        for id in 1..2214 {
            text.push_str(&format!(
                "{id}\texhaustive\t1\t0\t0\t-\t-\talready-reduced\t0\n"
            ));
        }
        fs::write(self.0.join("dag.tsv"), text).unwrap();
    }
    fn run(&self) -> Output {
        Command::new(env!("CARGO_BIN_EXE_policy-fixtures"))
            .arg(&self.0)
            .output()
            .unwrap()
    }
    fn accept(&self) {
        let result = self.run();
        assert!(result.status.success(), "{:?}", result.stderr);
        assert!(result.stderr.is_empty());
        let mut expected = "RUST_POLICY_V1\n".to_owned();
        for id in 0..2214 {
            expected.push_str(&format!("dag\t{id}\t0\t-\talready-reduced\t0\n"));
        }
        expected.push_str(&"memory\t1\t0\t-\talready-reduced\t0\n".repeat(16));
        assert_eq!(String::from_utf8(result.stdout).unwrap(), expected);
    }
    fn reject(&self) {
        let result = self.run();
        assert!(!result.status.success());
        assert_eq!(
            String::from_utf8(result.stderr).unwrap(),
            "policy fixture input or output rejected\n"
        );
    }
}
impl Drop for Owned {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

#[test]
fn fixture_program_accepts_complete_positive_control() {
    Owned::new().accept();
}

#[test]
fn fixture_program_rejects_bad_arguments_and_canonical_input_errors() {
    assert!(
        !Command::new(env!("CARGO_BIN_EXE_policy-fixtures"))
            .output()
            .unwrap()
            .status
            .success()
    );
    for input in [
        "0\texhaustive\t01\t0\t0\t-\t-\talready-reduced\t0\n",
        "0\texhaustive\t1\t0\t0\t-/\t-\talready-reduced\t0\n",
        "0\texhaustive\t1\t0\t0\t0\t-\talready-reduced\t0\n",
        "0\texhaustive\t1\t0\t16777217\t-\t-\talready-reduced\t0\n",
        "0\texhaustive\t1\t0\tNaN\t-\t-\talready-reduced\t0\n",
    ] {
        let owned = Owned::new();
        owned.accept();
        owned.dag(input);
        owned.reject();
    }
    for input in [
        "".to_owned(),
        HEADER.to_owned(),
        format!("wrong header\n{}", ROW.repeat(2214)),
    ] {
        let owned = Owned::new();
        owned.accept();
        fs::write(owned.0.join("dag.tsv"), input).unwrap();
        owned.reject();
    }
}

#[test]
fn fixture_program_bounds_input_file_reads() {
    let owned = Owned::new();
    owned.accept();
    // The unconsumed kind column pads an otherwise complete, well-formed bundle.
    owned.dag(&format!(
        "0\t{}\t1\t0\t0\t-\t-\talready-reduced\t0\n",
        "x".repeat(16 * 1024 * 1024)
    ));
    owned.reject();
}

#[cfg(unix)]
#[test]
fn fixture_program_rejects_symbolic_input_files() {
    let owned = Owned::new();
    owned.accept();
    fs::rename(owned.0.join("dag.tsv"), owned.0.join("other")).unwrap();
    std::os::unix::fs::symlink(owned.0.join("other"), owned.0.join("dag.tsv")).unwrap();
    owned.reject();
}
