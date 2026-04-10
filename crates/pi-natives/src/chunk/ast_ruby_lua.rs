//! Language-specific chunk classifiers for Ruby and Lua.

use tree_sitter::Node;

use super::{
	classify::{
		ClassifierTables, LangClassifier, NamingMode, RecurseMode, RuleStyle, StructuralOverrides,
		semantic_rule,
	},
	common::*,
	kind::ChunkKind,
};

pub struct RubyLuaClassifier;

const RUBY_LUA_ROOT_RULES: &[super::classify::SemanticRule] = &[
	semantic_rule(
		"function_definition",
		ChunkKind::Function,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"method",
		ChunkKind::Function,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"singleton_method",
		ChunkKind::Function,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"class",
		ChunkKind::Class,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::ClassBody),
	),
	semantic_rule(
		"module",
		ChunkKind::Module,
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
		"unless",
		ChunkKind::If,
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
		"for_statement",
		ChunkKind::Loop,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
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
	semantic_rule(
		"function_call",
		ChunkKind::Statements,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
];

const RUBY_LUA_CLASS_RULES: &[super::classify::SemanticRule] = &[
	semantic_rule(
		"class",
		ChunkKind::Class,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::ClassBody),
	),
	semantic_rule(
		"module",
		ChunkKind::Module,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::ClassBody),
	),
	semantic_rule(
		"assignment",
		ChunkKind::Fields,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"call",
		ChunkKind::Statements,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"command",
		ChunkKind::Statements,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"identifier",
		ChunkKind::Statements,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
];

const RUBY_LUA_FUNCTION_RULES: &[super::classify::SemanticRule] = &[
	semantic_rule(
		"if_statement",
		ChunkKind::If,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"unless",
		ChunkKind::If,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"case_statement",
		ChunkKind::Switch,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"case_match",
		ChunkKind::Switch,
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
		"for_statement",
		ChunkKind::Loop,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"assignment",
		ChunkKind::Statements,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
];

const RUBY_LUA_TABLES: ClassifierTables = ClassifierTables {
	root:                 RUBY_LUA_ROOT_RULES,
	class:                RUBY_LUA_CLASS_RULES,
	function:             RUBY_LUA_FUNCTION_RULES,
	structural_overrides: StructuralOverrides {
		extra_trivia:            &[],
		preserved_trivia:        &[],
		extra_root_wrappers:     &[],
		preserved_root_wrappers: &["module"],
		absorbable_attrs:        &[],
	},
};

impl LangClassifier for RubyLuaClassifier {
	fn tables(&self) -> &'static ClassifierTables {
		&RUBY_LUA_TABLES
	}

	fn classify_override<'t>(
		&self,
		context: ChunkContext,
		node: Node<'t>,
		source: &str,
	) -> Option<RawChunkCandidate<'t>> {
		match (context, node.kind()) {
			(ChunkContext::Root, "command" | "call") => {
				let target = extract_identifier(node, source);
				Some(match target.as_deref() {
					Some("require" | "require_relative" | "load" | "autoload") => {
						group_candidate(node, ChunkKind::Imports, source)
					},
					_ => group_candidate(node, ChunkKind::Statements, source),
				})
			},
			(ChunkContext::ClassBody, "method" | "singleton_method") => {
				let name = extract_identifier(node, source).unwrap_or_else(|| "anonymous".to_string());
				let kind = if name == "initialize" {
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
			_ => None,
		}
	}
}
