//! Language-specific chunk classifiers for C# and Java.
//!
//! Both languages are well-served by the default classification rules:
//! class/interface/enum/record declarations, method/constructor declarations,
//! using/import directives, namespace/package declarations, and property/event
//! declarations all fall through to defaults.

use super::classify::LangClassifier;

pub struct CSharpJavaClassifier;

impl LangClassifier for CSharpJavaClassifier {}
