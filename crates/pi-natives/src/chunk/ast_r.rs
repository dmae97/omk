//! R-specific chunk classifier.

use tree_sitter::Node;

use super::{
	classify::{ClassifierTables, LangClassifier},
	common::*,
	kind::ChunkKind,
};

pub struct RClassifier;

static R_TABLES: ClassifierTables = ClassifierTables {
	root:                 &[],
	class:                &[],
	function:             &[],
	structural_overrides: super::classify::StructuralOverrides::EMPTY,
};

impl LangClassifier for RClassifier {
	fn tables(&self) -> &'static ClassifierTables {
		&R_TABLES
	}

	fn classify_override<'t>(
		&self,
		context: ChunkContext,
		node: Node<'t>,
		source: &str,
	) -> Option<RawChunkCandidate<'t>> {
		match context {
			ChunkContext::Root => classify_root_custom(node, source),
			ChunkContext::FunctionBody => classify_function_custom(node, source),
			_ => None,
		}
	}
}

fn classify_root_custom<'t>(node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
	Some(match node.kind() {
		// ── Imports ──
		"call" if is_import_call(node, source) => group_candidate(node, ChunkKind::Imports, source),
		"call" => group_candidate(node, ChunkKind::Statements, source),

		// ── Function / value assignments ──
		"binary_operator" => classify_assignment(node, source, ChunkScope::Root)?,

		// ── Control flow at script scope ──
		"if_statement" => control_candidate(node, ChunkKind::If, source, recurse_if(node)),
		"for_statement" | "while_statement" | "repeat_statement" => {
			control_candidate(node, ChunkKind::Loop, source, recurse_loop(node))
		},

		// ── Bare expressions ──
		"identifier" | "subset" | "subset2" | "extract_operator" => {
			group_candidate(node, ChunkKind::Statements, source)
		},

		_ => return None,
	})
}

fn classify_function_custom<'t>(node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
	Some(match node.kind() {
		// ── Local assignments ──
		"binary_operator" => classify_assignment(node, source, ChunkScope::Function)?,

		// ── Control flow ──
		"if_statement" => control_candidate(node, ChunkKind::If, source, recurse_if(node)),
		"for_statement" | "while_statement" | "repeat_statement" => {
			control_candidate(node, ChunkKind::Loop, source, recurse_loop(node))
		},

		// ── Calls / bare expressions ──
		"call" | "identifier" | "subset" | "subset2" | "extract_operator" | "break" | "next"
		| "return" => group_candidate(node, ChunkKind::Statements, source),

		_ => return None,
	})
}

#[derive(Clone, Copy)]
enum ChunkScope {
	Root,
	Function,
}

fn classify_assignment<'t>(
	node: Node<'t>,
	source: &str,
	scope: ChunkScope,
) -> Option<RawChunkCandidate<'t>> {
	let (lhs, rhs) = assignment_sides(node, source)?;

	if rhs.kind() == "function_definition" {
		let name = simple_lhs_name(lhs, source).unwrap_or_else(|| "anonymous".to_string());
		return Some(make_kind_chunk_from(
			node,
			rhs,
			ChunkKind::Function,
			Some(name),
			source,
			recurse_body(rhs, ChunkContext::FunctionBody),
		));
	}

	match (scope, simple_lhs_name(lhs, source)) {
		(ChunkScope::Root, Some(name)) => {
			Some(make_kind_chunk(node, ChunkKind::Variable, Some(name), source, None))
		},
		(ChunkScope::Function, Some(name)) if spans_multiple_lines(node) => {
			Some(make_kind_chunk(node, ChunkKind::Variable, Some(name), source, None))
		},
		_ => Some(group_candidate(
			node,
			match scope {
				ChunkScope::Root => ChunkKind::Declarations,
				ChunkScope::Function => ChunkKind::Statements,
			},
			source,
		)),
	}
}

fn assignment_sides<'t>(node: Node<'t>, source: &str) -> Option<(Node<'t>, Node<'t>)> {
	if node.kind() != "binary_operator" {
		return None;
	}

	let operator = node.child_by_field_name("operator")?;
	let operator_text = node_text(source, operator.start_byte(), operator.end_byte());
	if !matches!(operator_text, "<-" | "<<-" | "=") {
		return None;
	}

	Some((node.child_by_field_name("lhs")?, node.child_by_field_name("rhs")?))
}

fn simple_lhs_name(lhs: Node<'_>, source: &str) -> Option<String> {
	(lhs.kind() == "identifier")
		.then(|| extract_identifier(lhs, source))
		.flatten()
}

fn is_import_call(node: Node<'_>, source: &str) -> bool {
	matches!(
		extract_identifier(node, source).as_deref(),
		Some("library" | "require" | "requireNamespace" | "source")
	)
}

fn recurse_if(node: Node<'_>) -> Option<RecurseSpec<'_>> {
	recurse_into(node, ChunkContext::FunctionBody, &["consequence", "alternative"], &[
		"braced_expression",
	])
}

fn recurse_loop(node: Node<'_>) -> Option<RecurseSpec<'_>> {
	recurse_into(node, ChunkContext::FunctionBody, &["body"], &["braced_expression"])
}

fn control_candidate<'t>(
	node: Node<'t>,
	kind: ChunkKind,
	source: &str,
	recurse: Option<RecurseSpec<'t>>,
) -> RawChunkCandidate<'t> {
	make_candidate(node, kind, None, NameStyle::Named, None, recurse, source)
}

fn spans_multiple_lines(node: Node<'_>) -> bool {
	node.start_position().row != node.end_position().row
}
