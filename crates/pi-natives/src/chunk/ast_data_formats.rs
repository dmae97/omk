//! Chunk classifiers for data formats: JSON, TOML, YAML.

use tree_sitter::Node;

use super::{
	classify::{
		ClassifierTables, LangClassifier, NamingMode, RecurseMode, RuleStyle, StructuralOverrides,
		semantic_rule,
	},
	common::*,
	kind::ChunkKind,
};

pub struct DataFormatsClassifier;

const DATA_FORMAT_STRUCTURAL_OVERRIDES: StructuralOverrides = StructuralOverrides {
	extra_trivia:            &["bare_key", "quoted_key", "dotted_key"],
	preserved_trivia:        &[],
	extra_root_wrappers:     &[
		"array",
		"block_mapping",
		"block_node",
		"block_sequence",
		"document",
		"flow_mapping",
		"flow_node",
		"flow_sequence",
		"object",
		"stream",
	],
	preserved_root_wrappers: &[],
	absorbable_attrs:        &[],
};

const DATA_FORMAT_ROOT_RULES: &[super::classify::SemanticRule] = &[
	semantic_rule(
		"inline_table",
		ChunkKind::Table,
		RuleStyle::Named,
		NamingMode::None,
		RecurseMode::SelfNode(ChunkContext::ClassBody),
	),
	semantic_rule(
		"object",
		ChunkKind::Object,
		RuleStyle::Named,
		NamingMode::None,
		RecurseMode::SelfNode(ChunkContext::ClassBody),
	),
	semantic_rule(
		"array",
		ChunkKind::Array,
		RuleStyle::Named,
		NamingMode::None,
		RecurseMode::SelfNode(ChunkContext::ClassBody),
	),
	semantic_rule(
		"block_mapping",
		ChunkKind::Map,
		RuleStyle::Named,
		NamingMode::None,
		RecurseMode::SelfNode(ChunkContext::ClassBody),
	),
	semantic_rule(
		"flow_mapping",
		ChunkKind::Map,
		RuleStyle::Named,
		NamingMode::None,
		RecurseMode::SelfNode(ChunkContext::ClassBody),
	),
	semantic_rule(
		"block_sequence",
		ChunkKind::List,
		RuleStyle::Named,
		NamingMode::None,
		RecurseMode::SelfNode(ChunkContext::ClassBody),
	),
	semantic_rule(
		"flow_sequence",
		ChunkKind::List,
		RuleStyle::Named,
		NamingMode::None,
		RecurseMode::SelfNode(ChunkContext::ClassBody),
	),
	semantic_rule(
		"attribute",
		ChunkKind::Attr,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::ValueContainer,
	),
];

const DATA_FORMAT_CLASS_RULES: &[super::classify::SemanticRule] = &[
	semantic_rule(
		"inline_table",
		ChunkKind::Table,
		RuleStyle::Named,
		NamingMode::None,
		RecurseMode::SelfNode(ChunkContext::ClassBody),
	),
	semantic_rule(
		"object",
		ChunkKind::Object,
		RuleStyle::Named,
		NamingMode::None,
		RecurseMode::SelfNode(ChunkContext::ClassBody),
	),
	semantic_rule(
		"array",
		ChunkKind::Array,
		RuleStyle::Named,
		NamingMode::None,
		RecurseMode::SelfNode(ChunkContext::ClassBody),
	),
	semantic_rule(
		"block_mapping",
		ChunkKind::Map,
		RuleStyle::Named,
		NamingMode::None,
		RecurseMode::SelfNode(ChunkContext::ClassBody),
	),
	semantic_rule(
		"flow_mapping",
		ChunkKind::Map,
		RuleStyle::Named,
		NamingMode::None,
		RecurseMode::SelfNode(ChunkContext::ClassBody),
	),
	semantic_rule(
		"block_sequence",
		ChunkKind::List,
		RuleStyle::Named,
		NamingMode::None,
		RecurseMode::SelfNode(ChunkContext::ClassBody),
	),
	semantic_rule(
		"flow_sequence",
		ChunkKind::List,
		RuleStyle::Named,
		NamingMode::None,
		RecurseMode::SelfNode(ChunkContext::ClassBody),
	),
	semantic_rule(
		"block_sequence_item",
		ChunkKind::Item,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"attribute",
		ChunkKind::Attr,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::ValueContainer,
	),
];

const DATA_FORMAT_TABLES: ClassifierTables = ClassifierTables {
	root:                 DATA_FORMAT_ROOT_RULES,
	class:                DATA_FORMAT_CLASS_RULES,
	function:             &[],
	structural_overrides: DATA_FORMAT_STRUCTURAL_OVERRIDES,
};

impl LangClassifier for DataFormatsClassifier {
	fn tables(&self) -> &'static ClassifierTables {
		&DATA_FORMAT_TABLES
	}

	fn classify_override<'t>(
		&self,
		context: ChunkContext,
		node: Node<'t>,
		source: &str,
	) -> Option<RawChunkCandidate<'t>> {
		match context {
			ChunkContext::Root => classify_data_node(node, source, true),
			ChunkContext::ClassBody => classify_data_node(node, source, false),
			ChunkContext::FunctionBody => None,
		}
	}

	fn preserve_children(
		&self,
		parent: &RawChunkCandidate<'_>,
		_children: &[RawChunkCandidate<'_>],
	) -> bool {
		// YAML keys with container values should always expose sub-chunks
		// so that deeply nested keys are individually addressable.
		parent.force_recurse && parent.kind == ChunkKind::Key
	}
}

fn classify_data_node<'t>(
	node: Node<'t>,
	source: &str,
	is_root: bool,
) -> Option<RawChunkCandidate<'t>> {
	match node.kind() {
		// Key-value pairs (JSON pairs, YAML mappings)
		"pair" => {
			let name = extract_pair_key(node, source).unwrap_or_else(|| "anonymous".to_string());
			Some(make_kind_chunk(
				node,
				ChunkKind::Key,
				Some(name),
				source,
				recurse_value_container(node),
			))
		},
		"block_mapping_pair" | "flow_pair" => {
			let name = extract_yaml_key(node, source).unwrap_or_else(|| "anonymous".to_string());
			let recurse = recurse_value_container(node);
			let mut candidate = make_kind_chunk(node, ChunkKind::Key, Some(name), source, recurse);
			// YAML structure is inherently hierarchical. Keys whose value is a
			// container (mapping/sequence) should always produce sub-chunks so
			// that deeply nested keys are individually addressable.
			if candidate.recurse.is_some() {
				candidate.force_recurse = true;
			}
			Some(candidate)
		},
		// TOML tables
		"table" => {
			let name = extract_toml_table_name(node, source);
			Some(make_container_chunk(
				node,
				ChunkKind::Table,
				name,
				source,
				Some(recurse_self(node, ChunkContext::ClassBody)),
			))
		},
		// TOML array tables
		"table_array_element" => Some(make_candidate(
			node,
			ChunkKind::Table,
			extract_toml_table_name(node, source).unwrap_or_else(|| "table_array".to_string()),
			NameStyle::Named,
			signature_for_node(node, source),
			Some(recurse_self(node, ChunkContext::ClassBody)),
			source,
		)),
		// YAML sequence items (only when nested, not at root level)
		"block_sequence_item" if !is_root => {
			Some(positional_candidate(node, ChunkKind::Item, source))
		},
		_ => None,
	}
}

/// Extract key from a `pair` node (JSON or TOML).
/// JSON pairs have a `"key"` field; TOML pairs have no field names, so we fall
/// back to looking for the first `bare_key`, `quoted_key`, or `dotted_key`
/// child.
fn extract_pair_key(node: Node<'_>, source: &str) -> Option<String> {
	let key = node
		.child_by_field_name("key")
		.or_else(|| child_by_kind(node, &["bare_key", "quoted_key", "dotted_key"]))?;
	sanitize_identifier(unquote_text(node_text(source, key.start_byte(), key.end_byte())).as_str())
}

fn extract_toml_table_name(node: Node<'_>, source: &str) -> Option<String> {
	let key = child_by_kind(node, &["dotted_key", "bare_key", "quoted_key"])?;
	sanitize_identifier(node_text(source, key.start_byte(), key.end_byte()))
}

/// Extract key from a YAML `block_mapping_pair` or `flow_pair` node.
/// Descends into the key to find the first scalar child for complex keys.
fn extract_yaml_key(node: Node<'_>, source: &str) -> Option<String> {
	let key = node.child_by_field_name("key")?;
	let key_node = first_scalar_child(key).unwrap_or(key);
	sanitize_identifier(
		unquote_text(node_text(source, key_node.start_byte(), key_node.end_byte())).as_str(),
	)
}
