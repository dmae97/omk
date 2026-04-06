//! Language-specific chunk classifier for Clojure.

use tree_sitter::Node;

use super::{classify::LangClassifier, common::*};

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

/// Build a prefixed name from a Clojure form, falling back to "anonymous".
fn form_prefixed_name(node: Node<'_>, prefix: &str, source: &str) -> String {
	let name = form_name(node, source).unwrap_or_else(|| "anonymous".to_string());
	format!("{prefix}_{name}")
}

/// Classify a `list_lit` Clojure form based on its head symbol.
fn classify_form<'t>(node: Node<'t>, source: &str, at_root: bool) -> RawChunkCandidate<'t> {
	let Some(head) = form_head(node, source) else {
		return positional_candidate(node, "form", source);
	};
	match head.as_str() {
		"ns" | "require" | "use" | "import" | "refer-clojure" => {
			group_candidate(node, "imports", source)
		},
		"defn" | "defn-" | "defmacro" | "defmulti" | "defmethod" => {
			make_named_chunk(node, form_prefixed_name(node, "fn", source), source, None)
		},
		"def" | "defonce" => {
			make_named_chunk(node, form_prefixed_name(node, "decl", source), source, None)
		},
		"defprotocol" => {
			make_container_chunk(node, form_prefixed_name(node, "proto", source), source, None)
		},
		"deftype" | "defrecord" | "extend-type" | "extend-protocol" => {
			make_container_chunk(node, form_prefixed_name(node, "type", source), source, None)
		},
		_ if at_root => positional_candidate(node, "form", source),
		_ => group_candidate(node, "block", source),
	}
}

impl LangClassifier for ClojureClassifier {
	fn classify_root<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		match node.kind() {
			"list_lit" => Some(classify_form(node, source, true)),
			_ => None,
		}
	}

	fn classify_class<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		match node.kind() {
			"list_lit" => Some(classify_form(node, source, false)),
			_ => None,
		}
	}

	fn classify_function<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		match node.kind() {
			"list_lit" => Some(classify_form(node, source, false)),
			_ => None,
		}
	}
}
