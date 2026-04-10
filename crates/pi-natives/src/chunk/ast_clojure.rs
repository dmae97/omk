//! Language-specific chunk classifier for Clojure.

use tree_sitter::Node;

use super::{
	classify::{ClassifierTables, LangClassifier},
	common::*,
	kind::ChunkKind,
};

pub struct ClojureClassifier;

/// Extract the head symbol of a Clojure list form (first
/// `sym_lit`/`kwd_lit`/`symbol`/`word`).
fn form_head(node: Node<'_>, source: &str) -> Option<String> {
	named_children(node).into_iter().find_map(|child| {
		matches!(child.kind(), "sym_lit" | "kwd_lit" | "symbol" | "word")
			.then(|| node_text(source, child.start_byte(), child.end_byte()).to_string())
	})
}

/// Extract the name from a Clojure form: the second named child after the head
/// symbol (e.g. `greet` in `(defn greet [x] x)`).
fn form_name(node: Node<'_>, source: &str) -> Option<String> {
	let mut children = named_children(node).into_iter();
	let _head = children.next()?;
	children.find_map(|child| {
		sanitize_identifier(node_text(source, child.start_byte(), child.end_byte()))
	})
}

/// Classify a `list_lit` Clojure form based on its head symbol.
fn classify_form<'t>(node: Node<'t>, source: &str, at_root: bool) -> RawChunkCandidate<'t> {
	let Some(head) = form_head(node, source) else {
		return positional_candidate(node, ChunkKind::Form, source);
	};
	match head.as_str() {
		"ns" | "require" | "use" | "import" | "refer-clojure" => {
			group_candidate(node, ChunkKind::Imports, source)
		},
		"defn" | "defn-" | "defmacro" | "defmulti" | "defmethod" => {
			make_kind_chunk(node, ChunkKind::Function, form_name(node, source), source, None)
		},
		"def" | "defonce" => {
			make_kind_chunk(node, ChunkKind::Decl, form_name(node, source), source, None)
		},
		"defprotocol" => {
			make_container_chunk(node, ChunkKind::Proto, form_name(node, source), source, None)
		},
		"deftype" | "defrecord" | "extend-type" | "extend-protocol" => {
			make_container_chunk(node, ChunkKind::Type, form_name(node, source), source, None)
		},
		_ if at_root => positional_candidate(node, ChunkKind::Form, source),
		_ => group_candidate(node, ChunkKind::Block, source),
	}
}

impl LangClassifier for ClojureClassifier {
	fn tables(&self) -> &'static ClassifierTables {
		static TABLES: ClassifierTables = ClassifierTables {
			root:                 &[],
			class:                &[],
			function:             &[],
			structural_overrides: super::classify::StructuralOverrides::EMPTY,
		};
		&TABLES
	}

	fn classify_override<'t>(
		&self,
		context: ChunkContext,
		node: Node<'t>,
		source: &str,
	) -> Option<RawChunkCandidate<'t>> {
		(node.kind() == "list_lit")
			.then(|| classify_form(node, source, matches!(context, ChunkContext::Root)))
	}
}
