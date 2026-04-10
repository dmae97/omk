//! Rust-specific chunk classifier.

use tree_sitter::Node;

use super::{
	classify::{
		ClassifierTables, LangClassifier, NamingMode, RecurseMode, RuleStyle, StructuralOverrides,
		semantic_rule,
	},
	common::*,
	kind::ChunkKind,
};

pub struct RustClassifier;

const ROOT_RULES: &[super::classify::SemanticRule] = &[
	// ── Imports ──
	semantic_rule(
		"use_declaration",
		ChunkKind::Imports,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"extern_crate_declaration",
		ChunkKind::Imports,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
	// ── Functions ──
	semantic_rule(
		"function_item",
		ChunkKind::Function,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"function_definition",
		ChunkKind::Function,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	// ── Containers ──
	semantic_rule(
		"struct_item",
		ChunkKind::Struct,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::ClassBody),
	),
	semantic_rule(
		"enum_item",
		ChunkKind::Enum,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::ClassBody),
	),
	semantic_rule(
		"trait_item",
		ChunkKind::Trait,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::ClassBody),
	),
	semantic_rule(
		"mod_item",
		ChunkKind::Module,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::ClassBody),
	),
	semantic_rule(
		"foreign_block",
		ChunkKind::Module,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::ClassBody),
	),
	// ── Types ──
	semantic_rule(
		"type_item",
		ChunkKind::Type,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::ClassBody),
	),
	// ── Macros ──
	semantic_rule(
		"macro_definition",
		ChunkKind::Macro,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"macro_rule",
		ChunkKind::Macro,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	// ── Statics / consts ──
	semantic_rule(
		"static_item",
		ChunkKind::Declarations,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"const_item",
		ChunkKind::Declarations,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
	// ── Attributes ──
	semantic_rule(
		"inner_attribute_item",
		ChunkKind::Attrs,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
	// ── Expression statements ──
	semantic_rule(
		"expression_statement",
		ChunkKind::Statements,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
];

const CLASS_RULES: &[super::classify::SemanticRule] = &[
	// ── Functions (methods in impl/trait) ──
	semantic_rule(
		"function_item",
		ChunkKind::Function,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"function_definition",
		ChunkKind::Function,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	// ── Types ──
	semantic_rule(
		"type_item",
		ChunkKind::Type,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::None,
	),
	semantic_rule(
		"type_alias",
		ChunkKind::Type,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::None,
	),
	// ── Consts / macros in class body ──
	semantic_rule(
		"const_item",
		ChunkKind::Fields,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"macro_invocation",
		ChunkKind::Fields,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
];

const FUNCTION_RULES: &[super::classify::SemanticRule] = &[
	// ── Control flow ──
	semantic_rule(
		"match_expression",
		ChunkKind::Match,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"loop_expression",
		ChunkKind::Loop,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"while_expression",
		ChunkKind::Loop,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"for_expression",
		ChunkKind::Loop,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::None,
	),
	// ── Expression statements ──
	semantic_rule(
		"expression_statement",
		ChunkKind::Statements,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
];

const RUST_TABLES: ClassifierTables = ClassifierTables {
	root:                 ROOT_RULES,
	class:                CLASS_RULES,
	function:             FUNCTION_RULES,
	structural_overrides: StructuralOverrides::EMPTY,
};

impl LangClassifier for RustClassifier {
	fn tables(&self) -> &'static ClassifierTables {
		&RUST_TABLES
	}

	fn classify_override<'t>(
		&self,
		context: ChunkContext,
		node: Node<'t>,
		source: &str,
	) -> Option<RawChunkCandidate<'t>> {
		match context {
			ChunkContext::Root => classify_root_custom(node, source),
			ChunkContext::ClassBody => classify_class_custom(node, source),
			ChunkContext::FunctionBody => classify_function_custom(node, source),
		}
	}
}

fn classify_root_custom<'t>(node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
	match node.kind() {
		// ── Impl blocks (custom name extraction) ──
		"impl_item" => {
			let name = extract_impl_name(node, source).unwrap_or_else(|| "anonymous".to_string());
			Some(make_container_chunk(
				node,
				ChunkKind::Impl,
				Some(name),
				source,
				recurse_into(node, ChunkContext::ClassBody, &["body"], &["declaration_list"]),
			))
		},

		// ── Variables (conditional auto-id vs group) ──
		"let_declaration" => Some(match extract_identifier(node, source) {
			Some(name) => make_kind_chunk(node, ChunkKind::Variable, Some(name), source, None),
			None => group_candidate(node, ChunkKind::Declarations, source),
		}),

		_ => None,
	}
}

fn classify_class_custom<'t>(node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
	match node.kind() {
		// ── Fields (conditional auto-id vs group) ──
		"field_declaration" => Some(match extract_identifier(node, source) {
			Some(name) => make_kind_chunk(node, ChunkKind::Field, Some(name), source, None),
			None => group_candidate(node, ChunkKind::Fields, source),
		}),

		// ── Enum variants (conditional auto-id vs group) ──
		"enum_variant" => Some(match extract_identifier(node, source) {
			Some(name) => make_kind_chunk(node, ChunkKind::Variant, Some(name), source, None),
			None => group_candidate(node, ChunkKind::Variants, source),
		}),

		// ── Attributes (explicitly return None — absorbed by framework) ──
		"attribute_item" => None,

		_ => None,
	}
}

fn classify_function_custom<'t>(node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
	let fn_recurse = || recurse_body(node, ChunkContext::FunctionBody);
	match node.kind() {
		// ── Control flow with recurse ──
		"if_expression" => Some(make_candidate(
			node,
			ChunkKind::If,
			None,
			NameStyle::Named,
			None,
			fn_recurse(),
			source,
		)),

		// ── Blocks ──
		"unsafe_block" | "async_block" | "const_block" | "block_expression" => Some(make_candidate(
			node,
			ChunkKind::Block,
			None,
			NameStyle::Named,
			None,
			fn_recurse(),
			source,
		)),

		// ── Variables (conditional line span) ──
		"let_declaration" => {
			let span = line_span(node.start_position().row + 1, node.end_position().row + 1);
			Some(if span > 1 {
				match extract_identifier(node, source) {
					Some(name) => make_kind_chunk(node, ChunkKind::Variable, Some(name), source, None),
					None => group_candidate(node, ChunkKind::Let, source),
				}
			} else {
				group_candidate(node, ChunkKind::Let, source)
			})
		},

		_ => None,
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
