use serde_json::{Value, json};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

fn snapshot(revision: u64) -> Vec<u8> {
    let value = json!({
        "schemaVersion": "omk.run-graph.v1", "runtime": "node", "graphKind": "verified-run",
        "executionRequested": false, "capabilities": {"execute": false, "amendGraph": false},
        "runId": "stream-test",
        "cursor": {"revision": revision, "generation": 1,
            "authorityRevision": 0, "authorityDigest": "0".repeat(64),
            "journalDigest": format!("{revision:064x}"), "contractDigest": "b".repeat(64),
            "candidateDigest": null, "receiptDigest": null, "environmentDigest": null},
        "state": {"execution": "ready", "settlement": "open", "verification": "not_requested",
            "application": "not_requested", "publication": "none"},
        "proofVerdict": "inconclusive", "nodes": [], "edges": []
    });
    [serde_json::to_vec(&value).unwrap(), vec![b'\n']].concat()
}

struct Process(Child);
impl Drop for Process {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
fn launch(args: &[&str]) -> Process {
    Process(
        Command::new(env!("CARGO_BIN_EXE_omk-workbench-wire"))
            .args(args)
            .env_clear()
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap(),
    )
}

#[test]
fn streams_and_flushes_each_installed_observation_before_input_eof() {
    let mut child = launch(&["--stream"]);
    let stdout = child.0.stdout.take().unwrap();
    let (tx, rx) = mpsc::sync_channel(1);
    let reader = thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            if tx.send(line).is_err() {
                break;
            }
        }
    });
    for revision in [1, 3] {
        let input = snapshot(revision);
        let write = child.0.stdin.as_mut().unwrap().write_all(&input);
        let received = rx.recv_timeout(Duration::from_secs(5));
        assert!(
            received.is_ok(),
            "snapshot must arrive before EOF: {received:?}; write={write:?}"
        );
        let expected: Value = serde_json::from_slice(&input).unwrap();
        let actual: Value = serde_json::from_str(&received.unwrap().unwrap()).unwrap();
        assert_eq!(actual, expected);
    }
    child.0.stdin.take();
    assert!(child.0.wait().unwrap().success());
    reader.join().unwrap();
}

#[test]
fn suppresses_only_duplicate_and_componentwise_stale_snapshots() {
    let mut child = launch(&["--stream"]);
    let mut input = snapshot(1);
    input.extend(snapshot(4));
    input.extend(snapshot(4));
    input.extend(snapshot(1));
    let write = child.0.stdin.take().unwrap().write_all(&input);
    let mut output = String::new();
    std::io::Read::read_to_string(&mut child.0.stdout.take().unwrap(), &mut output).unwrap();
    assert!(
        child.0.wait().unwrap().success(),
        "stream rejected: {write:?}"
    );
    let rows: Vec<Value> = output
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0]["cursor"]["revision"], 1);
    assert_eq!(rows[1]["cursor"]["revision"], 4);
}

#[test]
fn original_one_shot_mode_still_rejects_multiple_frames() {
    let mut child = launch(&[]);
    let input = [snapshot(1), snapshot(2)].concat();
    let _ = child.0.stdin.take().unwrap().write_all(&input);
    assert!(!child.0.wait().unwrap().success());
}
