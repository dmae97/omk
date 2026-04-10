//! Default (shared) classification logic.
//!
//! These are minimal catch-all fallbacks for node kinds not handled by any
//! per-language classifier.  The real classification lives in the `ast_*`
//! modules; these defaults only fire for truly unrecognized node kinds.

use tree_sitter::Node;

use super::{common::*, kind::ChunkKind};

pub fn classify_root_default<'tree>(node: Node<'tree>, source: &str) -> RawChunkCandidate<'tree> {
	infer_named_candidate(node, source)
}

pub fn classify_class_default<'tree>(node: Node<'tree>, source: &str) -> RawChunkCandidate<'tree> {
	infer_named_candidate(node, source)
}

pub fn classify_function_default<'tree>(
	node: Node<'tree>,
	source: &str,
) -> RawChunkCandidate<'tree> {
	let kind_name = sanitize_node_kind(node.kind());
	let kind = ChunkKind::from_sanitized_kind(kind_name);
	let candidate = auto_classify(node, kind, source);
	if candidate.recurse.is_some() || candidate.identifier.is_some() {
		candidate
	} else {
		group_candidate(node, kind, source)
	}
}

pub fn classify_var_decl<'tree>(node: Node<'tree>, source: &str) -> RawChunkCandidate<'tree> {
	if let Some(candidate) = promote_assigned_expression(node, node, source) {
		return candidate;
	}
	if let Some(name) = extract_single_declarator_name(node, source) {
		return make_kind_chunk(node, ChunkKind::Variable, Some(name), source, None);
	}
	group_candidate(node, ChunkKind::Declarations, source)
}

pub fn promote_assigned_expression<'tree>(
	range_node: Node<'tree>,
	declaration_node: Node<'tree>,
	source: &str,
) -> Option<RawChunkCandidate<'tree>> {
	let declarators: Vec<Node<'tree>> = named_children(declaration_node)
		.into_iter()
		.filter(|c| c.kind() == "variable_declarator")
		.collect();
	if declarators.len() != 1 {
		return None;
	}

	let decl = declarators[0];
	let value = decl.child_by_field_name("value")?;
	let name = extract_identifier(decl, source).unwrap_or_else(|| "anonymous".to_string());

	match value.kind() {
		"arrow_function" | "function_expression" | "function" => {
			let recurse = recurse_body(value, ChunkContext::FunctionBody);
			Some(make_kind_chunk_from(
				range_node,
				value,
				ChunkKind::Function,
				Some(name),
				source,
				recurse,
			))
		},
		"class" | "class_expression" => {
			let recurse = recurse_class(value);
			Some(make_container_chunk_from(
				range_node,
				value,
				ChunkKind::Class,
				Some(name),
				source,
				recurse,
			))
		},
		_ => None,
	}
}
