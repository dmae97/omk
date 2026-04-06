//! Chunk classifiers for languages well-served by defaults:
//! Kotlin, Swift, PHP, Solidity, Julia, Odin, Verilog, Zig, Regex, Diff.

use super::classify::LangClassifier;

pub struct MiscClassifier;

impl LangClassifier for MiscClassifier {}
