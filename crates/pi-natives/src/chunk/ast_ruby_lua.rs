//! Language-specific chunk classifiers for Ruby and Lua.
//!
//! Both languages are well-served by the default classification logic:
//! - Ruby: `module`, `class`, `method`/`singleton_method` all match default
//!   patterns
//! - Lua: `function_declaration` matches the default function pattern

use super::classify::LangClassifier;

pub struct RubyLuaClassifier;

impl LangClassifier for RubyLuaClassifier {}
