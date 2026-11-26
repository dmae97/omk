//! Bounded provider parity and explicit Anthropic dispatch; not a selected Rust core.

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
mod anthropic_stream;
pub mod auth;
pub mod catalog;
mod catalog_overlay;
mod config_value;
pub mod dispatch;
pub mod json_parse;
pub mod openai_completions;
pub mod openai_responses;
mod partial_json;
mod reducer;
mod request;
mod request_blocks;
pub mod request_cache;
mod request_content;
mod request_history;
mod request_images;
pub mod request_policy;
mod sse;
mod tool_schema;
pub mod transport;
mod transport_send;
