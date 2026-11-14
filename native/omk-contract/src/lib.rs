//! Contract types shared by the OMK Rust core and its TypeScript clients.
//!
//! Spec 120 stage K0. This crate is the single source of truth for session
//! JSONL, the public RPC wire, the extension-host wire and the `omk+pi`
//! compatibility tables. TypeScript wire declarations are generated from it
//! (T009); generating the Node compatibility tables is T004.
//!
//! Nothing in production calls this crate yet. See
//! `specs/120-rust-core/plan.md` for the unit order.

#![forbid(unsafe_code)]

pub mod compat;
pub mod host_wire;
mod jsonl;
pub mod rpc;
pub mod session;
pub mod session_jsonl;
pub mod session_message;

/// Contract schema version for the extension-host wire (spec 120, stage K0).
pub const HOST_WIRE_VERSION: u32 = 1;
