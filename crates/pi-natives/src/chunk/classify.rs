//! Per-language chunk classification trait.
//!
//! Each language module implements [`LangClassifier`] to provide
//! language-specific node classification. The trait methods return `Option`
//! — returning `None` falls through to the shared default classification in
//! [`super::defaults`].

use tree_sitter::Node;

use super::common::RawChunkCandidate;
use crate::chunk::types::ChunkNode;

/// Language-specific chunk classification.
///
/// All methods have default no-op implementations so languages only need to
/// override the ones they specialize.
pub trait LangClassifier {
	/// Classify a root-level node. Return `None` to use shared defaults.
	fn classify_root<'t>(&self, _node: Node<'t>, _source: &str) -> Option<RawChunkCandidate<'t>> {
		None
	}

	/// Classify a node inside a class/struct/interface body.
	fn classify_class<'t>(&self, _node: Node<'t>, _source: &str) -> Option<RawChunkCandidate<'t>> {
		None
	}

	/// Classify a node inside a function body.
	fn classify_function<'t>(
		&self,
		_node: Node<'t>,
		_source: &str,
	) -> Option<RawChunkCandidate<'t>> {
		None
	}

	/// Allow a language to keep container children expanded even when the shared
	/// collapse heuristic would flatten them into a leaf preview.
	fn preserve_children(
		&self,
		_parent: &RawChunkCandidate<'_>,
		_children: &[RawChunkCandidate<'_>],
	) -> bool {
		false
	}

	/// Post-process the chunk tree after initial construction.
	/// Used for structural transformations like Go receiver reparenting.
	fn post_process(
		&self,
		_chunks: &mut Vec<ChunkNode>,
		_root_children: &mut Vec<String>,
		_source: &str,
	) {
	}

	/// Additional node kinds treated as root wrappers to flatten.
	fn is_root_wrapper(&self, _kind: &str) -> bool {
		false
	}

	/// Shared root-wrapper kinds that this language wants to preserve as real
	/// chunks.
	fn preserve_root_wrapper(&self, _kind: &str) -> bool {
		false
	}

	/// Allow a language to opt specific trivia nodes back into structural
	/// classification. Used when a grammar wraps real structure in comments.
	fn preserve_trivia(&self, _kind: &str) -> bool {
		false
	}

	/// Additional node kinds treated as trivia (absorbed into adjacent chunks).
	fn is_trivia(&self, _kind: &str) -> bool {
		false
	}

	/// Additional node kinds treated as absorbable attributes (like Rust
	/// `#[derive(...)]`).
	fn is_absorbable_attr(&self, _kind: &str) -> bool {
		false
	}
}

/// Resolve a [`LangClassifier`] for the given language.
pub fn classifier_for(lang: &str) -> &'static dyn LangClassifier {
	match lang {
		// JS / TS family
		"javascript" | "js" | "jsx" | "typescript" | "ts" | "tsx" => {
			&super::ast_js_ts::JsTsClassifier
		},
		// Python / Starlark
		"python" | "starlark" => &super::ast_python::PythonClassifier,
		// Rust
		"rust" => &super::ast_rust::RustClassifier,
		// Go
		"go" | "golang" => &super::ast_go::GoClassifier,
		// C / C++ / Objective-C
		"c" | "cpp" | "c++" | "objc" | "objective-c" => &super::ast_c_cpp_objc::CCppClassifier,
		// C# / Java
		"csharp" | "java" => &super::ast_csharp_java::CSharpJavaClassifier,
		// Clojure
		"clojure" => &super::ast_clojure::ClojureClassifier,
		// Elixir
		"elixir" => &super::ast_elixir::ElixirClassifier,
		// Ruby / Lua
		"ruby" | "lua" => &super::ast_ruby_lua::RubyLuaClassifier,
		// Haskell / Scala
		"haskell" | "scala" => &super::ast_haskell_scala::HaskellScalaClassifier,
		// CSS
		"css" => &super::ast_css::CssClassifier,
		// HTML / XML
		"html" | "xml" => &super::ast_html_xml::HtmlXmlClassifier,
		// Data formats
		"json" | "toml" | "yaml" => &super::ast_data_formats::DataFormatsClassifier,
		// Nix / HCL
		"nix" | "hcl" => &super::ast_nix_hcl::NixHclClassifier,
		// Markdown / Handlebars
		"markdown" | "handlebars" => &super::ast_markup::MarkupClassifier,
		// TLA+ / PlusCal
		"tlaplus" | "pluscal" | "pcal" | "tla" | "tla+" => &super::ast_tlaplus::TlaplusClassifier,
		// Bash / Make / Diff
		"bash" | "make" | "diff" => &super::ast_bash_make_diff::ShellBuildClassifier,
		// Everything else (Kotlin, Swift, PHP, Solidity, etc.)
		_ => &super::ast_misc::MiscClassifier,
	}
}
