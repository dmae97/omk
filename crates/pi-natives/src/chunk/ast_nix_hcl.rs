//! Language-specific chunk classifiers for Nix and HCL (Terraform).

use tree_sitter::Node;

use super::{classify::LangClassifier, common::*};

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

impl LangClassifier for NixHclClassifier {
	fn classify_root<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		match node.kind() {
			// Nix top-level attribute set entries
			"attribute" => {
				let name = child_by_kind(node, &["identifier"])
					.and_then(|c| sanitize_identifier(node_text(source, c.start_byte(), c.end_byte())))
					.unwrap_or_else(|| "anonymous".to_string());
				Some(make_named_chunk(
					node,
					format!("attr_{name}"),
					source,
					recurse_value_container(node),
				))
			},
			"binding" => {
				let name =
					extract_nix_binding_name(node, source).unwrap_or_else(|| "anonymous".to_string());
				Some(make_named_chunk(
					node,
					format!("binding_{name}"),
					source,
					recurse_value_container(node),
				))
			},
			// HCL top-level block, or diff hunk fallback
			"block" => {
				if let Some(name) = extract_hcl_block_name(node, source) {
					Some(make_container_chunk(
						node,
						format!("block_{name}"),
						source,
						recurse_into(node, ChunkContext::ClassBody, &[], &["body"]),
					))
				} else {
					Some(group_candidate(node, "hunks", source))
				}
			},
			// Nix expressions
			"function_expression" | "let_expression" => {
				Some(named_candidate(node, "expr", source, recurse_value_container(node)))
			},
			// Nix inherit
			"inherit" => Some(group_candidate(node, "imports", source)),
			// Variable/assignment declarations
			"variable_declaration" | "assignment" => Some(group_candidate(node, "decls", source)),
			// HCL top-level block types
			"provider" | "resource" | "data" | "locals" | "variable" | "output" | "module" => {
				Some(container_candidate(
					node,
					sanitize_node_kind(node.kind()).as_str(),
					source,
					recurse_into(node, ChunkContext::ClassBody, &[], &["body"]),
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
					format!("block_{name}"),
					source,
					recurse_into(node, ChunkContext::ClassBody, &[], &["body"]),
				)
			}),
			// Nested Nix binding
			"binding" => {
				let name =
					extract_nix_binding_name(node, source).unwrap_or_else(|| "anonymous".to_string());
				Some(make_named_chunk(
					node,
					format!("binding_{name}"),
					source,
					recurse_value_container(node),
				))
			},
			_ => None,
		}
	}

	fn classify_function<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		match node.kind() {
			// Nix control flow
			"if_expression" => Some(positional_candidate(node, "if", source)),
			"let_expression" => Some(positional_candidate(node, "block", source)),
			_ => None,
		}
	}
}
