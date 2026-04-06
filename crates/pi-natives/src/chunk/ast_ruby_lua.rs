//! Language-specific chunk classifiers for Ruby and Lua.

use tree_sitter::Node;

use super::{classify::LangClassifier, common::*};

pub struct RubyLuaClassifier;

impl LangClassifier for RubyLuaClassifier {
	fn preserve_root_wrapper(&self, kind: &str) -> bool {
		kind == "module"
	}

	fn classify_root<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		Some(match node.kind() {
			// ── Imports ──
			"command" | "call" => {
				// Ruby `require`/`require_relative` appear as call/command nodes.
				// Check if the target is an import keyword.
				let target = extract_identifier(node, source);
				match target.as_deref() {
					Some("require" | "require_relative" | "load" | "autoload") => {
						group_candidate(node, "imports", source)
					},
					_ => group_candidate(node, "stmts", source),
				}
			},

			// ── Functions ──
			"function_definition" => {
				named_candidate(node, "fn", source, recurse_body(node, ChunkContext::FunctionBody))
			},
			"method" | "singleton_method" => {
				named_candidate(node, "fn", source, recurse_body(node, ChunkContext::FunctionBody))
			},

			// ── Containers ──
			"class" => container_candidate(node, "class", source, recurse_class(node)),
			"module" => container_candidate(node, "mod", source, recurse_class(node)),

			// ── Control flow (top-level scripts) ──
			"if_statement" | "unless" | "while_statement" | "for_statement" => {
				return Some(
					self
						.classify_function(node, source)
						.unwrap_or_else(|| group_candidate(node, "stmts", source)),
				);
			},

			// ── Assignments ──
			"assignment" => group_candidate(node, "decls", source),

			// ── Statements ──
			"expression_statement" | "function_call" => group_candidate(node, "stmts", source),

			_ => return None,
		})
	}

	fn classify_class<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		Some(match node.kind() {
			// ── Methods ──
			"method" | "singleton_method" => {
				let name = extract_identifier(node, source).unwrap_or_else(|| "anonymous".to_string());
				if name == "initialize" {
					make_named_chunk(
						node,
						"constructor".to_string(),
						source,
						recurse_body(node, ChunkContext::FunctionBody),
					)
				} else {
					make_named_chunk(
						node,
						format!("fn_{name}"),
						source,
						recurse_body(node, ChunkContext::FunctionBody),
					)
				}
			},

			// ── Nested containers ──
			"class" => container_candidate(node, "class", source, recurse_class(node)),
			"module" => container_candidate(node, "mod", source, recurse_class(node)),

			// ── Fields / constants ──
			"assignment" => group_candidate(node, "fields", source),

			// ── Calls (include, attr_reader, etc.) and bare identifiers (private) ──
			"call" | "command" | "identifier" => group_candidate(node, "stmts", source),

			_ => return None,
		})
	}

	fn classify_function<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		let fn_recurse = || recurse_body(node, ChunkContext::FunctionBody);
		Some(match node.kind() {
			// ── Control flow ──
			"if_statement" | "unless" => make_candidate(
				node,
				"if".to_string(),
				NameStyle::Named,
				None,
				fn_recurse(),
				false,
				source,
			),
			"case_statement" | "case_match" => make_candidate(
				node,
				"switch".to_string(),
				NameStyle::Named,
				None,
				fn_recurse(),
				false,
				source,
			),
			"while_statement" | "for_statement" => make_candidate(
				node,
				"loop".to_string(),
				NameStyle::Named,
				None,
				fn_recurse(),
				false,
				source,
			),

			// ── Variables ──
			"assignment" => group_candidate(node, "stmts", source),

			_ => return None,
		})
	}
}
