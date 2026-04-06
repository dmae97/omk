//! Language-specific chunk classifiers for Python and Starlark.

use tree_sitter::Node;

use super::{classify::LangClassifier, common::*};

pub struct PythonClassifier;

impl LangClassifier for PythonClassifier {
	fn classify_root<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		match node.kind() {
			// ── Imports ──
			"import_statement" | "import_from_statement" => {
				Some(group_candidate(node, "imports", source))
			},

			// ── Variables / assignments ──
			"assignment" => Some(group_candidate(node, "decls", source)),

			// ── Functions ──
			"function_definition" => Some(make_named_chunk(
				node,
				prefixed_name("fn", node, source),
				source,
				recurse_into(node, ChunkContext::FunctionBody, &["body"], &["block"]),
			)),

			// ── Containers ──
			"class_definition" => Some(make_container_chunk(
				node,
				prefixed_name("class", node, source),
				source,
				recurse_into(node, ChunkContext::ClassBody, &["body"], &["block"]),
			)),

			// ── Control flow (top-level scripts) ──
			"if_statement" | "for_statement" | "while_statement" | "try_statement"
			| "with_statement" => Some(classify_function_python(node, source)),

			// ── Statements ──
			"expression_statement" | "global_statement" => {
				Some(group_candidate(node, "stmts", source))
			},

			// ── Decorated ──
			"decorated_definition" => Some(classify_decorated(node, source)),

			_ => None,
		}
	}

	fn classify_class<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		match node.kind() {
			// ── Methods ──
			"function_definition" => {
				let name = extract_identifier(node, source).unwrap_or_else(|| "anonymous".to_string());
				let chunk_name = if name == "__init__" || name == "__new__" {
					"constructor".to_string()
				} else {
					format!("fn_{name}")
				};
				Some(make_named_chunk(
					node,
					chunk_name,
					source,
					recurse_into(node, ChunkContext::FunctionBody, &["body"], &["block"]),
				))
			},

			// ── Decorated methods ──
			"decorated_definition" => {
				let inner = named_children(node)
					.into_iter()
					.find(|c| c.kind() == "function_definition");
				if let Some(child) = inner {
					let name =
						extract_identifier(child, source).unwrap_or_else(|| "anonymous".to_string());
					let chunk_name = if name == "__init__" || name == "__new__" {
						"constructor".to_string()
					} else {
						format!("fn_{name}")
					};
					Some(make_named_chunk(
						node,
						chunk_name,
						source,
						recurse_into(child, ChunkContext::FunctionBody, &["body"], &["block"]),
					))
				} else {
					Some(infer_named_candidate(node, source))
				}
			},

			// ── Fields ──
			"expression_statement" | "assignment" => Some(group_candidate(node, "fields", source)),

			// ── Type aliases ──
			"type_alias_statement" => Some(named_candidate(node, "type", source, None)),

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
			"for_statement" | "while_statement" => Some(make_candidate(
				node,
				"loop".to_string(),
				NameStyle::Named,
				None,
				recurse_body(node, ChunkContext::FunctionBody),
				false,
				source,
			)),
			"try_statement" => Some(make_candidate(
				node,
				"try".to_string(),
				NameStyle::Named,
				None,
				recurse_body(node, ChunkContext::FunctionBody),
				false,
				source,
			)),
			"with_statement" => Some(make_candidate(
				node,
				"block".to_string(),
				NameStyle::Named,
				None,
				recurse_body(node, ChunkContext::FunctionBody),
				false,
				source,
			)),

			// ── Positional ──
			"elif_clause" => Some(positional_candidate(node, "elif", source)),
			"except_clause" => Some(positional_candidate(node, "except", source)),
			"match_statement" => Some(positional_candidate(node, "match", source)),

			// ── Variables ──
			"expression_statement" | "assignment" => Some(group_candidate(node, "stmts", source)),

			_ => None,
		}
	}
}

/// Classify Python function-level nodes (reused for top-level control flow
/// delegation).
fn classify_function_python<'t>(node: Node<'t>, source: &str) -> RawChunkCandidate<'t> {
	let fn_recurse = || recurse_body(node, ChunkContext::FunctionBody);
	match node.kind() {
		"if_statement" => {
			make_candidate(node, "if".to_string(), NameStyle::Named, None, fn_recurse(), false, source)
		},
		"for_statement" | "while_statement" => make_candidate(
			node,
			"loop".to_string(),
			NameStyle::Named,
			None,
			fn_recurse(),
			false,
			source,
		),
		"try_statement" => make_candidate(
			node,
			"try".to_string(),
			NameStyle::Named,
			None,
			fn_recurse(),
			false,
			source,
		),
		"with_statement" => make_candidate(
			node,
			"block".to_string(),
			NameStyle::Named,
			None,
			fn_recurse(),
			false,
			source,
		),
		_ => group_candidate(node, "stmts", source),
	}
}

fn classify_decorated<'t>(node: Node<'t>, source: &str) -> RawChunkCandidate<'t> {
	let inner = named_children(node)
		.into_iter()
		.find(|c| c.kind() == "class_definition" || c.kind() == "function_definition");
	match inner {
		Some(child) if child.kind() == "class_definition" => make_container_chunk(
			node,
			prefixed_name("class", child, source),
			source,
			recurse_into(child, ChunkContext::ClassBody, &["body"], &["block"]),
		),
		Some(child) if child.kind() == "function_definition" => make_named_chunk(
			node,
			prefixed_name("fn", child, source),
			source,
			recurse_into(child, ChunkContext::FunctionBody, &["body"], &["block"]),
		),
		_ => positional_candidate(node, "block", source),
	}
}
