//! Rust-specific chunk classifier.

use tree_sitter::Node;

use super::{classify::LangClassifier, common::*};

pub struct RustClassifier;

impl LangClassifier for RustClassifier {
	fn classify_root<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		match node.kind() {
			"impl_item" => {
				let name = extract_impl_name(node, source).unwrap_or_else(|| "anonymous".to_string());
				Some(make_container_chunk(
					node,
					format!("impl_{name}"),
					source,
					recurse_into(node, ChunkContext::ClassBody, &["body"], &["declaration_list"]),
				))
			},
			_ => None,
		}
	}
}

/// Extract the name for an `impl` block.
///
/// - Plain impl: `impl Foo` → `"Foo"`
/// - Trait impl: `impl Trait for Foo` → `"Trait_for_Foo"`
/// - Scoped trait: `impl fmt::Display for Foo` → `"Display_for_Foo"`
fn extract_impl_name(node: Node<'_>, source: &str) -> Option<String> {
	// Collect ALL children (including anonymous keywords like `for`).
	let all_children: Vec<Node<'_>> = (0..node.child_count())
		.filter_map(|i| node.child(i))
		.collect();

	// Find the `for` keyword position.
	let for_index = all_children
		.iter()
		.position(|c| node_text(source, c.start_byte(), c.end_byte()) == "for");

	if let Some(fi) = for_index {
		// Trait impl: trait name before `for`, type name after `for`.
		let trait_node = all_children[..fi].iter().rev().find(|c| {
			matches!(c.kind(), "type_identifier" | "scoped_type_identifier" | "generic_type")
		});
		let type_node = all_children[fi + 1..].iter().find(|c| {
			matches!(c.kind(), "type_identifier" | "scoped_type_identifier" | "generic_type")
		});

		if let (Some(tn), Some(ty)) = (trait_node, type_node) {
			let trait_name = extract_last_type_identifier(*tn, source)
				.or_else(|| sanitize_identifier(node_text(source, tn.start_byte(), tn.end_byte())))?;
			let type_name = extract_last_type_identifier(*ty, source)
				.or_else(|| sanitize_identifier(node_text(source, ty.start_byte(), ty.end_byte())))?;
			return Some(format!("{trait_name}_for_{type_name}"));
		}
	}

	// Plain impl: take the last type_identifier.
	let type_ids: Vec<Node<'_>> = named_children(node)
		.into_iter()
		.filter(|c| c.kind() == "type_identifier")
		.collect();
	type_ids
		.last()
		.and_then(|n| sanitize_identifier(node_text(source, n.start_byte(), n.end_byte())))
}

/// Recursively find the innermost `type_identifier` from a type node.
///
/// Handles scoped types like `fmt::Display` by traversing into
/// `scoped_type_identifier` and `generic_type` children.
fn extract_last_type_identifier(node: Node<'_>, source: &str) -> Option<String> {
	if node.kind() == "type_identifier" {
		return sanitize_identifier(node_text(source, node.start_byte(), node.end_byte()));
	}

	let mut result = None;
	for child in named_children(node) {
		if child.kind() == "type_identifier" {
			result = sanitize_identifier(node_text(source, child.start_byte(), child.end_byte()));
		} else if matches!(child.kind(), "scoped_type_identifier" | "generic_type")
			&& let Some(inner) = extract_last_type_identifier(child, source)
		{
			result = Some(inner);
		}
	}
	result
}
