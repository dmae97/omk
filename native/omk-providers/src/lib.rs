//! Offline first-provider parity unit. Not a live provider or a selected Rust core.

#[cfg(not(any(
    all(
        target_os = "linux",
        target_env = "gnu",
        any(target_arch = "x86_64", target_arch = "aarch64")
    ),
    all(
        target_os = "macos",
        any(target_arch = "x86_64", target_arch = "aarch64")
    ),
    all(
        target_os = "windows",
        target_env = "msvc",
        any(target_arch = "x86_64", target_arch = "aarch64")
    )
)))]
compile_error!("K1 B1 approval covers only GNU Linux, macOS and Windows MSVC x64/ARM64");

pub mod anthropic;
pub mod json_parse;
mod partial_json;
mod reducer;
mod request;
mod sse;
pub mod transport;
