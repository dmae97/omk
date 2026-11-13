use std::{sync::OnceLock, time::Duration};

/// Build-only transport probe. No credentials, request dispatch or live provider wiring.
/// Defaults here are deliberately offline-test policy, not claimed Node transport parity.
pub fn build_client() -> Result<reqwest::Client, String> {
    static CRYPTO: OnceLock<Result<(), &'static str>> = OnceLock::new();
    CRYPTO
        .get_or_init(|| {
            rustls::crypto::ring::default_provider()
                .install_default()
                .map_err(
                    |_| "a process TLS provider already exists; refusing implicit crypto selection",
                )
        })
        .as_ref()
        .map_err(|e| (*e).to_owned())?;
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .no_proxy()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    #[test]
    fn explicit_crypto_and_native_roots_construct_without_dispatch() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let _guard = runtime.enter();
        assert!(super::build_client().is_ok());
        assert!(super::build_client().is_ok());
    }
}
