//! Chunk classifiers for data formats: JSON, TOML, YAML.

use tree_sitter::Node;

use super::{classify::LangClassifier, common::*, kind::ChunkKind};

pub struct DataFormatsClassifier;

impl LangClassifier for DataFormatsClassifier {
	fn classify_root<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		classify_data_node(node, source, true)
	}

	fn classify_class<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		classify_data_node(node, source, false)
	}

	fn classify_function<'t>(
		&self,
		_node: Node<'t>,
		_source: &str,
	) -> Option<RawChunkCandidate<'t>> {
		None
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
			Some(make_kind_chunk(
				node,
				ChunkKind::Key,
				Some(name),
				source,
				recurse_value_container(node),
			))
		},
		// TOML tables
		"table" => Some(container_candidate(
			node,
			ChunkKind::Table,
			source,
			Some(recurse_self(node, ChunkContext::ClassBody)),
		)),
		// TOML array tables
		"table_array_element" => Some(make_candidate(
			node,
			ChunkKind::Table,
			"table_array".to_string(),
			NameStyle::Named,
			signature_for_node(node, source),
			Some(recurse_self(node, ChunkContext::ClassBody)),
			source,
		)),
		// TOML inline tables
		"inline_table" => Some(make_container_chunk(
			node,
			ChunkKind::Table,
			None,
			source,
			Some(recurse_self(node, ChunkContext::ClassBody)),
		)),
		// JSON objects
		"object" => Some(make_container_chunk(
			node,
			ChunkKind::Object,
			None,
			source,
			Some(recurse_self(node, ChunkContext::ClassBody)),
		)),
		// JSON arrays
		"array" => Some(make_container_chunk(
			node,
			ChunkKind::Array,
			None,
			source,
			Some(recurse_self(node, ChunkContext::ClassBody)),
		)),
		// YAML block/flow mappings
		"block_mapping" | "flow_mapping" => Some(make_container_chunk(
			node,
			ChunkKind::Map,
			None,
			source,
			Some(recurse_self(node, ChunkContext::ClassBody)),
		)),
		// YAML block/flow sequences
		"block_sequence" | "flow_sequence" => Some(make_container_chunk(
			node,
			ChunkKind::List,
			None,
			source,
			Some(recurse_self(node, ChunkContext::ClassBody)),
		)),
		// YAML sequence items (only when nested, not at root level)
		"block_sequence_item" if !is_root => {
			Some(positional_candidate(node, ChunkKind::Item, source))
		},
		// Nix-style attributes that appear in data contexts
		"attribute" => {
			Some(named_candidate(node, ChunkKind::Attr, source, recurse_value_container(node)))
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

/// Extract key from a YAML `block_mapping_pair` or `flow_pair` node.
/// Descends into the key to find the first scalar child for complex keys.
fn extract_yaml_key(node: Node<'_>, source: &str) -> Option<String> {
	let key = node.child_by_field_name("key")?;
	let key_node = first_scalar_child(key).unwrap_or(key);
	sanitize_identifier(
		unquote_text(node_text(source, key_node.start_byte(), key_node.end_byte())).as_str(),
	)
}
