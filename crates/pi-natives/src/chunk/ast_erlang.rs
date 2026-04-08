//! Language-specific chunk classifier for Erlang.

use tree_sitter::Node;

use super::{classify::LangClassifier, common::*, kind::ChunkKind};

pub struct ErlangClassifier;

fn find_named_descendant_by_kind<'t>(node: Node<'t>, kinds: &[&str]) -> Option<Node<'t>> {
	if kinds.iter().any(|kind| node.kind() == *kind) {
		return Some(node);
	}

	for child in named_children(node) {
		if let Some(found) = find_named_descendant_by_kind(child, kinds) {
			return Some(found);
		}
	}

	None
}

fn named_text(node: Node<'_>, source: &str) -> Option<String> {
	sanitize_identifier(node_text(source, node.start_byte(), node.end_byte()))
}

fn erlang_name(node: Node<'_>, source: &str) -> Option<String> {
	let name_node = match node.kind() {
		"module_attribute" | "record_decl" | "record_field" => {
			child_by_field_or_kind(node, &["name"], &["atom"])
		},
		"type_alias" => node
			.child_by_field_name("name")
			.and_then(|name| find_named_descendant_by_kind(name, &["atom"])),
		"spec" => child_by_field_or_kind(node, &["fun"], &["atom"]),
		"pp_define" => node
			.child_by_field_name("lhs")
			.and_then(|lhs| find_named_descendant_by_kind(lhs, &["var"])),
		"fun_decl" => node
			.child_by_field_name("clause")
			.and_then(|clause| child_by_field_or_kind(clause, &["name"], &["atom"])),
		"function_clause" => child_by_field_or_kind(node, &["name"], &["atom"]),
		_ => child_by_kind(node, &["atom", "var"]),
	}?;

	named_text(name_node, source)
}

fn recurse_clause_body(node: Node<'_>) -> Option<RecurseSpec<'_>> {
	recurse_into(node, ChunkContext::FunctionBody, &["body"], &["clause_body"])
}

impl LangClassifier for ErlangClassifier {
	fn classify_root<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		Some(match node.kind() {
			"module_attribute" => {
				make_kind_chunk(node, ChunkKind::Module, erlang_name(node, source), source, None)
			},
			"export_attribute" | "export_type_attribute" => {
				group_candidate(node, ChunkKind::Exports, source)
			},
			"import_attribute" => group_candidate(node, ChunkKind::Imports, source),
			"pp_include" | "pp_include_lib" => group_candidate(node, ChunkKind::Includes, source),
			"pp_define" => {
				make_kind_chunk(node, ChunkKind::Macro, erlang_name(node, source), source, None)
			},
			"record_decl" => make_candidate(
				node,
				ChunkKind::Struct,
				format!("record_{}", erlang_name(node, source)?),
				NameStyle::Named,
				signature_for_node(node, source),
				Some(recurse_self(node, ChunkContext::ClassBody)),
				source,
			),
			"type_alias" => {
				make_kind_chunk(node, ChunkKind::Type, erlang_name(node, source), source, None)
			},
			// The Erlang grammar exposes each top-level clause as its own `fun_decl`.
			// Keep that shape instead of inventing a synthetic merged function node.
			"fun_decl" => make_kind_chunk(
				node,
				ChunkKind::Function,
				erlang_name(node, source),
				source,
				Some(recurse_self(node, ChunkContext::FunctionBody)),
			),
			"spec" => return None,
			_ => return None,
		})
	}

	fn classify_class<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		Some(match node.kind() {
			"record_field" => {
				make_kind_chunk(node, ChunkKind::Field, erlang_name(node, source), source, None)
			},
			_ => return None,
		})
	}

	fn classify_function<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		Some(match node.kind() {
			"function_clause" => make_kind_chunk(
				node,
				ChunkKind::Clause,
				erlang_name(node, source),
				source,
				recurse_clause_body(node),
			),
			"fun_clause" | "cr_clause" => make_candidate(
				node,
				ChunkKind::Clause,
				None,
				NameStyle::Named,
				signature_for_node(node, source),
				recurse_clause_body(node),
				source,
			),
			"receive_after" => make_candidate(
				node,
				ChunkKind::After,
				None,
				NameStyle::Named,
				signature_for_node(node, source),
				recurse_clause_body(node),
				source,
			),
			"catch_clause" => make_candidate(
				node,
				ChunkKind::Catch,
				None,
				NameStyle::Named,
				signature_for_node(node, source),
				recurse_clause_body(node),
				source,
			),
			"receive_expr" => make_candidate(
				node,
				ChunkKind::Receive,
				None,
				NameStyle::Named,
				signature_for_node(node, source),
				Some(recurse_self(node, ChunkContext::FunctionBody)),
				source,
			),
			"case_expr" => make_candidate(
				node,
				ChunkKind::Case,
				None,
				NameStyle::Named,
				signature_for_node(node, source),
				Some(recurse_self(node, ChunkContext::FunctionBody)),
				source,
			),
			"try_expr" => make_candidate(
				node,
				ChunkKind::Try,
				None,
				NameStyle::Named,
				signature_for_node(node, source),
				Some(recurse_self(node, ChunkContext::FunctionBody)),
				source,
			),
			"anonymous_fun" => make_kind_chunk(
				node,
				ChunkKind::Function,
				Some("anonymous".to_string()),
				source,
				Some(recurse_self(node, ChunkContext::FunctionBody)),
			),
			_ => return None,
		})
	}

	fn is_absorbable_attr(&self, kind: &str) -> bool {
		kind == "spec"
	}
}
