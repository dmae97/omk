//! GraphQL-specific chunk classifier.

use tree_sitter::Node;

use super::{
	classify::{ClassifierTables, LangClassifier, StructuralOverrides},
	common::*,
	kind::ChunkKind,
};

pub struct GraphqlClassifier;

impl LangClassifier for GraphqlClassifier {
	fn tables(&self) -> &'static ClassifierTables {
		static TABLES: ClassifierTables = ClassifierTables {
			root:                 &[],
			class:                &[],
			function:             &[],
			structural_overrides: StructuralOverrides {
				extra_trivia:            &["comma"],
				preserved_trivia:        &[],
				extra_root_wrappers:     &[
					"document",
					"definition",
					"type_system_definition",
					"type_definition",
					"executable_definition",
				],
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
		match context {
			ChunkContext::Root => classify_graphql_root(node, source),
			ChunkContext::ClassBody => classify_graphql_class(node, source),
			ChunkContext::FunctionBody => classify_graphql_function(node, source),
		}
	}
}

fn classify_graphql_root<'t>(node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
	match node.kind() {
		"schema_definition" => Some(make_container_chunk(
			node,
			ChunkKind::Schema,
			None,
			source,
			Some(recurse_self(node, ChunkContext::ClassBody)),
		)),
		"directive_definition" => Some(make_named_graphql_chunk(
			node,
			ChunkKind::Directive,
			extract_graphql_name(node, source).unwrap_or_else(|| "anonymous".to_string()),
			source,
			recurse_into(node, ChunkContext::ClassBody, &[], &["arguments_definition"]),
		)),
		"scalar_type_definition" => Some(make_named_graphql_chunk(
			node,
			ChunkKind::Type,
			format!(
				"scalar_{}",
				extract_graphql_name(node, source).unwrap_or_else(|| "anonymous".to_string())
			),
			source,
			None,
		)),
		"object_type_definition" => Some(make_container_chunk(
			node,
			ChunkKind::Type,
			extract_graphql_name(node, source),
			source,
			recurse_into(node, ChunkContext::ClassBody, &[], &["fields_definition"]),
		)),
		"interface_type_definition" => Some(make_container_chunk(
			node,
			ChunkKind::Interface,
			extract_graphql_name(node, source),
			source,
			recurse_into(node, ChunkContext::ClassBody, &[], &["fields_definition"]),
		)),
		"union_type_definition" => Some(make_kind_chunk(
			node,
			ChunkKind::Union,
			extract_graphql_name(node, source),
			source,
			None,
		)),
		"enum_type_definition" => Some(make_container_chunk(
			node,
			ChunkKind::Enum,
			extract_graphql_name(node, source),
			source,
			recurse_into(node, ChunkContext::ClassBody, &[], &["enum_values_definition"]),
		)),
		"input_object_type_definition" => Some(make_named_graphql_chunk(
			node,
			ChunkKind::Type,
			format!(
				"input_{}",
				extract_graphql_name(node, source).unwrap_or_else(|| "anonymous".to_string())
			),
			source,
			recurse_into(node, ChunkContext::ClassBody, &[], &["input_fields_definition"]),
		)),
		"operation_definition" => Some(make_named_graphql_chunk(
			node,
			ChunkKind::Operation,
			extract_graphql_operation_chunk_name(node, source),
			source,
			recurse_into(node, ChunkContext::FunctionBody, &[], &["selection_set"]),
		)),
		"fragment_definition" => Some(make_named_graphql_chunk(
			node,
			ChunkKind::Operation,
			format!(
				"fragment_{}",
				extract_graphql_name(node, source).unwrap_or_else(|| "anonymous".to_string())
			),
			source,
			recurse_into(node, ChunkContext::FunctionBody, &[], &["selection_set"]),
		)),
		_ => None,
	}
}

fn classify_graphql_class<'t>(node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
	match node.kind() {
		"root_operation_type_definition" => Some(make_named_graphql_chunk(
			node,
			ChunkKind::Root,
			extract_graphql_operation_type(node, source).unwrap_or_else(|| "anonymous".to_string()),
			source,
			None,
		)),
		"field_definition" => {
			let name = extract_graphql_name(node, source).unwrap_or_else(|| "anonymous".to_string());
			let recurse = recurse_into(node, ChunkContext::ClassBody, &[], &["arguments_definition"]);
			Some(match recurse {
				Some(recurse) => {
					make_container_chunk(node, ChunkKind::Field, Some(name), source, Some(recurse))
				},
				None => make_kind_chunk(node, ChunkKind::Field, Some(name), source, None),
			})
		},
		"input_value_definition" => Some(classify_graphql_input_value(node, source)),
		"enum_value_definition" => Some(make_named_graphql_chunk(
			node,
			ChunkKind::Variant,
			format!(
				"value_{}",
				extract_graphql_name(node, source).unwrap_or_else(|| "anonymous".to_string())
			),
			source,
			None,
		)),
		_ => None,
	}
}

fn classify_graphql_function<'t>(node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
	match node.kind() {
		"selection" => classify_graphql_selection(node, source),
		_ => None,
	}
}

fn classify_graphql_selection<'t>(node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
	let child = first_named_child(node)?;
	match child.kind() {
		"field" => {
			let name = extract_graphql_name(child, source).unwrap_or_else(|| "anonymous".to_string());
			let recurse = recurse_into(child, ChunkContext::FunctionBody, &[], &["selection_set"]);
			Some(match recurse {
				Some(recurse) => make_container_chunk_from(
					node,
					child,
					ChunkKind::Field,
					Some(name),
					source,
					Some(recurse),
				),
				None => make_kind_chunk_from(node, child, ChunkKind::Field, Some(name), source, None),
			})
		},
		"fragment_spread" => Some(make_named_graphql_chunk_from(
			node,
			child,
			ChunkKind::Operation,
			format!(
				"spread_{}",
				extract_graphql_name(child, source).unwrap_or_else(|| "anonymous".to_string())
			),
			source,
			None,
		)),
		"inline_fragment" => Some(make_container_chunk_from(
			node,
			child,
			ChunkKind::InlineFragment,
			None,
			source,
			recurse_into(child, ChunkContext::FunctionBody, &[], &["selection_set"]),
		)),
		_ => None,
	}
}

fn classify_graphql_input_value<'t>(node: Node<'t>, source: &str) -> RawChunkCandidate<'t> {
	let name = extract_graphql_name(node, source).unwrap_or_else(|| "anonymous".to_string());
	match node.parent().map(|parent| parent.kind()) {
		Some("input_fields_definition") => {
			make_kind_chunk(node, ChunkKind::Field, Some(name), source, None)
		},
		_ => make_kind_chunk(node, ChunkKind::Arg, Some(name), source, None),
	}
}

fn make_named_graphql_chunk<'t>(
	node: Node<'t>,
	kind: ChunkKind,
	identifier: impl Into<Option<String>>,
	source: &str,
	recurse: Option<RecurseSpec<'t>>,
) -> RawChunkCandidate<'t> {
	make_candidate(
		node,
		kind,
		identifier,
		NameStyle::Named,
		signature_for_node(node, source),
		recurse,
		source,
	)
}

fn make_named_graphql_chunk_from<'t>(
	range_node: Node<'t>,
	signature_node: Node<'t>,
	kind: ChunkKind,
	identifier: impl Into<Option<String>>,
	source: &str,
	recurse: Option<RecurseSpec<'t>>,
) -> RawChunkCandidate<'t> {
	make_candidate(
		range_node,
		kind,
		identifier,
		NameStyle::Named,
		signature_for_node(signature_node, source),
		recurse,
		source,
	)
}

fn extract_graphql_name(node: Node<'_>, source: &str) -> Option<String> {
	find_graphql_name_node(node)
		.and_then(|name| sanitize_identifier(node_text(source, name.start_byte(), name.end_byte())))
}

fn find_graphql_name_node(node: Node<'_>) -> Option<Node<'_>> {
	match node.kind() {
		"name" | "fragment_name" => Some(node),
		_ => named_children(node)
			.into_iter()
			.find_map(find_graphql_name_node),
	}
}

fn extract_graphql_operation_type(node: Node<'_>, source: &str) -> Option<String> {
	child_by_kind(node, &["operation_type"])
		.and_then(|kind| sanitize_identifier(node_text(source, kind.start_byte(), kind.end_byte())))
}

fn extract_graphql_operation_chunk_name(node: Node<'_>, source: &str) -> String {
	let operation =
		extract_graphql_operation_type(node, source).unwrap_or_else(|| "operation".to_string());
	match extract_graphql_name(node, source) {
		Some(name) => format!("{operation}_{name}"),
		None => operation,
	}
}

fn first_named_child(node: Node<'_>) -> Option<Node<'_>> {
	(0..node.named_child_count()).find_map(|index| node.named_child(index))
}
