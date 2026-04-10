//! Language-specific chunk classifiers for Nix and HCL (Terraform).

use tree_sitter::Node;

use super::{classify::LangClassifier, common::*, kind::ChunkKind};

pub struct NixHclClassifier;

/// Extract a structured name from an HCL `block` node.
///
/// Shape: `block_type label1 label2 … { body }` where labels are `string_lit`.
/// Returns e.g. `resource_aws_instance_web` for `resource "aws_instance" "web"
/// { … }`.
fn extract_hcl_block_name(node: Node<'_>, source: &str) -> Option<String> {
	let mut children = named_children(node).into_iter();
	let block_type = children.next()?;
	let mut parts =
		vec![node_text(source, block_type.start_byte(), block_type.end_byte()).to_string()];
	for child in children {
		if child.kind() == "string_lit" {
			let text = unquote_text(node_text(source, child.start_byte(), child.end_byte()));
			if !text.is_empty() {
				parts.push(text);
			}
			continue;
		}
		if child.kind() == "body" || child.kind() == "block_end" || child.kind() == "block_start" {
			continue;
		}
		let text = node_text(source, child.start_byte(), child.end_byte());
		if !text.is_empty() {
			parts.push(text.to_string());
		}
	}
	sanitize_identifier(parts.join("_").as_str())
}

/// Extract the attrpath name from a Nix `binding` node.
fn extract_nix_binding_name(node: Node<'_>, source: &str) -> Option<String> {
	node.child_by_field_name("attrpath").and_then(|attrpath| {
		sanitize_identifier(node_text(source, attrpath.start_byte(), attrpath.end_byte()))
	})
}

fn recurse_nix_attrset(node: Node<'_>) -> Option<RecurseSpec<'_>> {
	recurse_into(node, ChunkContext::ClassBody, &[], &["binding_set"])
}

fn recurse_nix_binding_value(node: Node<'_>) -> Option<RecurseSpec<'_>> {
	let expression = node.child_by_field_name("expression")?;
	if matches!(
		expression.kind(),
		"attrset_expression" | "let_attrset_expression" | "rec_attrset_expression"
	) {
		return recurse_nix_attrset(expression);
	}
	recurse_value_container(node)
}

fn classify_nix_binding<'t>(node: Node<'t>, source: &str) -> RawChunkCandidate<'t> {
	let name = extract_nix_binding_name(node, source).unwrap_or_else(|| "anonymous".to_string());
	let expression = node.child_by_field_name("expression");
	if let Some(expression) = expression
		&& matches!(
			expression.kind(),
			"attrset_expression" | "let_attrset_expression" | "rec_attrset_expression"
		) {
		return make_container_chunk(
			node,
			ChunkKind::Attr,
			Some(name),
			source,
			recurse_nix_attrset(expression),
		);
	}
	make_kind_chunk(node, ChunkKind::Attr, Some(name), source, recurse_nix_binding_value(node))
}

impl LangClassifier for NixHclClassifier {
	fn classify_root<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		match node.kind() {
			// Nix top-level attrsets should recurse into their binding_set so the file exposes
			// structural attr chunks instead of a single opaque attrset_expr leaf.
			"attrset_expression" | "let_attrset_expression" | "rec_attrset_expression" => {
				Some(make_candidate(
					node,
					ChunkKind::Attrs,
					None,
					NameStyle::Named,
					signature_for_node(node, source),
					recurse_nix_attrset(node),
					source,
				))
			},
			// Older tree-sitter-nix revisions used `attribute`; current grammars expose `binding`.
			"attribute" | "binding" => Some(classify_nix_binding(node, source)),
			// HCL top-level block, or diff hunk fallback
			"block" => {
				if let Some(name) = extract_hcl_block_name(node, source) {
					Some(make_container_chunk(
						node,
						ChunkKind::Block,
						Some(name),
						source,
						recurse_into(node, ChunkContext::ClassBody, &[], &["body"]),
					))
				} else {
					Some(group_candidate(node, ChunkKind::Hunks, source))
				}
			},
			// Nix expressions
			"function_expression" | "let_expression" => Some(named_candidate(
				node,
				ChunkKind::Expression,
				source,
				recurse_value_container(node),
			)),
			// Nix inherit
			"inherit" => Some(group_candidate(node, ChunkKind::Imports, source)),
			// Variable/assignment declarations
			"variable_declaration" | "assignment" => {
				Some(group_candidate(node, ChunkKind::Declarations, source))
			},
			// HCL top-level block types
			"provider" | "resource" | "data" | "locals" | "variable" | "output" | "module" => {
				let kind = match node.kind() {
					"locals" => ChunkKind::BlockLocals,
					"variable" => ChunkKind::Variable,
					"module" => ChunkKind::Module,
					_ => ChunkKind::Block,
				};
				Some(make_candidate(
					node,
					kind,
					prefixed_name(sanitize_node_kind(node.kind()), node, source),
					NameStyle::Named,
					signature_for_node(node, source),
					recurse_into(node, ChunkContext::ClassBody, &[], &["body"]),
					source,
				))
			},
			_ => None,
		}
	}

	fn classify_class<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		match node.kind() {
			// Nested HCL block — only promote if it has an identifiable block name
			"block" => extract_hcl_block_name(node, source).map(|name| {
				make_container_chunk(
					node,
					ChunkKind::Block,
					Some(name),
					source,
					recurse_into(node, ChunkContext::ClassBody, &[], &["body"]),
				)
			}),
			// Nested Nix attrset values recurse into their binding_set just like top-level ones.
			"attrset_expression" | "let_attrset_expression" | "rec_attrset_expression" => {
				Some(make_candidate(
					node,
					ChunkKind::Attrs,
					None,
					NameStyle::Named,
					signature_for_node(node, source),
					recurse_nix_attrset(node),
					source,
				))
			},
			// Nix binding_set is a transparent wrapper around individual bindings.
			// Without this, the binding_set becomes an opaque leaf chunk hiding
			// all bindings inside a single massive block.
			"binding_set" => Some(make_candidate(
				node,
				ChunkKind::Attrs,
				None,
				NameStyle::Named,
				None,
				Some(RecurseSpec { node, context: ChunkContext::ClassBody }),
				source,
			)),
			// Nix let_expression inside a class-body context — recurse into its
			// binding_set so individual bindings are addressable.
			"let_expression" => Some(make_candidate(
				node,
				ChunkKind::Expression,
				None,
				NameStyle::Named,
				signature_for_node(node, source),
				recurse_value_container(node),
				source,
			)),
			// Nested Nix binding
			"binding" => Some(classify_nix_binding(node, source)),
			_ => None,
		}
	}

	fn classify_function<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		match node.kind() {
			// Nix control flow
			"if_expression" => Some(positional_candidate(node, ChunkKind::If, source)),
			"let_expression" => Some(positional_candidate(node, ChunkKind::Block, source)),
			_ => None,
		}
	}
}
