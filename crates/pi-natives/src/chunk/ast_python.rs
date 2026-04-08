//! Language-specific chunk classifiers for Python and Starlark.

use tree_sitter::Node;

use super::{classify::LangClassifier, common::*, kind::ChunkKind};

pub struct PythonClassifier;

impl LangClassifier for PythonClassifier {
	fn classify_root<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		match node.kind() {
			// ── Imports ──
			"import_statement" | "import_from_statement" => {
				Some(group_candidate(node, ChunkKind::Imports, source))
			},

			// ── Variables / assignments ──
			"assignment" => Some(group_candidate(node, ChunkKind::Declarations, source)),

			// ── Functions ──
			"function_definition" => Some(make_kind_chunk(
				node,
				ChunkKind::Function,
				extract_identifier(node, source),
				source,
				recurse_into(node, ChunkContext::FunctionBody, &["body"], &["block"]),
			)),

			// ── Containers ──
			"class_definition" => Some(make_container_chunk(
				node,
				ChunkKind::Class,
				extract_identifier(node, source),
				source,
				recurse_into(node, ChunkContext::ClassBody, &["body"], &["block"]),
			)),

			// ── Control flow (top-level scripts) ──
			"if_statement" | "for_statement" | "while_statement" | "try_statement"
			| "with_statement" => Some(classify_function_python(node, source)),

			// ── Statements ──
			"expression_statement" | "global_statement" => {
				Some(group_candidate(node, ChunkKind::Statements, source))
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
				let kind = if name == "__init__" || name == "__new__" {
					ChunkKind::Constructor
				} else {
					ChunkKind::Function
				};
				let identifier = if kind == ChunkKind::Constructor {
					None
				} else {
					Some(name)
				};
				Some(make_kind_chunk(
					node,
					kind,
					identifier,
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
					let kind = if name == "__init__" || name == "__new__" {
						ChunkKind::Constructor
					} else {
						ChunkKind::Function
					};
					let identifier = if kind == ChunkKind::Constructor {
						None
					} else {
						Some(name)
					};
					Some(make_kind_chunk(
						node,
						kind,
						identifier,
						source,
						recurse_into(child, ChunkContext::FunctionBody, &["body"], &["block"]),
					))
				} else {
					Some(infer_named_candidate(node, source))
				}
			},

			// ── Fields ──
			"expression_statement" | "assignment" => {
				Some(group_candidate(node, ChunkKind::Fields, source))
			},

			// ── Type aliases ──
			"type_alias_statement" => Some(named_candidate(node, ChunkKind::Type, source, None)),

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
			"for_statement" | "while_statement" => Some(make_candidate(
				node,
				ChunkKind::Loop,
				None,
				NameStyle::Named,
				None,
				recurse_body(node, ChunkContext::FunctionBody),
				source,
			)),
			"try_statement" => Some(make_candidate(
				node,
				ChunkKind::Try,
				None,
				NameStyle::Named,
				None,
				recurse_body(node, ChunkContext::FunctionBody),
				source,
			)),
			"with_statement" => Some(make_candidate(
				node,
				ChunkKind::Block,
				None,
				NameStyle::Named,
				None,
				recurse_body(node, ChunkContext::FunctionBody),
				source,
			)),

			// ── Positional ──
			"elif_clause" => Some(positional_candidate(node, ChunkKind::Elif, source)),
			"except_clause" => Some(positional_candidate(node, ChunkKind::Except, source)),
			"match_statement" => Some(positional_candidate(node, ChunkKind::Match, source)),

			// ── Variables / simple statements ──
			// Catch `expression_statement`, `assignment`, `return_statement`,
			// `raise_statement`, `pass_statement`, `break_statement`,
			// `continue_statement`, `delete_statement`, `assert_statement`,
			// `nonlocal_statement`, `global_statement`, `type_alias_statement`,
			// and any other leaf statements so they merge into the parent
			// function body instead of becoming standalone addressable chunks.
			_ => Some(group_candidate(node, ChunkKind::Statements, source)),
		}
	}
}

/// Classify Python function-level nodes (reused for top-level control flow
/// delegation).
fn classify_function_python<'t>(node: Node<'t>, source: &str) -> RawChunkCandidate<'t> {
	let fn_recurse = || recurse_body(node, ChunkContext::FunctionBody);
	match node.kind() {
		"if_statement" => {
			make_candidate(node, ChunkKind::If, None, NameStyle::Named, None, fn_recurse(), source)
		},
		"for_statement" | "while_statement" => {
			make_candidate(node, ChunkKind::Loop, None, NameStyle::Named, None, fn_recurse(), source)
		},
		"try_statement" => {
			make_candidate(node, ChunkKind::Try, None, NameStyle::Named, None, fn_recurse(), source)
		},
		"with_statement" => {
			make_candidate(node, ChunkKind::Block, None, NameStyle::Named, None, fn_recurse(), source)
		},
		_ => group_candidate(node, ChunkKind::Statements, source),
	}
}

fn classify_decorated<'t>(node: Node<'t>, source: &str) -> RawChunkCandidate<'t> {
	let inner = named_children(node)
		.into_iter()
		.find(|c| c.kind() == "class_definition" || c.kind() == "function_definition");
	match inner {
		Some(child) if child.kind() == "class_definition" => make_container_chunk(
			node,
			ChunkKind::Class,
			extract_identifier(child, source),
			source,
			recurse_into(child, ChunkContext::ClassBody, &["body"], &["block"]),
		),
		Some(child) if child.kind() == "function_definition" => make_kind_chunk(
			node,
			ChunkKind::Function,
			extract_identifier(child, source),
			source,
			recurse_into(child, ChunkContext::FunctionBody, &["body"], &["block"]),
		),
		_ => positional_candidate(node, ChunkKind::Block, source),
	}
}
