//! Language-specific chunk classifiers for Haskell and Scala.

use tree_sitter::Node;

use super::{
	classify::{
		ClassifierTables, LangClassifier, NamingMode, RecurseMode, RuleStyle, semantic_rule,
	},
	common::*,
	kind::ChunkKind,
};

pub struct HaskellScalaClassifier;

const HASKELL_SCALA_ROOT_RULES: &[super::classify::SemanticRule] = &[
	semantic_rule(
		"import_declaration",
		ChunkKind::Imports,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"package_declaration",
		ChunkKind::Imports,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"module",
		ChunkKind::Module,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::ClassBody),
	),
	semantic_rule(
		"function_declaration",
		ChunkKind::Function,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"function_definition",
		ChunkKind::Function,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"class_definition",
		ChunkKind::Class,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::ClassBody),
	),
	semantic_rule(
		"object_definition",
		ChunkKind::Module,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::ClassBody),
	),
	semantic_rule(
		"trait_definition",
		ChunkKind::Iface,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::ClassBody),
	),
	semantic_rule(
		"type_alias_declaration",
		ChunkKind::Type,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::ClassBody),
	),
	semantic_rule(
		"type_item",
		ChunkKind::Type,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::ClassBody),
	),
	semantic_rule(
		"variable_declaration",
		ChunkKind::Declarations,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"assignment",
		ChunkKind::Declarations,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"expression_statement",
		ChunkKind::Statements,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
];

const HASKELL_SCALA_FUNCTION_RULES: &[super::classify::SemanticRule] = &[
	semantic_rule(
		"if_statement",
		ChunkKind::If,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"match_expression",
		ChunkKind::Match,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"for_expression",
		ChunkKind::Loop,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"while_expression",
		ChunkKind::Loop,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"block_expression",
		ChunkKind::Block,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
];

const HASKELL_SCALA_TABLES: ClassifierTables = ClassifierTables {
	root:                 HASKELL_SCALA_ROOT_RULES,
	class:                &[],
	function:             HASKELL_SCALA_FUNCTION_RULES,
	structural_overrides: super::classify::StructuralOverrides::EMPTY,
};

impl LangClassifier for HaskellScalaClassifier {
	fn tables(&self) -> &'static ClassifierTables {
		&HASKELL_SCALA_TABLES
	}

	fn classify_override<'t>(
		&self,
		context: ChunkContext,
		node: Node<'t>,
		source: &str,
	) -> Option<RawChunkCandidate<'t>> {
		if context != ChunkContext::ClassBody {
			return None;
		}

		match node.kind() {
			"function_declaration" | "function_definition" | "method_definition" => {
				let name = extract_identifier(node, source).unwrap_or_else(|| "anonymous".to_string());
				let kind = if name == "constructor" {
					ChunkKind::Constructor
				} else {
					ChunkKind::Function
				};
				let identifier = (kind != ChunkKind::Constructor).then_some(name);
				Some(make_kind_chunk(
					node,
					kind,
					identifier,
					source,
					resolve_recurse(node, ChunkContext::FunctionBody),
				))
			},
			"variable_declaration" | "property_declaration" => {
				Some(extract_identifier(node, source).map_or_else(
					|| group_candidate(node, ChunkKind::Fields, source),
					|name| make_kind_chunk(node, ChunkKind::Field, Some(name), source, None),
				))
			},
			_ => None,
		}
	}
}
