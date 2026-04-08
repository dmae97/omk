//! Language-specific chunk classifier for Perl.

use tree_sitter::Node;

use super::{classify::LangClassifier, common::*, kind::ChunkKind};

pub struct PerlClassifier;

impl LangClassifier for PerlClassifier {
	fn classify_root<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		classify_perl_node(node, source)
	}

	fn classify_function<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		classify_perl_node(node, source)
	}

	fn is_root_wrapper(&self, kind: &str) -> bool {
		kind == "statement_list"
	}
}

fn classify_perl_node<'t>(node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
	let body_recurse = || recurse_into(node, ChunkContext::FunctionBody, &["body"], &["block"]);

	Some(match node.kind() {
		"package_statement" => {
			make_kind_chunk(node, ChunkKind::Module, Some(perl_name(node, source)?), source, None)
		},
		"use_statement" => group_candidate(node, ChunkKind::Imports, source),
		"subroutine_declaration_statement" => make_kind_chunk(
			node,
			ChunkKind::Function,
			Some(perl_name(node, source)?),
			source,
			body_recurse(),
		),
		"conditional_statement" => {
			make_candidate(node, ChunkKind::If, None, NameStyle::Named, None, body_recurse(), source)
		},
		"for_statement" | "loop_statement" => {
			make_candidate(node, ChunkKind::Loop, None, NameStyle::Named, None, body_recurse(), source)
		},
		"expression_statement" => classify_perl_statement(node, source),
		_ => return None,
	})
}

fn classify_perl_statement<'t>(node: Node<'t>, source: &str) -> RawChunkCandidate<'t> {
	if perl_declares_variable(node) {
		group_candidate(node, ChunkKind::Declarations, source)
	} else {
		group_candidate(node, ChunkKind::Statements, source)
	}
}

fn perl_declares_variable(node: Node<'_>) -> bool {
	if node.kind() == "variable_declaration" {
		return true;
	}

	if node.kind() == "assignment_expression"
		&& named_children(node)
			.into_iter()
			.any(|child| child.kind() == "variable_declaration")
	{
		return true;
	}

	named_children(node).into_iter().any(perl_declares_variable)
}

fn perl_name(node: Node<'_>, source: &str) -> Option<String> {
	find_named_text(node, source, &["bareword", "package", "varname"]).and_then(sanitize_identifier)
}

fn find_named_text<'a>(node: Node<'_>, source: &'a str, kinds: &[&str]) -> Option<&'a str> {
	if kinds.iter().any(|kind| node.kind() == *kind) {
		return Some(node_text(source, node.start_byte(), node.end_byte()));
	}

	for child in named_children(node) {
		if let Some(text) = find_named_text(child, source, kinds) {
			return Some(text);
		}
	}

	None
}
