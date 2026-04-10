//! Language-specific chunk classifier for Perl.

use tree_sitter::Node;

use super::{
	classify::{
		ClassifierTables, LangClassifier, NamingMode, RecurseMode, RuleStyle, StructuralOverrides,
		semantic_rule,
	},
	common::*,
	kind::ChunkKind,
};

pub struct PerlClassifier;

const PERL_SHARED_RULES: &[super::classify::SemanticRule] = &[
	semantic_rule(
		"use_statement",
		ChunkKind::Imports,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"conditional_statement",
		ChunkKind::If,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"for_statement",
		ChunkKind::Loop,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"loop_statement",
		ChunkKind::Loop,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
];

const PERL_TABLES: ClassifierTables = ClassifierTables {
	root:                 PERL_SHARED_RULES,
	class:                &[],
	function:             PERL_SHARED_RULES,
	structural_overrides: StructuralOverrides {
		extra_trivia:            &[],
		preserved_trivia:        &[],
		extra_root_wrappers:     &["statement_list"],
		preserved_root_wrappers: &[],
		absorbable_attrs:        &[],
	},
};

impl LangClassifier for PerlClassifier {
	fn tables(&self) -> &'static ClassifierTables {
		&PERL_TABLES
	}

	fn classify_override<'t>(
		&self,
		context: ChunkContext,
		node: Node<'t>,
		source: &str,
	) -> Option<RawChunkCandidate<'t>> {
		match context {
			ChunkContext::Root | ChunkContext::FunctionBody => classify_perl_node(node, source),
			ChunkContext::ClassBody => None,
		}
	}
}

fn classify_perl_node<'t>(node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
	let body_recurse = || recurse_into(node, ChunkContext::FunctionBody, &["body"], &["block"]);

	Some(match node.kind() {
		"package_statement" => {
			make_kind_chunk(node, ChunkKind::Module, Some(perl_name(node, source)?), source, None)
		},
		"subroutine_declaration_statement" => make_kind_chunk(
			node,
			ChunkKind::Function,
			Some(perl_name(node, source)?),
			source,
			body_recurse(),
		),
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
