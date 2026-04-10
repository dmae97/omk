//! Language-specific chunk classifier for Just.

use tree_sitter::Node;

use super::{
	classify::{
		ClassifierTables, LangClassifier, NamingMode, RecurseMode, RuleStyle, StructuralOverrides,
		semantic_rule,
	},
	common::*,
	kind::ChunkKind,
};

pub struct JustClassifier;

const JUST_FUNCTION_RULES: &[super::classify::SemanticRule] = &[
	semantic_rule(
		"recipe_line",
		ChunkKind::Cmd,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"shebang",
		ChunkKind::Shebang,
		RuleStyle::Named,
		NamingMode::None,
		RecurseMode::None,
	),
];

const JUST_TABLES: ClassifierTables = ClassifierTables {
	root:                 &[],
	class:                &[],
	function:             JUST_FUNCTION_RULES,
	structural_overrides: StructuralOverrides {
		extra_trivia:            &[],
		preserved_trivia:        &[],
		extra_root_wrappers:     &["source_file"],
		preserved_root_wrappers: &[],
		absorbable_attrs:        &[],
	},
};

fn first_named_child(node: Node<'_>) -> Option<Node<'_>> {
	named_children(node).into_iter().next()
}

fn first_named_child_of_kind<'t>(node: Node<'t>, kind: &str) -> Option<Node<'t>> {
	named_children(node)
		.into_iter()
		.find(|child| child.kind() == kind)
}

fn child_text<'a>(source: &'a str, node: Node<'_>) -> &'a str {
	node_text(source, node.start_byte(), node.end_byte())
}

/// `set shell := ...` uses a dedicated `shell` token instead of a named
/// identifier, so parse the assignment head text instead of relying on fields.
fn extract_setting_name(node: Node<'_>, source: &str) -> Option<String> {
	let header = child_text(source, node).lines().next()?.trim();
	let rest = header.strip_prefix("set ")?;
	let name = rest.split_once(":=")?.0.trim();
	sanitize_identifier(name)
}

fn extract_alias_name(node: Node<'_>, source: &str) -> Option<String> {
	first_named_child(node).and_then(|child| sanitize_identifier(child_text(source, child)))
}

fn extract_recipe_name(node: Node<'_>, source: &str) -> Option<String> {
	let header = first_named_child_of_kind(node, "recipe_header")?;
	first_named_child(header).and_then(|child| sanitize_identifier(child_text(source, child)))
}

fn classify_just_root_node<'t>(node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
	Some(match node.kind() {
		"setting" => {
			let name = extract_setting_name(node, source).unwrap_or_else(|| "anonymous".to_string());
			make_kind_chunk(node, ChunkKind::Setting, Some(name), source, None)
		},
		"alias" => {
			let name = extract_alias_name(node, source).unwrap_or_else(|| "anonymous".to_string());
			make_kind_chunk(node, ChunkKind::Alias, Some(name), source, None)
		},
		"recipe" => {
			let name = extract_recipe_name(node, source).unwrap_or_else(|| "anonymous".to_string());
			make_container_chunk(
				node,
				ChunkKind::Recipe,
				Some(name),
				source,
				recurse_into(node, ChunkContext::FunctionBody, &[], &["recipe_body"]),
			)
		},
		_ => return None,
	})
}

fn classify_just_body_node<'t>(node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
	Some(match node.kind() {
		// Just recipe bodies are line-oriented; tree-sitter exposes shell lines as
		// `recipe_line` leaves rather than a nested shell AST.
		"recipe_line" => group_candidate(node, ChunkKind::Cmd, source),
		"shebang" => make_kind_chunk(node, ChunkKind::Shebang, None, source, None),
		_ => return None,
	})
}

impl LangClassifier for JustClassifier {
	fn tables(&self) -> &'static ClassifierTables {
		&JUST_TABLES
	}

	fn classify_override<'t>(
		&self,
		context: ChunkContext,
		node: Node<'t>,
		source: &str,
	) -> Option<RawChunkCandidate<'t>> {
		match context {
			ChunkContext::Root => classify_just_root_node(node, source),
			ChunkContext::FunctionBody => classify_just_body_node(node, source),
			ChunkContext::ClassBody => None,
		}
	}
}
