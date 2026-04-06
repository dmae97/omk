//! Language-specific chunk classifier for Elixir.

use tree_sitter::Node;

use super::{classify::LangClassifier, common::*};

pub struct ElixirClassifier;

/// Extract the call target: `target` field, or first named child.
fn call_target(node: Node<'_>, source: &str) -> Option<String> {
	node
		.child_by_field_name("target")
		.or_else(|| named_children(node).into_iter().next())
		.map(|n| node_text(source, n.start_byte(), n.end_byte()).to_string())
}

/// Classify an Elixir `call` node based on its target keyword.
fn classify_call<'t>(node: Node<'t>, source: &str, at_root: bool) -> RawChunkCandidate<'t> {
	let target = call_target(node, source).unwrap_or_default();
	let name = || call_name(node, source).unwrap_or_else(|| "anonymous".to_string());
	match target.as_str() {
		"defmodule" => make_container_chunk(
			node,
			format!("mod_{}", name()),
			source,
			recurse_body(node, ChunkContext::ClassBody),
		),
		"defprotocol" => make_container_chunk(
			node,
			format!("proto_{}", name()),
			source,
			recurse_body(node, ChunkContext::ClassBody),
		),
		"defimpl" => make_container_chunk(
			node,
			format!("impl_{}", name()),
			source,
			recurse_body(node, ChunkContext::ClassBody),
		),
		"def" | "defp" | "defdelegate" | "defguard" | "defguardp" | "defn" | "defnp" => {
			make_named_chunk(
				node,
				format!("fn_{}", name()),
				source,
				recurse_body(node, ChunkContext::FunctionBody),
			)
		},
		"defmacro" | "defmacrop" => make_named_chunk(
			node,
			format!("macro_{}", name()),
			source,
			recurse_body(node, ChunkContext::FunctionBody),
		),
		"alias" | "import" | "require" | "use" => group_candidate(node, "imports", source),
		"defstruct" | "defexception" => group_candidate(node, "decls", source),
		"if" | "unless" => positional_candidate(node, "if", source),
		"case" | "cond" | "receive" => positional_candidate(node, "switch", source),
		"for" => positional_candidate(node, "for", source),
		"try" | "with" => positional_candidate(node, "block", source),
		_ if at_root => group_candidate(node, "stmts", source),
		_ => group_candidate(node, "block", source),
	}
}

/// Extract the name from an Elixir `call` node.
///
/// Skips keyword-only calls (imports, control flow) that have no meaningful
/// identifier, then returns the first non-`do_block` named child after the
/// target.
fn call_name(node: Node<'_>, source: &str) -> Option<String> {
	let target = call_target(node, source)?;
	if matches!(
		target.as_str(),
		"alias"
			| "import"
			| "require"
			| "use"
			| "if" | "case"
			| "cond"
			| "for"
			| "try"
			| "with"
			| "unless"
			| "receive"
	) {
		return None;
	}

	// The first named child after the target is typically `arguments`.
	// For `def run(x)`, arguments contains a `call` node whose target is `run`.
	// For `defmodule App`, arguments contains an `alias` node with text `App`.
	// For `def run(x) when is_integer(x)`, arguments contains a `binary_operator`
	// with the call on the left and the guard on the right.
	// Extract the meaningful name, not the full text with parameters.
	named_children(node).into_iter().skip(1).find_map(|child| {
		if child.kind() == "do_block" {
			return None;
		}
		if child.kind() == "arguments" {
			// Dig into arguments to find the actual name.
			return named_children(child).into_iter().next().and_then(|arg| {
				if arg.kind() == "call" {
					// `def run(x)` → arguments has call(target=run), extract target name
					call_target(arg, source).and_then(|t| sanitize_identifier(&t))
				} else if arg.kind() == "binary_operator" {
					// `def run(x) when guard` → binary_operator(left=call, right=guard)
					// Extract name from the left side (the actual function call).
					arg.child_by_field_name("left").and_then(|left| {
						if left.kind() == "call" {
							call_target(left, source).and_then(|t| sanitize_identifier(&t))
						} else {
							sanitize_identifier(node_text(source, left.start_byte(), left.end_byte()))
						}
					})
				} else {
					// `defmodule App` → arguments has alias("App")
					sanitize_identifier(node_text(source, arg.start_byte(), arg.end_byte()))
				}
			});
		}
		sanitize_identifier(node_text(source, child.start_byte(), child.end_byte()))
	})
}

impl LangClassifier for ElixirClassifier {
	fn classify_root<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		match node.kind() {
			"call" => Some(classify_call(node, source, true)),
			_ => None,
		}
	}

	fn classify_class<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		match node.kind() {
			"call" => Some(classify_call(node, source, false)),
			_ => None,
		}
	}

	fn classify_function<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		match node.kind() {
			"call" => Some(classify_call(node, source, false)),
			_ => None,
		}
	}

	fn is_trivia(&self, kind: &str) -> bool {
		// `@doc`, `@spec`, `@impl`, `@type`, `@moduledoc`, etc. are all
		// `unary_operator` nodes in the Elixir grammar (operator `@`).
		// Treat them as trivia so they get absorbed into the next chunk.
		kind == "unary_operator"
	}
}
