#[test]
fn a_preexisting_process_crypto_provider_is_not_silently_replaced() {
    // This integration-test executable has a separate process-global Rustls state.
    rustls::crypto::ring::default_provider()
        .install_default()
        .unwrap();
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let _guard = runtime.enter();
    let error = omk_providers::transport::build_client().expect_err("must reject competing owner");
    assert!(error.contains("already exists"));
}
