use tree_sitter::Node;

use super::{classify::LangClassifier, common::*, kind::ChunkKind};

pub struct GoClassifier;

impl LangClassifier for GoClassifier {
	fn classify_root<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		match node.kind() {
			// ── Imports / package ──
			"import_declaration" | "package_clause" => {
				Some(group_candidate(node, ChunkKind::Imports, source))
			},

			// ── Variables ──
			"const_declaration" | "var_declaration" | "short_var_declaration" => {
				Some(match extract_identifier(node, source) {
					Some(name) => make_kind_chunk(node, ChunkKind::Variable, Some(name), source, None),
					None => group_candidate(node, ChunkKind::Declarations, source),
				})
			},

			// ── Functions ──
			"function_declaration" => Some(named_candidate(
				node,
				ChunkKind::Function,
				source,
				recurse_body(node, ChunkContext::FunctionBody),
			)),
			"method_declaration" => Some(named_candidate(
				node,
				ChunkKind::Function,
				source,
				recurse_body(node, ChunkContext::FunctionBody),
			)),

			// ── Containers ──
			"type_declaration" => Some(classify_type_decl(node, source)),

			// ── Control flow (top-level scripts) ──
			"if_statement"
			| "switch_statement"
			| "expression_switch_statement"
			| "type_switch_statement"
			| "select_statement"
			| "for_statement" => Some(classify_function_go(node, source)),

			// ── Statements ──
			"expression_statement" | "go_statement" | "defer_statement" | "send_statement" => {
				Some(group_candidate(node, ChunkKind::Statements, source))
			},

			_ => None,
		}
	}

	fn classify_class<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		match node.kind() {
			// ── Methods ──
			"method_spec" => Some(named_candidate(node, ChunkKind::Method, source, None)),

			// ── Fields ──
			"field_declaration" | "embedded_field" => Some(match extract_identifier(node, source) {
				Some(name) => make_kind_chunk(node, ChunkKind::Field, Some(name), source, None),
				None => group_candidate(node, ChunkKind::Fields, source),
			}),

			// ── Field / method lists ──
			"field_declaration_list" => Some(group_candidate(node, ChunkKind::Fields, source)),
			"method_spec_list" => Some(group_candidate(node, ChunkKind::Methods, source)),

			_ => None,
		}
	}

	fn classify_function<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		match node.kind() {
			// ── Control flow ──
			"if_statement" => Some(make_candidate(
				node,
				ChunkKind::If,
				None,
				NameStyle::Named,
				None,
				recurse_body(node, ChunkContext::FunctionBody),
				source,
			)),
			"switch_statement" | "expression_switch_statement" | "type_switch_statement" => {
				Some(make_candidate(
					node,
					ChunkKind::Switch,
					None,
					NameStyle::Named,
					None,
					recurse_body(node, ChunkContext::FunctionBody),
					source,
				))
			},
			"select_statement" => Some(make_candidate(
				node,
				ChunkKind::Switch,
				None,
				NameStyle::Named,
				None,
				recurse_body(node, ChunkContext::FunctionBody),
				source,
			)),

			// ── Loops ──
			"for_statement" => Some(make_candidate(
				node,
				ChunkKind::For,
				None,
				NameStyle::Named,
				None,
				recurse_body(node, ChunkContext::FunctionBody),
				source,
			)),

			// ── Blocks ──
			"go_statement" | "defer_statement" | "send_statement" => {
				Some(group_candidate(node, ChunkKind::Statements, source))
			},

			// ── Variables ──
			"short_var_declaration" | "var_declaration" | "const_declaration" => {
				let span = line_span(node.start_position().row + 1, node.end_position().row + 1);
				Some(if span > 1 {
					if let Some(name) = extract_identifier(node, source) {
						make_kind_chunk(node, ChunkKind::Variable, Some(name), source, None)
					} else {
						group_from_sanitized(node, source)
					}
				} else {
					group_from_sanitized(node, source)
				})
			},

			_ => None,
		}
	}
}

/// Classify Go function-level nodes (reused for top-level control flow
/// delegation).
fn classify_function_go<'t>(node: Node<'t>, source: &str) -> RawChunkCandidate<'t> {
	let fn_recurse = || recurse_body(node, ChunkContext::FunctionBody);
	match node.kind() {
		"if_statement" => {
			make_candidate(node, ChunkKind::If, None, NameStyle::Named, None, fn_recurse(), source)
		},
		"switch_statement"
		| "expression_switch_statement"
		| "type_switch_statement"
		| "select_statement" => {
			make_candidate(node, ChunkKind::Switch, None, NameStyle::Named, None, fn_recurse(), source)
		},
		"for_statement" => {
			make_candidate(node, ChunkKind::For, None, NameStyle::Named, None, fn_recurse(), source)
		},
		_ => group_candidate(node, ChunkKind::Statements, source),
	}
}

/// Classify Go `type_declaration` nodes.
///
/// A single `type_spec` with a struct/interface body becomes a container;
/// a single `type_spec` without one becomes a named leaf.
/// Multiple `type_spec` children (type group) become a group.
fn classify_type_decl<'t>(node: Node<'t>, source: &str) -> RawChunkCandidate<'t> {
	let specs: Vec<Node<'t>> = named_children(node)
		.into_iter()
		.filter(|c| c.kind() == "type_spec")
		.collect();

	if specs.len() == 1 {
		let spec = specs[0];
		let name = extract_identifier(spec, source).unwrap_or_else(|| "anonymous".to_string());
		if let Some(recurse) = recurse_type_spec(spec) {
			return make_container_chunk_from(
				node,
				spec,
				ChunkKind::Type,
				Some(name),
				source,
				Some(recurse),
			);
		}
		return make_kind_chunk_from(node, spec, ChunkKind::Type, Some(name), source, None);
	}

	group_candidate(node, ChunkKind::Declarations, source)
}

fn group_from_sanitized<'t>(node: Node<'t>, source: &str) -> RawChunkCandidate<'t> {
	let kind_name = sanitize_node_kind(node.kind());
	let kind = ChunkKind::from_sanitized_kind(kind_name.as_str());
	make_candidate(node, kind, kind_name, NameStyle::Group, None, None, source)
}

/// For a `type_spec`, find a `struct_type` or `interface_type` child and return
/// its body (`field_declaration_list` or `method_spec_list`) as a recurse spec.
fn recurse_type_spec(node: Node<'_>) -> Option<RecurseSpec<'_>> {
	let container = child_by_kind(node, &["struct_type", "interface_type"])?;
	let body = child_by_kind(container, &["field_declaration_list", "method_spec_list"])
		.unwrap_or(container);
	Some(RecurseSpec { node: body, context: ChunkContext::ClassBody })
}
