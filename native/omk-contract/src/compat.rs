//! Pi compatibility tables (spec 120, §5a).
//!
//! This module is the single source of truth for the values that
//! `packages/coding-agent/src/core/pi-compat.ts` carries today. The TypeScript
//! copy is generated from this crate in T004, and a drift check fails on a hand
//! edit. The alias table is data; the host's resolver applies it as a generic
//! specifier map and names no Pi package itself.

use serde::{Deserialize, Serialize};

/// Dialect for managed-package manifests and legacy import handling.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PackageManifestDialect {
    /// Native manifests only. Legacy Pi specifiers get no implicit aliases.
    #[serde(rename = "omk")]
    Omk,
    /// Explicit opt-in compatibility with legacy Pi packages.
    #[serde(rename = "omk+pi")]
    OmkPlusPi,
}

impl PackageManifestDialect {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Omk => "omk",
            Self::OmkPlusPi => "omk+pi",
        }
    }

    /// Omission selects the native dialect since OMK 2.0.
    pub const fn default_dialect() -> Self {
        Self::Omk
    }
}

/// OMK package that a legacy Pi specifier maps onto.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PiCompatibilityTarget {
    CodingAgent,
    AgentCore,
    AgentCoreNode,
    Ai,
    AiOauth,
    Tui,
}

impl PiCompatibilityTarget {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::CodingAgent => "coding-agent",
            Self::AgentCore => "agent-core",
            Self::AgentCoreNode => "agent-core-node",
            Self::Ai => "ai",
            Self::AiOauth => "ai-oauth",
            Self::Tui => "tui",
        }
    }
}

/// The 14 legacy specifiers, in the TypeScript `Object.fromEntries` order.
pub const LEGACY_PI_RUNTIME_ALIASES: [(&str, PiCompatibilityTarget); 14] = [
    (
        "@earendil-works/pi-coding-agent",
        PiCompatibilityTarget::CodingAgent,
    ),
    (
        "@earendil-works/pi-agent-core",
        PiCompatibilityTarget::AgentCore,
    ),
    (
        "@earendil-works/pi-agent-core/node",
        PiCompatibilityTarget::AgentCoreNode,
    ),
    ("@earendil-works/pi-ai", PiCompatibilityTarget::Ai),
    ("@earendil-works/pi-ai/compat", PiCompatibilityTarget::Ai),
    (
        "@earendil-works/pi-ai/oauth",
        PiCompatibilityTarget::AiOauth,
    ),
    ("@earendil-works/pi-tui", PiCompatibilityTarget::Tui),
    (
        "@mariozechner/pi-coding-agent",
        PiCompatibilityTarget::CodingAgent,
    ),
    (
        "@mariozechner/pi-agent-core",
        PiCompatibilityTarget::AgentCore,
    ),
    (
        "@mariozechner/pi-agent-core/node",
        PiCompatibilityTarget::AgentCoreNode,
    ),
    ("@mariozechner/pi-ai", PiCompatibilityTarget::Ai),
    ("@mariozechner/pi-ai/compat", PiCompatibilityTarget::Ai),
    ("@mariozechner/pi-ai/oauth", PiCompatibilityTarget::AiOauth),
    ("@mariozechner/pi-tui", PiCompatibilityTarget::Tui),
];

/// Namespaces the legacy-import classifier recognizes. The alias table has two
/// of them; `@oh-my-pi` is classified but never aliased.
const CLASSIFIER_NAMESPACES: [&str; 3] = ["mariozechner", "earendil-works", "oh-my-pi"];

/// Package names after the `pi-` prefix, in the TypeScript alternation order.
const LEGACY_PACKAGES: [&str; 6] = [
    "agent-core",
    "ai",
    "coding-agent",
    "natives",
    "tui",
    "utils",
];

/// The migration hint appended to a native-mode load failure that names a
/// legacy Pi package. Matches the TypeScript string byte for byte.
pub const LEGACY_PI_IMPORT_HINT: &str = " (legacy Pi import: OMK 2.0 loads extensions with the native omk dialect by default. Migrate the import to an omk package, or opt into compatibility with --package-manifest-dialect omk+pi. Diagnose with: omk package doctor <source> --package-manifest-dialect omk)";

/// Returns the OMK target of a legacy specifier, or `None` when the specifier
/// is not one of the 14 table keys. Exact match, like the TypeScript
/// `Object.getOwnPropertyDescriptor` lookup.
pub fn alias_target(specifier: &str) -> Option<PiCompatibilityTarget> {
    LEGACY_PI_RUNTIME_ALIASES
        .iter()
        .find(|(key, _)| *key == specifier)
        .map(|(_, target)| *target)
}

pub fn is_supported_legacy_pi_runtime_import(specifier: &str) -> bool {
    alias_target(specifier).is_some()
}

/// Anchored match of `^@(namespace)/pi-(package)(?:/|$)`.
pub fn is_legacy_pi_runtime_import(specifier: &str) -> bool {
    let Some(len) = legacy_package_len_at(specifier, 0) else {
        return false;
    };
    specifier.len() == len || specifier.as_bytes()[len] == b'/'
}

/// Appends the migration hint when the native dialect is selected and the
/// message mentions a legacy Pi package anywhere. Returns an empty string
/// otherwise, exactly like the TypeScript function.
pub fn legacy_pi_import_hint(message: &str, dialect: PackageManifestDialect) -> &'static str {
    if dialect != PackageManifestDialect::Omk || !contains_legacy_pi_mention(message) {
        return "";
    }
    LEGACY_PI_IMPORT_HINT
}

/// Returns the byte length of the legacy package specifier starting at `start`
/// and ending at the package name, if one begins there.
fn legacy_package_len_at(text: &str, start: usize) -> Option<usize> {
    let rest = text.get(start..)?;
    let after_at = rest.strip_prefix('@')?;
    for namespace in CLASSIFIER_NAMESPACES {
        let Some(after_namespace) = after_at.strip_prefix(namespace) else {
            continue;
        };
        let Some(after_pi) = after_namespace.strip_prefix("/pi-") else {
            continue;
        };
        for package in LEGACY_PACKAGES {
            if after_pi.starts_with(package) {
                return Some(1 + namespace.len() + 4 + package.len());
            }
        }
    }
    None
}

/// Unanchored mention match with a JavaScript `\b` word boundary after the
/// package name: the next byte must be absent or a non-word byte.
fn contains_legacy_pi_mention(message: &str) -> bool {
    for (index, _) in message.match_indices('@') {
        let Some(len) = legacy_package_len_at(message, index) else {
            continue;
        };
        match message.as_bytes().get(index + len) {
            None => return true,
            Some(&byte) if !is_word_byte(byte) => return true,
            _ => {}
        }
    }
    false
}

fn is_word_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}
