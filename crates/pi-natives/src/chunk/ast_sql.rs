//! SQL-specific chunk classifier.

use tree_sitter::Node;

use super::{
	classify::{ClassifierTables, LangClassifier, StructuralOverrides},
	common::*,
	kind::ChunkKind,
};

pub struct SqlClassifier;

impl LangClassifier for SqlClassifier {
	fn tables(&self) -> &'static ClassifierTables {
		static TABLES: ClassifierTables = ClassifierTables {
			root:                 &[],
			class:                &[],
			function:             &[],
			structural_overrides: StructuralOverrides {
				extra_trivia:            &["empty_statement", "dollar_quote", "keyword_from"],
				preserved_trivia:        &[],
				extra_root_wrappers:     &[],
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
			ChunkContext::Root => classify_sql_root(node, source),
			ChunkContext::ClassBody => classify_sql_class(node, source),
			ChunkContext::FunctionBody => classify_sql_function(node, source),
		}
	}
}

fn classify_sql_root<'t>(node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
	if node.kind() == "statement" {
		return classify_sql_statement_root(node, source);
	}

	classify_sql_root_node(node, node, source).or_else(|| classify_sql_query_node(node, source))
}

fn classify_sql_statement_root<'t>(node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
	let children = named_children(node);
	if children.len() == 1 {
		return classify_sql_root_node(node, children[0], source)
			.or_else(|| classify_sql_query_node(children[0], source));
	}

	if children.iter().any(|child| is_sql_query_kind(child.kind())) {
		return Some(make_named_sql_chunk(
			node,
			ChunkKind::Query,
			None,
			source,
			Some(recurse_self(node, ChunkContext::FunctionBody)),
		));
	}

	None
}

fn classify_sql_root_node<'t>(
	range_node: Node<'t>,
	node: Node<'t>,
	source: &str,
) -> Option<RawChunkCandidate<'t>> {
	Some(match node.kind() {
		"create_schema" => make_kind_chunk_from(
			range_node,
			node,
			ChunkKind::Schema,
			extract_sql_identifier(node, source),
			source,
			None,
		),
		"create_table" => make_container_chunk_from(
			range_node,
			node,
			ChunkKind::Table,
			extract_sql_object_name(node, source),
			source,
			recurse_into(node, ChunkContext::ClassBody, &[], &["column_definitions"]),
		),
		"create_view" => make_named_sql_chunk_from(
			range_node,
			node,
			ChunkKind::Query,
			format!(
				"view_{}",
				extract_sql_object_name(node, source).unwrap_or_else(|| "anonymous".to_string())
			),
			source,
			recurse_into(node, ChunkContext::FunctionBody, &[], &["create_query"]),
		),
		"create_materialized_view" => make_named_sql_chunk_from(
			range_node,
			node,
			ChunkKind::Query,
			format!(
				"matview_{}",
				extract_sql_object_name(node, source).unwrap_or_else(|| "anonymous".to_string())
			),
			source,
			recurse_into(node, ChunkContext::FunctionBody, &[], &["create_query"]),
		),
		"create_function" => make_container_chunk_from(
			range_node,
			node,
			ChunkKind::Function,
			extract_sql_object_name(node, source),
			source,
			recurse_sql_function_query(node),
		),
		"create_trigger" => make_named_sql_chunk_from(
			range_node,
			node,
			ChunkKind::Function,
			format!(
				"trigger_{}",
				extract_sql_object_name(node, source).unwrap_or_else(|| "anonymous".to_string())
			),
			source,
			None,
		),
		"create_index" => make_named_sql_chunk_from(
			range_node,
			node,
			ChunkKind::Key,
			format!(
				"index_{}",
				extract_sql_identifier(node, source).unwrap_or_else(|| "anonymous".to_string())
			),
			source,
			None,
		),
		_ => return None,
	})
}

fn classify_sql_class<'t>(node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
	Some(match node.kind() {
		"column_definition" => {
			make_kind_chunk(node, ChunkKind::Field, extract_sql_identifier(node, source), source, None)
		},
		_ => return None,
	})
}

fn classify_sql_function<'t>(node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
	if node.kind() == "statement" {
		return Some(make_named_sql_chunk(
			node,
			ChunkKind::Query,
			None,
			source,
			Some(recurse_self(node, ChunkContext::FunctionBody)),
		));
	}

	classify_sql_query_node(node, source)
}

fn classify_sql_query_node<'t>(node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
	Some(match node.kind() {
		"insert" => group_candidate(node, ChunkKind::Statements, source),
		"keyword_with" => group_candidate(node, ChunkKind::With, source),
		"cte" => make_named_sql_chunk(
			node,
			ChunkKind::With,
			format!(
				"cte_{}",
				extract_sql_identifier(node, source).unwrap_or_else(|| "anonymous".to_string())
			),
			source,
			recurse_into(node, ChunkContext::FunctionBody, &[], &["statement"]),
		),
		"select" => positional_candidate(node, ChunkKind::Select, source),
		"from" => make_named_sql_chunk(
			node,
			ChunkKind::Query,
			"from".to_string(),
			source,
			Some(recurse_self(node, ChunkContext::FunctionBody)),
		),
		"relation" => group_candidate(node, ChunkKind::Relations, source),
		"join" => positional_candidate(node, ChunkKind::Join, source),
		"where" => positional_candidate(node, ChunkKind::Where, source),
		"group_by" => positional_candidate(node, ChunkKind::GroupBy, source),
		"order_by" => positional_candidate(node, ChunkKind::OrderBy, source),
		_ => return None,
	})
}

fn make_named_sql_chunk<'t>(
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

fn make_named_sql_chunk_from<'t>(
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

fn recurse_sql_function_query(node: Node<'_>) -> Option<RecurseSpec<'_>> {
	let body = child_by_kind(node, &["function_body"])?;
	recurse_into(body, ChunkContext::FunctionBody, &[], &["statement"])
}

fn is_sql_query_kind(kind: &str) -> bool {
	matches!(
		kind,
		"insert"
			| "keyword_with"
			| "cte"
			| "select"
			| "from"
			| "where"
			| "group_by"
			| "order_by"
			| "join"
	)
}

fn extract_sql_identifier(node: Node<'_>, source: &str) -> Option<String> {
	child_by_kind(node, &["identifier"])
		.and_then(|name| sanitize_identifier(node_text(source, name.start_byte(), name.end_byte())))
}

fn extract_sql_object_name(node: Node<'_>, source: &str) -> Option<String> {
	child_by_kind(node, &["object_reference"]).and_then(|name| last_identifier(name, source))
}

fn last_identifier(node: Node<'_>, source: &str) -> Option<String> {
	if node.kind() == "identifier" {
		return sanitize_identifier(node_text(source, node.start_byte(), node.end_byte()));
	}

	for child in named_children(node).into_iter().rev() {
		if let Some(identifier) = last_identifier(child, source) {
			return Some(identifier);
		}
	}

	None
}
