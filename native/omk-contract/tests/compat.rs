//! Pi compatibility tables for spec 120 stage K0 (T003).
//!
//! These tests pin the exact values of
//! `packages/coding-agent/src/core/pi-compat.ts` at the K0 baseline.
//! The TypeScript copy is generated from this crate in T004.

use omk_contract::compat::{
    LEGACY_PI_IMPORT_HINT, LEGACY_PI_RUNTIME_ALIASES, PackageManifestDialect,
    PiCompatibilityTarget, is_legacy_pi_runtime_import, is_supported_legacy_pi_runtime_import,
    legacy_pi_import_hint,
};

/// The 14 specifiers of `LEGACY_PI_RUNTIME_ALIASES`, in the TypeScript
/// `Object.fromEntries` order: `@earendil-works` first, then `@mariozechner`.
const EXPECTED_ALIASES: [(&str, &str); 14] = [
    ("@earendil-works/pi-coding-agent", "coding-agent"),
    ("@earendil-works/pi-agent-core", "agent-core"),
    ("@earendil-works/pi-agent-core/node", "agent-core-node"),
    ("@earendil-works/pi-ai", "ai"),
    ("@earendil-works/pi-ai/compat", "ai"),
    ("@earendil-works/pi-ai/oauth", "ai-oauth"),
    ("@earendil-works/pi-tui", "tui"),
    ("@mariozechner/pi-coding-agent", "coding-agent"),
    ("@mariozechner/pi-agent-core", "agent-core"),
    ("@mariozechner/pi-agent-core/node", "agent-core-node"),
    ("@mariozechner/pi-ai", "ai"),
    ("@mariozechner/pi-ai/compat", "ai"),
    ("@mariozechner/pi-ai/oauth", "ai-oauth"),
    ("@mariozechner/pi-tui", "tui"),
];

#[test]
fn alias_table_matches_typescript_exactly() {
    assert_eq!(LEGACY_PI_RUNTIME_ALIASES.len(), 14);
    for (index, (specifier, target)) in EXPECTED_ALIASES.iter().enumerate() {
        let (actual_specifier, actual_target) = LEGACY_PI_RUNTIME_ALIASES[index];
        assert_eq!(actual_specifier, *specifier, "specifier at index {index}");
        assert_eq!(actual_target.as_str(), *target, "target of {specifier}");
    }
}

#[test]
fn dialect_values_match_typescript() {
    assert_eq!(PackageManifestDialect::Omk.as_str(), "omk");
    assert_eq!(PackageManifestDialect::OmkPlusPi.as_str(), "omk+pi");
    assert_eq!(
        PackageManifestDialect::default_dialect(),
        PackageManifestDialect::Omk
    );
}

#[test]
fn supported_imports_are_exact_table_keys() {
    for (specifier, _) in EXPECTED_ALIASES {
        assert!(
            is_supported_legacy_pi_runtime_import(specifier),
            "{specifier} must be supported"
        );
    }
    // The classifier knows three namespaces, but the alias table has two.
    assert!(!is_supported_legacy_pi_runtime_import("@oh-my-pi/pi-ai"));
    // Only the listed subpaths are supported.
    assert!(!is_supported_legacy_pi_runtime_import(
        "@mariozechner/pi-tui/foo"
    ));
    assert!(!is_supported_legacy_pi_runtime_import(
        "@mariozechner/pi-utils"
    ));
    assert!(!is_supported_legacy_pi_runtime_import("@mariozechner/pi-a"));
}

#[test]
fn classifier_matches_all_three_namespaces_and_six_packages() {
    for namespace in ["mariozechner", "earendil-works", "oh-my-pi"] {
        for package in [
            "agent-core",
            "ai",
            "coding-agent",
            "natives",
            "tui",
            "utils",
        ] {
            let specifier = format!("@{namespace}/pi-{package}");
            assert!(
                is_legacy_pi_runtime_import(&specifier),
                "{specifier} must match"
            );
            assert!(
                is_legacy_pi_runtime_import(&format!("{specifier}/subpath")),
                "{specifier}/subpath must match"
            );
        }
    }
}

#[test]
fn classifier_requires_start_anchor_and_package_boundary() {
    // Anchored at the start of the specifier.
    assert!(!is_legacy_pi_runtime_import("x/@mariozechner/pi-ai"));
    assert!(!is_legacy_pi_runtime_import("@other/pi-ai"));
    assert!(!is_legacy_pi_runtime_import("pi-ai"));
    // The package name must end with a slash or at the end of the specifier.
    assert!(!is_legacy_pi_runtime_import("@mariozechner/pi-aifoo"));
    assert!(!is_legacy_pi_runtime_import(
        "@mariozechner/pi-agent-corefoo"
    ));
    assert!(!is_legacy_pi_runtime_import("@mariozechner/pi-foo"));
    assert!(!is_legacy_pi_runtime_import("@mariozechner/pi"));
    assert!(!is_legacy_pi_runtime_import(""));
}

#[test]
fn hint_is_empty_without_omk_dialect_or_mention() {
    let message = "Cannot find package '@earendil-works/pi-tui' imported from x.ts";
    assert_eq!(
        legacy_pi_import_hint(message, PackageManifestDialect::OmkPlusPi),
        ""
    );
    assert_eq!(
        legacy_pi_import_hint("Cannot find package 'lodash'", PackageManifestDialect::Omk),
        ""
    );
}

#[test]
fn hint_matches_typescript_text_exactly() {
    let message = "Cannot find package '@earendil-works/pi-tui' imported from x.ts";
    assert_eq!(
        legacy_pi_import_hint(message, PackageManifestDialect::Omk),
        LEGACY_PI_IMPORT_HINT
    );
    assert_eq!(
        LEGACY_PI_IMPORT_HINT,
        " (legacy Pi import: OMK 2.0 loads extensions with the native omk dialect by default. Migrate the import to an omk package, or opt into compatibility with --package-manifest-dialect omk+pi. Diagnose with: omk package doctor <source> --package-manifest-dialect omk)"
    );
}

#[test]
fn mention_uses_word_boundary_not_slash_boundary() {
    // A hyphen after the package name is a word boundary, so it is a mention
    // even though the anchored classifier would not match it.
    let hyphenated = "failed on @mariozechner/pi-ai-extra";
    assert!(!is_legacy_pi_runtime_import("@mariozechner/pi-ai-extra"));
    assert_eq!(
        legacy_pi_import_hint(hyphenated, PackageManifestDialect::Omk),
        LEGACY_PI_IMPORT_HINT
    );
    // A word character after the package name is not a boundary.
    let glued = "failed on @mariozechner/pi-ai2";
    assert_eq!(
        legacy_pi_import_hint(glued, PackageManifestDialect::Omk),
        ""
    );
}

#[test]
fn targets_expose_typescript_names() {
    assert_eq!(PiCompatibilityTarget::CodingAgent.as_str(), "coding-agent");
    assert_eq!(PiCompatibilityTarget::AgentCore.as_str(), "agent-core");
    assert_eq!(
        PiCompatibilityTarget::AgentCoreNode.as_str(),
        "agent-core-node"
    );
    assert_eq!(PiCompatibilityTarget::Ai.as_str(), "ai");
    assert_eq!(PiCompatibilityTarget::AiOauth.as_str(), "ai-oauth");
    assert_eq!(PiCompatibilityTarget::Tui.as_str(), "tui");
}
