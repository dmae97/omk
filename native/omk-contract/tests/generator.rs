use std::process::Command;

#[test]
fn generator_catalog_matches_the_current_sources_and_rejects_arguments() {
    let binary = env!("CARGO_BIN_EXE_omk-contract-gen");
    let output = Command::new(binary).output().unwrap();
    assert!(output.status.success());
    let catalog: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(catalog["schema"], "omk.contract.sources.v1");
    assert_eq!(catalog["hostWireVersion"], omk_contract::HOST_WIRE_VERSION);
    assert_eq!(
        catalog["files"]["session.rs"],
        include_str!("../src/session.rs")
    );
    assert_eq!(
        catalog["files"]["host_wire.rs"],
        include_str!("../src/host_wire.rs")
    );
    assert_eq!(catalog["files"]["rpc.rs"], include_str!("../src/rpc.rs"));
    assert!(
        !Command::new(binary)
            .arg("--write")
            .output()
            .unwrap()
            .status
            .success()
    );
}
