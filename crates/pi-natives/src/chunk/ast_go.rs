//! Language-specific chunk classifier for Go.

use std::collections::HashMap;

use tree_sitter::Node;

use super::{
	classify::LangClassifier, common::*, rename_chunk_subtree, sort_chunk_children_by_position,
	types::ChunkNode,
};

pub struct GoClassifier;

impl LangClassifier for GoClassifier {
	fn classify_root<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		match node.kind() {
			// ── Imports / package ──
			"import_declaration" | "package_clause" => Some(group_candidate(node, "imports", source)),

			// ── Variables ──
			"const_declaration" | "var_declaration" | "short_var_declaration" => {
				Some(match extract_identifier(node, source) {
					Some(name) => make_named_chunk(node, format!("var_{name}"), source, None),
					None => group_candidate(node, "decls", source),
				})
			},

			// ── Functions ──
			"function_declaration" => Some(named_candidate(
				node,
				"fn",
				source,
				recurse_body(node, ChunkContext::FunctionBody),
			)),
			"method_declaration" => Some(named_candidate(
				node,
				"fn",
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
				Some(group_candidate(node, "stmts", source))
			},

			_ => None,
		}
	}

	fn classify_class<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		match node.kind() {
			// ── Methods ──
			"method_spec" => Some(named_candidate(node, "meth", source, None)),

			// ── Fields ──
			"field_declaration" | "embedded_field" => Some(match extract_identifier(node, source) {
				Some(name) => make_named_chunk(node, format!("field_{name}"), source, None),
				None => group_candidate(node, "fields", source),
			}),

			// ── Field / method lists ──
			"field_declaration_list" => Some(group_candidate(node, "fields", source)),
			"method_spec_list" => Some(group_candidate(node, "methods", source)),

			_ => None,
		}
	}

	fn classify_function<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		match node.kind() {
			// ── Control flow ──
			"if_statement" => Some(make_candidate(
				node,
				"if".to_string(),
				NameStyle::Named,
				None,
				recurse_body(node, ChunkContext::FunctionBody),
				false,
				source,
			)),
			"switch_statement" | "expression_switch_statement" | "type_switch_statement" => {
				Some(make_candidate(
					node,
					"switch".to_string(),
					NameStyle::Named,
					None,
					recurse_body(node, ChunkContext::FunctionBody),
					false,
					source,
				))
			},
			"select_statement" => Some(make_candidate(
				node,
				"switch".to_string(),
				NameStyle::Named,
				None,
				recurse_body(node, ChunkContext::FunctionBody),
				false,
				source,
			)),

			// ── Loops ──
			"for_statement" => Some(make_candidate(
				node,
				"for".to_string(),
				NameStyle::Named,
				None,
				recurse_body(node, ChunkContext::FunctionBody),
				false,
				source,
			)),

			// ── Blocks ──
			"go_statement" | "defer_statement" | "send_statement" => {
				Some(group_candidate(node, "stmts", source))
			},

			// ── Variables ──
			"short_var_declaration" | "var_declaration" | "const_declaration" => {
				let span = line_span(node.start_position().row + 1, node.end_position().row + 1);
				Some(if span > 1 {
					if let Some(name) = extract_identifier(node, source) {
						make_named_chunk(node, format!("var_{name}"), source, None)
					} else {
						let kind_name = sanitize_node_kind(node.kind());
						group_candidate(node, &kind_name, source)
					}
				} else {
					let kind_name = sanitize_node_kind(node.kind());
					group_candidate(node, &kind_name, source)
				})
			},

			_ => None,
		}
	}

	fn post_process(
		&self,
		chunks: &mut Vec<ChunkNode>,
		root_children: &mut Vec<String>,
		source: &str,
	) {
		reparent_receiver_methods(chunks, root_children, source);
		reparent_new_type_constructors(chunks, root_children, source);
	}
}

/// Classify Go function-level nodes (reused for top-level control flow
/// delegation).
fn classify_function_go<'t>(node: Node<'t>, source: &str) -> RawChunkCandidate<'t> {
	let fn_recurse = || recurse_body(node, ChunkContext::FunctionBody);
	match node.kind() {
		"if_statement" => {
			make_candidate(node, "if".to_string(), NameStyle::Named, None, fn_recurse(), false, source)
		},
		"switch_statement"
		| "expression_switch_statement"
		| "type_switch_statement"
		| "select_statement" => make_candidate(
			node,
			"switch".to_string(),
			NameStyle::Named,
			None,
			fn_recurse(),
			false,
			source,
		),
		"for_statement" => make_candidate(
			node,
			"for".to_string(),
			NameStyle::Named,
			None,
			fn_recurse(),
			false,
			source,
		),
		_ => group_candidate(node, "stmts", source),
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
				format!("type_{name}"),
				source,
				Some(recurse),
			);
		}
		return make_named_chunk_from(node, spec, format!("type_{name}"), source, None);
	}

	group_candidate(node, "decls", source)
}

/// For a `type_spec`, find a `struct_type` or `interface_type` child and return
/// its body (`field_declaration_list` or `method_spec_list`) as a recurse spec.
fn recurse_type_spec(node: Node<'_>) -> Option<RecurseSpec<'_>> {
	let container = child_by_kind(node, &["struct_type", "interface_type"])?;
	let body = child_by_kind(container, &["field_declaration_list", "method_spec_list"])
		.unwrap_or(container);
	Some(RecurseSpec { node: body, context: ChunkContext::ClassBody })
}

/// Move receiver methods (`fn_X`) under their corresponding `type_Y` chunk.
///
/// For `func (s *Server) Start()`, extracts receiver type `Server` and
/// reparents the method chunk under `type_Server`.
fn reparent_receiver_methods(
	chunks: &mut [ChunkNode],
	root_children: &mut Vec<String>,
	source: &str,
) {
	// Build map: type name -> chunk path for root-level type chunks.
	let type_paths: HashMap<String, String> = chunks
		.iter()
		.filter(|c| c.parent_path.as_deref() == Some("") && c.path.starts_with("type_"))
		.filter_map(|c| {
			c.path
				.strip_prefix("type_")
				.map(|name| (name.to_string(), c.path.clone()))
		})
		.collect();

	// Collect root-level function paths that may be receiver methods.
	let receiver_methods: Vec<String> = root_children
		.iter()
		.filter(|p| p.starts_with("fn_"))
		.cloned()
		.collect();

	for method_path in receiver_methods {
		let Some(method_idx) = chunks.iter().position(|c| c.path == method_path) else {
			continue;
		};
		let Some(receiver_type) = extract_receiver_type_name(&chunks[method_idx], source) else {
			continue;
		};
		let Some(type_path) = type_paths.get(receiver_type.as_str()) else {
			continue;
		};

		let method_name = chunks[method_idx].name.clone();
		let new_path = format!("{type_path}.{method_name}");

		rename_chunk_subtree(chunks, &method_path, &new_path, type_path);
		root_children.retain(|p| p != &method_path);

		if let Some(type_idx) = chunks.iter().position(|c| c.path == *type_path) {
			let type_chunk = &mut chunks[type_idx];
			type_chunk.kind = "branch".to_string();
			if !type_chunk.children.iter().any(|child| child == &new_path) {
				type_chunk.children.push(new_path);
			}
		}
	}

	sort_chunk_children_by_position(chunks);
}

/// Move `func NewTypeName(...)` constructors under `type_TypeName` so tree
/// order matches source order (avoids root-level `fn_NewX` appearing after
/// nested methods with a lower file line).
fn reparent_new_type_constructors(
	chunks: &mut [ChunkNode],
	root_children: &mut Vec<String>,
	_source: &str,
) {
	let type_paths: HashMap<String, String> = chunks
		.iter()
		.filter(|c| c.parent_path.as_deref() == Some("") && c.path.starts_with("type_"))
		.filter_map(|c| {
			c.path
				.strip_prefix("type_")
				.map(|name| (name.to_string(), c.path.clone()))
		})
		.collect();

	let constructors: Vec<String> = root_children
		.iter()
		.filter(|p| {
			p.starts_with("fn_")
				&& constructor_suffix_after_new(p)
					.is_some_and(|tail| type_paths.contains_key(tail.as_str()))
		})
		.cloned()
		.collect();

	for fn_path in constructors {
		let Some(fn_idx) = chunks.iter().position(|c| c.path == fn_path) else {
			continue;
		};
		let Some(tail) = constructor_suffix_after_new(&fn_path) else {
			continue;
		};
		let Some(type_path) = type_paths.get(tail.as_str()) else {
			continue;
		};
		let fn_name = chunks[fn_idx].name.clone();
		let new_path = format!("{type_path}.{fn_name}");

		rename_chunk_subtree(chunks, &fn_path, &new_path, type_path);
		root_children.retain(|p| p != &fn_path);

		if let Some(type_idx) = chunks.iter().position(|c| c.path == *type_path) {
			let type_chunk = &mut chunks[type_idx];
			type_chunk.kind = "branch".to_string();
			if !type_chunk.children.iter().any(|child| child == &new_path) {
				type_chunk.children.push(new_path);
			}
		}
	}

	sort_chunk_children_by_position(chunks);
}

/// `fn_NewServer` + type `Server` -> `Some("Server")`; `fn_Start` -> None.
fn constructor_suffix_after_new(fn_path: &str) -> Option<String> {
	let name = fn_path.strip_prefix("fn_")?;
	let tail = name.strip_prefix("New")?;
	if tail.is_empty() {
		return None;
	}
	Some(tail.to_string())
}

/// Extract the receiver type name from a Go method's header.
///
/// `func (s *Server) Start()` -> `Some("Server")`
/// `func (s Server) Stop()`   -> `Some("Server")`
fn extract_receiver_type_name(chunk: &ChunkNode, source: &str) -> Option<String> {
	let header = normalized_header(source, chunk.start_byte as usize, chunk.end_byte as usize);
	let receiver = header
		.strip_prefix("func")?
		.trim_start()
		.strip_prefix('(')?
		.split(')')
		.next()?
		.trim();
	let receiver_type = receiver.split_whitespace().last()?;
	sanitize_identifier(receiver_type)
}
