//! Deterministic source catalog for the in-repository TypeScript emitter.
//! Cargo compiles the actual contracts before this catalog can be emitted.
#![forbid(unsafe_code)]
use omk_contract::compat::{
    CLASSIFIER_NAMESPACES, LEGACY_PACKAGES, LEGACY_PI_IMPORT_HINT, LEGACY_PI_RUNTIME_ALIASES,
    PackageManifestDialect, PiCompatibilityTarget,
};
use std::{collections::BTreeMap, error::Error, fs, path::Path};

fn main() -> Result<(), Box<dyn Error>> {
    if std::env::args_os().len() != 1 {
        return Err("usage: omk-contract-gen (source catalog on stdout)".into());
    }
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut files = BTreeMap::new();
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| "non-UTF-8 source name")?;
        if !name.ends_with(".rs") {
            continue;
        }
        if !entry.file_type()?.is_file() {
            return Err("non-regular Rust source refused".into());
        }
        files.insert(name, fs::read_to_string(entry.path())?);
    }
    let catalog = serde_json::json!({
        "schema": "omk.contract.sources.v1",
        "files": files,
        "generator": include_str!("omk-contract-gen.rs"),
        "hostWireVersion": omk_contract::HOST_WIRE_VERSION,
        "compat": {
            "dialects": PackageManifestDialect::ALL.map(PackageManifestDialect::as_str),
            "defaultDialect": PackageManifestDialect::default_dialect().as_str(),
            "targets": PiCompatibilityTarget::ALL.map(PiCompatibilityTarget::as_str),
            "aliases": LEGACY_PI_RUNTIME_ALIASES.map(|(specifier, target)| [specifier, target.as_str()]),
            "classifierNamespaces": CLASSIFIER_NAMESPACES,
            "legacyPackages": LEGACY_PACKAGES,
            "hint": LEGACY_PI_IMPORT_HINT,
        },
    });
    println!("{}", serde_json::to_string(&catalog)?);
    Ok(())
}
