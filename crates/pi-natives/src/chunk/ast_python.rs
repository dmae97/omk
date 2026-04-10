//! Language-specific chunk classifiers for Python and Starlark.

use tree_sitter::Node;

use super::{
	classify::{
		ClassifierTables, LangClassifier, NamingMode, RecurseMode, RuleStyle, semantic_rule,
	},
	common::*,
	kind::ChunkKind,
};

pub struct PythonClassifier;

const ROOT_RULES: &[super::classify::SemanticRule] = &[
	semantic_rule(
		"import_statement",
		ChunkKind::Imports,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"import_from_statement",
		ChunkKind::Imports,
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
		"if_statement",
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
		"while_statement",
		ChunkKind::Loop,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"try_statement",
		ChunkKind::Try,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"with_statement",
		ChunkKind::Block,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"expression_statement",
		ChunkKind::Statements,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"global_statement",
		ChunkKind::Statements,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
];

const CLASS_RULES: &[super::classify::SemanticRule] = &[
	semantic_rule(
		"expression_statement",
		ChunkKind::Fields,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"assignment",
		ChunkKind::Fields,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"type_alias_statement",
		ChunkKind::Type,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::None,
	),
];

const FUNCTION_RULES: &[super::classify::SemanticRule] = &[
	semantic_rule(
		"if_statement",
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
		"while_statement",
		ChunkKind::Loop,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"try_statement",
		ChunkKind::Try,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"with_statement",
		ChunkKind::Block,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"elif_clause",
		ChunkKind::Elif,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"except_clause",
		ChunkKind::Except,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"match_statement",
		ChunkKind::Match,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::None,
	),
];

const PYTHON_TABLES: ClassifierTables = ClassifierTables {
	root:                 ROOT_RULES,
	class:                CLASS_RULES,
	function:             FUNCTION_RULES,
	structural_overrides: super::classify::StructuralOverrides::EMPTY,
};

impl LangClassifier for PythonClassifier {
	fn tables(&self) -> &'static ClassifierTables {
		&PYTHON_TABLES
	}

	fn classify_override<'t>(
		&self,
		context: ChunkContext,
		node: Node<'t>,
		source: &str,
	) -> Option<RawChunkCandidate<'t>> {
		match context {
			ChunkContext::Root | ChunkContext::ClassBody if node.kind() == "decorated_definition" => {
				Some(classify_decorated(node, source, context))
			},
			ChunkContext::ClassBody if node.kind() == "function_definition" => {
				Some(classify_class_method(node, source))
			},
			_ => None,
		}
	}

	fn classify_function<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		let _ = source;
		Some(group_candidate(node, ChunkKind::Statements, source))
	}
}

fn classify_class_method<'t>(node: Node<'t>, source: &str) -> RawChunkCandidate<'t> {
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
	make_kind_chunk(
		node,
		kind,
		identifier,
		source,
		resolve_recurse(node, ChunkContext::FunctionBody),
	)
}

fn classify_decorated<'t>(
	node: Node<'t>,
	source: &str,
	context: ChunkContext,
) -> RawChunkCandidate<'t> {
	let inner = named_children(node)
		.into_iter()
		.find(|c| matches!(c.kind(), "class_definition" | "function_definition"));
	match inner {
		Some(child) if child.kind() == "class_definition" => make_container_chunk(
			node,
			ChunkKind::Class,
			extract_identifier(child, source),
			source,
			resolve_recurse(child, ChunkContext::ClassBody),
		),
		Some(child)
			if child.kind() == "function_definition" && context == ChunkContext::ClassBody =>
		{
			let name = extract_identifier(child, source).unwrap_or_else(|| "anonymous".to_string());
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
			make_kind_chunk(
				node,
				kind,
				identifier,
				source,
				resolve_recurse(child, ChunkContext::FunctionBody),
			)
		},
		Some(child) if child.kind() == "function_definition" => make_kind_chunk(
			node,
			ChunkKind::Function,
			extract_identifier(child, source),
			source,
			resolve_recurse(child, ChunkContext::FunctionBody),
		),
		_ => positional_candidate(node, ChunkKind::Block, source),
	}
}
