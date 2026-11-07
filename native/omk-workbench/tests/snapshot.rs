use omk_workbench_wire::{GraphError, GraphView, Update, decode_frame};
use serde_json::{Value, json};

fn snapshot() -> Value {
    json!({
        "schemaVersion": "omk.run-graph.v1", "runtime": "node", "graphKind": "verified-run",
        "executionRequested": false, "capabilities": {"execute": false, "amendGraph": false},
        "runId": "sample",
        "cursor": {"revision": 1, "generation": 1,
            "authorityRevision": 0, "authorityDigest": "0".repeat(64),
            "journalDigest": "a".repeat(64), "contractDigest": "b".repeat(64),
            "candidateDigest": null, "receiptDigest": null, "environmentDigest": null},
        "state": {"execution": "ready", "settlement": "open", "verification": "not_requested",
            "application": "not_requested", "publication": "none"},
        "proofVerdict": "inconclusive",
        "nodes": [
            {"id": "left", "dependsOn": [], "status": "pending", "attempt": 0, "generation": 1, "ready": true},
            {"id": "right", "dependsOn": ["left"], "status": "pending", "attempt": 0, "generation": 1, "ready": false}
        ],
        "edges": [{"source": "left", "target": "right", "kind": "dependency"}]
    })
}

fn frame(value: &Value) -> Vec<u8> {
    let mut bytes = serde_json::to_vec(value).unwrap();
    bytes.push(b'\n');
    bytes
}

#[test]
fn accepts_and_roundtrips_the_observation_without_promoting_authority() {
    let value = snapshot();
    let decoded = decode_frame(&frame(&value)).unwrap();
    assert_eq!(serde_json::to_value(decoded).unwrap(), value);
}

#[test]
fn refuses_authority_unknown_fields_versions_and_unknown_states() {
    for (path, value) in [
        ("/schemaVersion", json!("omk.native-agent.v1")),
        ("/runtime", json!("rust")),
        ("/executionRequested", json!(true)),
        ("/capabilities/execute", json!(true)),
        ("/capabilities/amendGraph", json!(true)),
        ("/state/settlement", json!("cancelled")),
        ("/state/verification", json!("passed")),
        ("/proofVerdict", json!("correct")),
        ("/cursor/revision", json!(0)),
        ("/cursor/revision", json!(9007199254740992_u64)),
        ("/cursor/authorityRevision", json!(9007199254740992_u64)),
        ("/cursor/authorityRevision", json!(-1)),
        ("/cursor/authorityDigest", json!("a".repeat(64))),
        ("/cursor/generation", json!(1.5)),
        ("/cursor/contractDigest", json!("A".repeat(64))),
        ("/nodes/0/attempt", json!(3)),
        ("/nodes/0/generation", json!(2)),
        ("/nodes/0/id", json!("../untrusted")),
        ("/edges/0/kind", json!("message")),
    ] {
        let mut input = snapshot();
        *input.pointer_mut(path).unwrap() = value;
        assert!(decode_frame(&frame(&input)).is_err(), "accepted {path}");
    }
    let mut input = snapshot();
    input["approved"] = json!(true);
    assert!(decode_frame(&frame(&input)).is_err());
    input = snapshot();
    input["cursor"]
        .as_object_mut()
        .unwrap()
        .remove("receiptDigest");
    assert!(decode_frame(&frame(&input)).is_err());
}

#[test]
fn refuses_cycles_missing_dependencies_duplicates_and_mismatched_edges() {
    let mut input = snapshot();
    input["nodes"][0]["dependsOn"] = json!(["right"]);
    input["edges"]
        .as_array_mut()
        .unwrap()
        .push(json!({"source":"right","target":"left","kind":"dependency"}));
    assert!(decode_frame(&frame(&input)).is_err());
    for field in ["nodes", "edges"] {
        input = snapshot();
        let copy = input[field][0].clone();
        input[field].as_array_mut().unwrap().push(copy);
        assert!(decode_frame(&frame(&input)).is_err());
    }
    input = snapshot();
    input["nodes"][1]["dependsOn"] = json!(["absent"]);
    assert!(decode_frame(&frame(&input)).is_err());
    input = snapshot();
    input["edges"] = json!([]);
    assert!(decode_frame(&frame(&input)).is_err());
    input = snapshot();
    input["nodes"] = json!([]);
    input["edges"] = json!([]);
    assert!(decode_frame(&frame(&input)).is_ok());
}

#[test]
fn refuses_array_shaped_objects_duplicate_keys_and_invalid_frames() {
    for path in ["/cursor", "/state", "/capabilities", "/nodes/0", "/edges/0"] {
        let mut input = snapshot();
        let values: Vec<_> = input
            .pointer(path)
            .unwrap()
            .as_object()
            .unwrap()
            .values()
            .cloned()
            .collect();
        *input.pointer_mut(path).unwrap() = json!(values);
        assert!(decode_frame(&frame(&input)).is_err(), "accepted {path}");
    }
    let valid = frame(&snapshot());
    for bytes in [
        vec![],
        valid[..valid.len() - 1].to_vec(),
        [valid.clone(), valid.clone()].concat(),
        vec![b'x'; 262146],
    ] {
        assert!(decode_frame(&bytes).is_err());
    }
    let text = String::from_utf8(valid).unwrap();
    for input in [
        text.replace("\"runId\":", "\"runId\":\"duplicate\",\"runId\":"),
        text.replace("\"runId\":", "\"run\\u0049d\":\"duplicate\",\"runId\":"),
        text.replace('\n', "\r\n"),
        format!("\u{feff}{text}"),
    ] {
        assert!(decode_frame(input.as_bytes()).is_err());
    }
}

#[test]
fn retains_one_full_snapshot_and_rejects_binding_conflicts_and_generation_regression() {
    let mut view = GraphView::default();
    let first = frame(&snapshot());
    assert_eq!(view.apply(&first).unwrap(), Update::Installed);
    assert_eq!(view.apply(&first).unwrap(), Update::Duplicate);
    let mut next = snapshot();
    next["cursor"]["revision"] = json!(4);
    next["cursor"]["generation"] = json!(2);
    next["cursor"]["journalDigest"] = json!("c".repeat(64));
    next["nodes"][0]["ready"] = json!(false);
    assert_eq!(view.apply(&frame(&next)).unwrap(), Update::Installed);
    assert_eq!(view.apply(&first).unwrap(), Update::Stale);
    let retained = serde_json::to_value(view.current().unwrap()).unwrap();
    next["state"]["execution"] = json!("running");
    assert_eq!(view.apply(&frame(&next)).unwrap_err(), GraphError::Conflict);
    next["cursor"]["revision"] = json!(5);
    next["cursor"]["generation"] = json!(1);
    assert_eq!(
        view.apply(&frame(&next)).unwrap_err(),
        GraphError::Regression
    );
    next["runId"] = json!("other");
    assert_eq!(view.apply(&frame(&next)).unwrap_err(), GraphError::Binding);
    next["runId"] = json!("sample");
    next["cursor"]["contractDigest"] = json!("d".repeat(64));
    assert_eq!(view.apply(&frame(&next)).unwrap_err(), GraphError::Binding);
    assert_eq!(
        serde_json::to_value(view.current().unwrap()).unwrap(),
        retained
    );
}

#[test]
fn accepts_authority_only_changes_without_losing_conflict_or_stale_detection() {
    let mut value = snapshot();
    value["cursor"]["authorityRevision"] = json!(0);
    value["cursor"]["authorityDigest"] = json!("0".repeat(64));
    value["proofVerdict"] = json!("verified");
    let first = frame(&value);
    let mut view = GraphView::default();
    assert_eq!(view.apply(&first).unwrap(), Update::Installed);
    value["cursor"]["authorityRevision"] = json!(4);
    value["cursor"]["authorityDigest"] = json!("d".repeat(64));
    value["proofVerdict"] = json!("inconclusive");
    let reserved = frame(&value);
    assert_eq!(view.apply(&reserved).unwrap(), Update::Installed);
    value["cursor"]["authorityRevision"] = json!(5);
    value["cursor"]["authorityDigest"] = json!("e".repeat(64));
    value["proofVerdict"] = json!("verified");
    let cancelled = frame(&value);
    assert_eq!(view.apply(&cancelled).unwrap(), Update::Installed);
    assert_eq!(view.apply(&reserved).unwrap(), Update::Stale);
    assert_eq!(view.apply(&cancelled).unwrap(), Update::Duplicate);
    value["cursor"]["authorityDigest"] = json!("f".repeat(64));
    assert_eq!(
        view.apply(&frame(&value)).unwrap_err(),
        GraphError::Conflict
    );
    value["cursor"]["authorityDigest"] = json!("e".repeat(64));
    value["proofVerdict"] = json!("inconclusive");
    assert_eq!(
        view.apply(&frame(&value)).unwrap_err(),
        GraphError::Conflict
    );
    let retained = serde_json::to_value(view.current().unwrap()).unwrap();
    value["cursor"]["authorityRevision"] = json!(6);
    value["cursor"]["authorityDigest"] = json!("f".repeat(64));
    value["state"]["execution"] = json!("running");
    assert_eq!(
        view.apply(&frame(&value)).unwrap_err(),
        GraphError::Conflict
    );
    value["state"]["execution"] = json!("ready");
    value["cursor"]["revision"] = json!(2);
    value["cursor"]["authorityRevision"] = json!(4);
    value["cursor"]["journalDigest"] = json!("f".repeat(64));
    value["cursor"]["authorityDigest"] = json!("d".repeat(64));
    assert_eq!(
        view.apply(&frame(&value)).unwrap_err(),
        GraphError::Regression
    );
    assert_eq!(
        serde_json::to_value(view.current().unwrap()).unwrap(),
        retained
    );
}
