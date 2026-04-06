//! Language-specific chunk classifiers for Haskell and Scala.

use tree_sitter::Node;

use super::{classify::LangClassifier, common::*};

pub struct HaskellScalaClassifier;

impl LangClassifier for HaskellScalaClassifier {
	fn classify_root<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		Some(match node.kind() {
			// ── Imports / packages ──
			"import_declaration" => group_candidate(node, "imports", source),
			"package_declaration" => group_candidate(node, "imports", source),

			// ── Haskell module ──
			"module" => container_candidate(node, "mod", source, recurse_class(node)),

			// ── Functions ──
			"function_declaration" => {
				named_candidate(node, "fn", source, recurse_body(node, ChunkContext::FunctionBody))
			},
			"function_definition" => {
				named_candidate(node, "fn", source, recurse_body(node, ChunkContext::FunctionBody))
			},

			// ── Containers (Scala) ──
			"class_definition" => container_candidate(node, "class", source, recurse_class(node)),
			"object_definition" => container_candidate(node, "mod", source, recurse_class(node)),
			"trait_definition" => container_candidate(node, "iface", source, recurse_interface(node)),

			// ── Types ──
			"type_alias_declaration" | "type_item" => {
				named_candidate(node, "type", source, recurse_class(node))
			},

			// ── Variables / assignments ──
			"variable_declaration" | "assignment" => group_candidate(node, "decls", source),

			// ── Statements ──
			"expression_statement" => group_candidate(node, "stmts", source),

			_ => return None,
		})
	}

	fn classify_class<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		Some(match node.kind() {
			// ── Methods ──
			"function_declaration" | "function_definition" | "method_definition" => {
				let name = extract_identifier(node, source).unwrap_or_else(|| "anonymous".to_string());
				if name == "constructor" {
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

			// ── Fields ──
			"variable_declaration" | "property_declaration" => {
				match extract_identifier(node, source) {
					Some(name) => make_named_chunk(node, format!("field_{name}"), source, None),
					None => group_candidate(node, "fields", source),
				}
			},

			_ => return None,
		})
	}

	fn classify_function<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		let fn_recurse = || recurse_body(node, ChunkContext::FunctionBody);
		Some(match node.kind() {
			// ── Control flow ──
			"if_statement" => make_candidate(
				node,
				"if".to_string(),
				NameStyle::Named,
				None,
				fn_recurse(),
				false,
				source,
			),
			"match_expression" => make_candidate(
				node,
				"match".to_string(),
				NameStyle::Named,
				None,
				fn_recurse(),
				false,
				source,
			),
			"for_expression" | "while_expression" => make_candidate(
				node,
				"loop".to_string(),
				NameStyle::Named,
				None,
				fn_recurse(),
				false,
				source,
			),

			// ── Blocks ──
			"block_expression" => make_candidate(
				node,
				"block".to_string(),
				NameStyle::Named,
				None,
				fn_recurse(),
				false,
				source,
			),

			_ => return None,
		})
	}
}
