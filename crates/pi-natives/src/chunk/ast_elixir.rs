//! Language-specific chunk classifier for Elixir.

use tree_sitter::Node;

use super::{
	classify::{ClassifierTables, LangClassifier, StructuralOverrides},
	common::*,
	kind::ChunkKind,
};

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
			ChunkKind::Module,
			Some(name()),
			source,
			recurse_body(node, ChunkContext::ClassBody),
		),
		"defprotocol" => make_container_chunk(
			node,
			ChunkKind::Proto,
			Some(name()),
			source,
			recurse_body(node, ChunkContext::ClassBody),
		),
		"defimpl" => make_container_chunk(
			node,
			ChunkKind::Impl,
			Some(name()),
			source,
			recurse_body(node, ChunkContext::ClassBody),
		),
		"def" | "defp" | "defdelegate" | "defguard" | "defguardp" | "defn" | "defnp" => {
			make_kind_chunk(
				node,
				ChunkKind::Function,
				Some(name()),
				source,
				recurse_body(node, ChunkContext::FunctionBody),
			)
		},
		"defmacro" | "defmacrop" => make_kind_chunk(
			node,
			ChunkKind::Macro,
			Some(name()),
			source,
			recurse_body(node, ChunkContext::FunctionBody),
		),
		"alias" | "import" | "require" | "use" => group_candidate(node, ChunkKind::Imports, source),
		"defstruct" | "defexception" => group_candidate(node, ChunkKind::Declarations, source),
		"if" | "unless" => positional_candidate(node, ChunkKind::If, source),
		"case" | "cond" | "receive" => positional_candidate(node, ChunkKind::Switch, source),
		"for" => positional_candidate(node, ChunkKind::For, source),
		"try" | "with" => positional_candidate(node, ChunkKind::Block, source),
		_ if at_root => group_candidate(node, ChunkKind::Statements, source),
		_ => group_candidate(node, ChunkKind::Block, source),
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
	fn tables(&self) -> &'static ClassifierTables {
		static TABLES: ClassifierTables = ClassifierTables {
			root:                 &[],
			class:                &[],
			function:             &[],
			structural_overrides: StructuralOverrides {
				extra_trivia:            &["unary_operator"],
				preserved_trivia:        &[],
				extra_root_wrappers:     &[],
				preserved_root_wrappers: &[],
				absorbable_attrs:        &[],
			},
		};
		&TABLES
	}

	fn classify_override<'t>(
		&self,
		context: ChunkContext,
		node: Node<'t>,
		source: &str,
	) -> Option<RawChunkCandidate<'t>> {
		(node.kind() == "call").then(|| classify_call(node, source, context == ChunkContext::Root))
	}
}
