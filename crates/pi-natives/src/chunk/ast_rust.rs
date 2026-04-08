//! Rust-specific chunk classifier.

use tree_sitter::Node;

use super::{classify::LangClassifier, common::*, kind::ChunkKind};

pub struct RustClassifier;

impl LangClassifier for RustClassifier {
	fn classify_root<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		Some(match node.kind() {
			// ── Imports ──
			"use_declaration" | "extern_crate_declaration" => {
				group_candidate(node, ChunkKind::Imports, source)
			},

			// ── Functions ──
			"function_item" | "function_definition" => named_candidate(
				node,
				ChunkKind::Function,
				source,
				recurse_body(node, ChunkContext::FunctionBody)
					.or_else(|| recurse_into(node, ChunkContext::FunctionBody, &["body"], &["block"])),
			),

			// ── Containers ──
			"struct_item" => container_candidate(node, ChunkKind::Struct, source, recurse_class(node)),
			"enum_item" => container_candidate(node, ChunkKind::Enum, source, recurse_enum(node)),
			"trait_item" => container_candidate(node, ChunkKind::Trait, source, recurse_class(node)),
			"mod_item" | "foreign_block" => {
				container_candidate(node, ChunkKind::Module, source, recurse_class(node))
			},
			"impl_item" => {
				let name = extract_impl_name(node, source).unwrap_or_else(|| "anonymous".to_string());
				make_container_chunk(
					node,
					ChunkKind::Impl,
					Some(name),
					source,
					recurse_into(node, ChunkContext::ClassBody, &["body"], &["declaration_list"]),
				)
			},

			// ── Types ──
			"type_item" => named_candidate(node, ChunkKind::Type, source, recurse_class(node)),

			// ── Macros ──
			"macro_definition" | "macro_rule" => named_candidate(
				node,
				ChunkKind::Macro,
				source,
				recurse_body(node, ChunkContext::FunctionBody),
			),

			// ── Statics / consts ──
			"static_item" | "const_item" => group_candidate(node, ChunkKind::Declarations, source),

			// ── Attributes ──
			"inner_attribute_item" => group_candidate(node, ChunkKind::Attrs, source),

			// ── Variables ──
			"let_declaration" => match extract_identifier(node, source) {
				Some(name) => make_kind_chunk(node, ChunkKind::Variable, Some(name), source, None),
				None => group_candidate(node, ChunkKind::Declarations, source),
			},

			// ── Expression statements ──
			"expression_statement" => group_candidate(node, ChunkKind::Statements, source),

			_ => return None,
		})
	}

	fn classify_class<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		Some(match node.kind() {
			// ── Methods ──
			"function_item" | "function_definition" => {
				let name = extract_identifier(node, source).unwrap_or_else(|| "anonymous".to_string());
				make_kind_chunk(
					node,
					ChunkKind::Function,
					Some(name),
					source,
					recurse_body(node, ChunkContext::FunctionBody),
				)
			},

			// ── Types ──
			"type_item" | "type_alias" => named_candidate(node, ChunkKind::Type, source, None),

			// ── Fields ──
			"field_declaration" => match extract_identifier(node, source) {
				Some(name) => make_kind_chunk(node, ChunkKind::Field, Some(name), source, None),
				None => group_candidate(node, ChunkKind::Fields, source),
			},

			// ── Enum variants ──
			"enum_variant" => match extract_identifier(node, source) {
				Some(name) => make_kind_chunk(node, ChunkKind::Variant, Some(name), source, None),
				None => group_candidate(node, ChunkKind::Variants, source),
			},

			// ── Consts / macros in class body ──
			"const_item" | "macro_invocation" => group_candidate(node, ChunkKind::Fields, source),

			// ── Attributes (absorbed by the framework, but handle explicitly) ──
			"attribute_item" => return None,

			_ => return None,
		})
	}

	fn classify_function<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		let fn_recurse = || recurse_body(node, ChunkContext::FunctionBody);
		Some(match node.kind() {
			// ── Control flow ──
			"if_expression" => {
				make_candidate(node, ChunkKind::If, None, NameStyle::Named, None, fn_recurse(), source)
			},
			"match_expression" => positional_candidate(node, ChunkKind::Match, source),
			"loop_expression" | "while_expression" | "for_expression" => {
				positional_candidate(node, ChunkKind::Loop, source)
			},

			// ── Blocks ──
			"unsafe_block" | "async_block" | "const_block" | "block_expression" => make_candidate(
				node,
				ChunkKind::Block,
				None,
				NameStyle::Named,
				None,
				fn_recurse(),
				source,
			),

			// ── Variables ──
			"let_declaration" => {
				let span = line_span(node.start_position().row + 1, node.end_position().row + 1);
				if span > 1 {
					match extract_identifier(node, source) {
						Some(name) => {
							make_kind_chunk(node, ChunkKind::Variable, Some(name), source, None)
						},
						None => group_candidate(node, ChunkKind::Let, source),
					}
				} else {
					group_candidate(node, ChunkKind::Let, source)
				}
			},

			// ── Expression statements ──
			"expression_statement" => group_candidate(node, ChunkKind::Statements, source),

			_ => return None,
		})
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
