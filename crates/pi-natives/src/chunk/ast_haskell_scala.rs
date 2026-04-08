//! Language-specific chunk classifiers for Haskell and Scala.

use tree_sitter::Node;

use super::{classify::LangClassifier, common::*, kind::ChunkKind};

pub struct HaskellScalaClassifier;

impl LangClassifier for HaskellScalaClassifier {
	fn classify_root<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		Some(match node.kind() {
			// ── Imports / packages ──
			"import_declaration" => group_candidate(node, ChunkKind::Imports, source),
			"package_declaration" => group_candidate(node, ChunkKind::Imports, source),

			// ── Haskell module ──
			"module" => container_candidate(node, ChunkKind::Module, source, recurse_class(node)),

			// ── Functions ──
			"function_declaration" => named_candidate(
				node,
				ChunkKind::Function,
				source,
				recurse_body(node, ChunkContext::FunctionBody),
			),
			"function_definition" => named_candidate(
				node,
				ChunkKind::Function,
				source,
				recurse_body(node, ChunkContext::FunctionBody),
			),

			// ── Containers (Scala) ──
			"class_definition" => {
				container_candidate(node, ChunkKind::Class, source, recurse_class(node))
			},
			"object_definition" => {
				container_candidate(node, ChunkKind::Module, source, recurse_class(node))
			},
			"trait_definition" => {
				container_candidate(node, ChunkKind::Iface, source, recurse_interface(node))
			},

			// ── Types ──
			"type_alias_declaration" | "type_item" => {
				named_candidate(node, ChunkKind::Type, source, recurse_class(node))
			},

			// ── Variables / assignments ──
			"variable_declaration" | "assignment" => {
				group_candidate(node, ChunkKind::Declarations, source)
			},

			// ── Statements ──
			"expression_statement" => group_candidate(node, ChunkKind::Statements, source),

			_ => return None,
		})
	}

	fn classify_class<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		Some(match node.kind() {
			// ── Methods ──
			"function_declaration" | "function_definition" | "method_definition" => {
				let name = extract_identifier(node, source).unwrap_or_else(|| "anonymous".to_string());
				if name == "constructor" {
					make_kind_chunk(
						node,
						ChunkKind::Constructor,
						None,
						source,
						recurse_body(node, ChunkContext::FunctionBody),
					)
				} else {
					make_kind_chunk(
						node,
						ChunkKind::Function,
						Some(name),
						source,
						recurse_body(node, ChunkContext::FunctionBody),
					)
				}
			},

			// ── Fields ──
			"variable_declaration" | "property_declaration" => {
				match extract_identifier(node, source) {
					Some(name) => make_kind_chunk(node, ChunkKind::Field, Some(name), source, None),
					None => group_candidate(node, ChunkKind::Fields, source),
				}
			},

			_ => return None,
		})
	}

	fn classify_function<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		let fn_recurse = || recurse_body(node, ChunkContext::FunctionBody);
		Some(match node.kind() {
			// ── Control flow ──
			"if_statement" => {
				make_candidate(node, ChunkKind::If, None, NameStyle::Named, None, fn_recurse(), source)
			},
			"match_expression" => make_candidate(
				node,
				ChunkKind::Match,
				None,
				NameStyle::Named,
				None,
				fn_recurse(),
				source,
			),
			"for_expression" | "while_expression" => make_candidate(
				node,
				ChunkKind::Loop,
				None,
				NameStyle::Named,
				None,
				fn_recurse(),
				source,
			),

			// ── Blocks ──
			"block_expression" => make_candidate(
				node,
				ChunkKind::Block,
				None,
				NameStyle::Named,
				None,
				fn_recurse(),
				source,
			),

			_ => return None,
		})
	}
}
