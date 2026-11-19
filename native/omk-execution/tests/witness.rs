use omk_execution_host::witness::{Terminated, record, validate_dir};
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;

const BOOT: &str = "0123abcd-0000-4000-8000-00000000beef";
const REQUEST: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

fn receipt() -> Terminated<'static> {
    Terminated {
        pid: 4242,
        start_ticks: "987654",
        namespace: "pid:[4026532000]",
        boot_id: BOOT,
    }
}

fn private_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("omk-witness-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir(&dir).expect("dir");
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).expect("mode");
    dir
}

#[test]
fn records_canonical_receipt_durably_and_idempotently() {
    let dir = private_dir("record");
    let text = dir.to_str().expect("utf8");
    record(text, REQUEST, &receipt()).expect("first");
    record(text, REQUEST, &receipt()).expect("repeat converges");
    let path = dir.join(format!("{BOOT}-4026532000-4242-987654.json"));
    assert_eq!(
        fs::read_to_string(&path).expect("receipt"),
        format!(
            "{{\"version\":1,\"kind\":\"terminated\",\"identity\":{{\"pid\":4242,\"startTicks\":\"987654\",\"namespace\":\"pid:[4026532000]\",\"bootId\":\"{BOOT}\"}}}}\n"
        )
    );
    assert_eq!(
        fs::metadata(&path).expect("meta").permissions().mode() & 0o777,
        0o600
    );
    assert_eq!(fs::read_dir(&dir).expect("list").count(), 1, "no temp left");
    fs::write(&path, b"tampered").expect("tamper");
    assert!(
        record(text, REQUEST, &receipt()).is_err(),
        "conflict is not overwritten"
    );
    fs::remove_dir_all(dir).expect("cleanup");
}

#[test]
fn execution_record_binds_boot_time_and_original_dispatch() {
    use omk_execution_host::record::{Record, path};
    use std::time::{SystemTime, UNIX_EPOCH};
    let dir = private_dir("record-binding");
    let text = dir.to_str().expect("utf8");
    let before = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let digest = "a".repeat(64);
    let deadline = omk_execution_host::phase_deadline::PhaseDeadline {
        boot_id: BOOT.into(),
        deadline_ms: 1000,
    };
    Record::create_bound(text, REQUEST, Some(&digest), Some(&deadline)).expect("record");
    let after = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_millis();
    let raw: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(path(text, REQUEST)).expect("read"))
            .expect("json");
    assert_eq!(raw["bindingDigest"], digest);
    assert_eq!(
        raw["phaseDeadline"],
        serde_json::json!({ "bootId": BOOT, "deadlineMs": 1000 })
    );
    assert_eq!(
        raw["hostBootId"],
        fs::read_to_string("/proc/sys/kernel/random/boot_id")
            .expect("boot")
            .trim()
    );
    let started = raw["startedAtMs"].as_u64().expect("time") as u128;
    assert!(before <= started && started <= after);
    assert!(Record::create(text, "../escape").is_err());
    fs::remove_dir_all(dir).expect("cleanup");
}

#[test]
fn refuses_shared_relative_or_symlinked_directories() {
    let dir = private_dir("shape");
    let text = dir.to_str().expect("utf8").to_owned();
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o770)).expect("mode");
    assert!(validate_dir(&text).is_err());
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).expect("mode");
    assert!(validate_dir(&text).is_ok());
    assert!(validate_dir("relative/dir").is_err());
    let link = dir.with_extension("link");
    let _ = fs::remove_file(&link);
    std::os::unix::fs::symlink(&dir, &link).expect("link");
    assert!(validate_dir(link.to_str().expect("utf8")).is_err());
    fs::remove_file(link).expect("cleanup link");
    fs::remove_dir_all(dir).expect("cleanup");
}

#[test]
fn rejects_identities_that_cannot_name_a_single_receipt() {
    let dir = private_dir("invalid");
    let text = dir.to_str().expect("utf8");
    let bad = [
        Terminated {
            pid: 0,
            ..receipt()
        },
        Terminated {
            start_ticks: "",
            ..receipt()
        },
        Terminated {
            start_ticks: "12a",
            ..receipt()
        },
        Terminated {
            namespace: "net:[1]",
            ..receipt()
        },
        Terminated {
            namespace: "pid:[../x]",
            ..receipt()
        },
        Terminated {
            boot_id: "../../../../etc/passwd-aaaaaaaaaaaaaa",
            ..receipt()
        },
        Terminated {
            boot_id: "0123ABCD-0000-4000-8000-00000000BEEF",
            ..receipt()
        },
    ];
    for receipt in &bad {
        assert!(receipt.file_name().is_none());
        assert!(record(text, REQUEST, receipt).is_err());
    }
    assert_eq!(fs::read_dir(&dir).expect("list").count(), 0);
    fs::remove_dir_all(dir).expect("cleanup");
}

#[test]
fn execution_record_refuses_a_second_start_for_one_request() {
    use omk_execution_host::record::{Record, path};
    let dir = private_dir("record-dup");
    let text = dir.to_str().expect("utf8");
    let mut first = Record::create(text, REQUEST).expect("first");
    first.ready(&receipt()).expect("ready");
    first.committed().expect("committed");
    first.detached().expect("detached");
    first
        .finished(Some(0), None, 7, Some((b"ok\xff", b"")))
        .expect("finished");
    assert!(matches!(Record::create(text, REQUEST), Err("duplicate")));
    let lines: Vec<String> = fs::read_to_string(path(text, REQUEST))
        .expect("record")
        .lines()
        .map(str::to_owned)
        .collect();
    assert_eq!(lines.len(), 5);
    let committed_size = fs::read_to_string(dir.join(format!("{REQUEST}.head")))
        .expect("head")
        .trim()
        .parse::<u64>()
        .expect("head size");
    assert_eq!(
        committed_size,
        fs::metadata(path(text, REQUEST)).expect("meta").len()
    );
    assert!(lines[0].starts_with(&format!(
        "{{\"kind\":\"accepted\",\"requestId\":\"{REQUEST}\",\"hostPid\":"
    )));
    assert_eq!(
        lines[1],
        format!(
            "{{\"kind\":\"ready\",\"identity\":{{\"pid\":4242,\"startTicks\":\"987654\",\"namespace\":\"pid:[4026532000]\",\"bootId\":\"{BOOT}\"}}}}"
        )
    );
    assert_eq!(lines[2], "{\"kind\":\"committed\"}");
    assert_eq!(lines[3], "{\"kind\":\"detached\"}");
    assert_eq!(
        lines[4],
        "{\"kind\":\"finished\",\"exitCode\":0,\"failure\":null,\"durationMs\":7,\"stdout\":\"6f6bff\",\"stderr\":\"\"}"
    );
    let mode = fs::metadata(path(text, REQUEST))
        .expect("meta")
        .permissions()
        .mode();
    assert_eq!(mode & 0o777, 0o600);
    fs::remove_dir_all(dir).expect("cleanup");
}
