//! Language-specific chunk classifiers for C, C++, and Objective-C.
//!
//! These languages are well-served by the default classification rules.
//! `translation_unit` and `compilation_unit` root wrappers are already
//! recognized by the shared `is_root_wrapper_kind` helper, so no
//! overrides are needed here.

use super::classify::LangClassifier;

pub struct CCppClassifier;

impl LangClassifier for CCppClassifier {}
