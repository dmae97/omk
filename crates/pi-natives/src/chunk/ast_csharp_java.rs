//! Language-specific chunk classifiers for C# and Java.

use tree_sitter::Node;

use super::{
	classify::{
		ClassifierTables, LangClassifier, NamingMode, RecurseMode, RuleStyle, StructuralOverrides,
		semantic_rule,
	},
	common::*,
	defaults::classify_var_decl,
	kind::ChunkKind,
};

pub struct CSharpJavaClassifier;

const CSHARP_JAVA_ROOT_RULES: &[super::classify::SemanticRule] = &[
	// ── Imports ──
	semantic_rule(
		"import_declaration",
		ChunkKind::Imports,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"using_directive",
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
		"namespace_statement",
		ChunkKind::Imports,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
	// ── Functions ──
	semantic_rule(
		"method_declaration",
		ChunkKind::Method,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::FunctionBody),
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
	// ── Constructors ──
	semantic_rule(
		"constructor_declaration",
		ChunkKind::Constructor,
		RuleStyle::Named,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	// ── Containers ──
	semantic_rule(
		"class_declaration",
		ChunkKind::Class,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::ClassBody),
	),
	semantic_rule(
		"interface_declaration",
		ChunkKind::Iface,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::ClassBody),
	),
	semantic_rule(
		"enum_declaration",
		ChunkKind::Enum,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::ClassBody),
	),
	semantic_rule(
		"struct_declaration",
		ChunkKind::Struct,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::ClassBody),
	),
	semantic_rule(
		"record_declaration",
		ChunkKind::Struct,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::ClassBody),
	),
	semantic_rule(
		"namespace_declaration",
		ChunkKind::Module,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::ClassBody),
	),
	semantic_rule(
		"file_scoped_namespace_declaration",
		ChunkKind::Module,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::ClassBody),
	),
	// ── Types ──
	semantic_rule(
		"type_alias_declaration",
		ChunkKind::Type,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::ClassBody),
	),
	// ── Declarations ──
	semantic_rule(
		"property_declaration",
		ChunkKind::Declarations,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"state_variable_declaration",
		ChunkKind::Declarations,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
	// ── Statements ──
	semantic_rule(
		"expression_statement",
		ChunkKind::Statements,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
];

const CSHARP_JAVA_CLASS_RULES: &[super::classify::SemanticRule] = &[
	// ── Containers ──
	semantic_rule(
		"class_declaration",
		ChunkKind::Class,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::ClassBody),
	),
	semantic_rule(
		"interface_declaration",
		ChunkKind::Iface,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::ClassBody),
	),
	semantic_rule(
		"enum_declaration",
		ChunkKind::Enum,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::ClassBody),
	),
	semantic_rule(
		"struct_declaration",
		ChunkKind::Struct,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::ClassBody),
	),
	semantic_rule(
		"record_declaration",
		ChunkKind::Struct,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::ClassBody),
	),
	semantic_rule(
		"namespace_declaration",
		ChunkKind::Module,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::ClassBody),
	),
	semantic_rule(
		"file_scoped_namespace_declaration",
		ChunkKind::Module,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::ClassBody),
	),
	// ── Static blocks ──
	semantic_rule(
		"class_static_block",
		ChunkKind::StaticInit,
		RuleStyle::Named,
		NamingMode::None,
		RecurseMode::None,
	),
];

const CSHARP_JAVA_TABLES: ClassifierTables = ClassifierTables {
	root:                 CSHARP_JAVA_ROOT_RULES,
	class:                CSHARP_JAVA_CLASS_RULES,
	function:             &[],
	structural_overrides: StructuralOverrides::EMPTY,
};

impl LangClassifier for CSharpJavaClassifier {
	fn tables(&self) -> &'static ClassifierTables {
		&CSHARP_JAVA_TABLES
	}

	fn classify_override<'t>(
		&self,
		context: ChunkContext,
		node: Node<'t>,
		source: &str,
	) -> Option<RawChunkCandidate<'t>> {
		match context {
			ChunkContext::Root => match node.kind() {
				// ── Variables / assignments ──
				"variable_declaration" | "lexical_declaration" => Some(classify_var_decl(node, source)),
				// ── Control flow (top-level scripts) ──
				"if_statement" | "switch_statement" | "switch_expression" | "for_statement"
				| "foreach_statement" | "while_statement" | "do_statement" | "try_statement" => {
					Some(classify_function_csharp_java(node, source))
				},
				_ => None,
			},
			ChunkContext::ClassBody => match node.kind() {
				// ── Methods (conditional constructor detection) ──
				"method_declaration" | "function_declaration" | "function_definition" => {
					let name =
						extract_identifier(node, source).unwrap_or_else(|| "anonymous".to_string());
					if name == "constructor" {
						Some(make_kind_chunk(
							node,
							ChunkKind::Constructor,
							None,
							source,
							recurse_body(node, ChunkContext::FunctionBody),
						))
					} else {
						Some(make_kind_chunk(
							node,
							ChunkKind::Function,
							Some(name),
							source,
							recurse_body(node, ChunkContext::FunctionBody),
						))
					}
				},
				// ── Constructors ──
				"constructor_declaration" | "secondary_constructor" => Some(make_kind_chunk(
					node,
					ChunkKind::Constructor,
					None,
					source,
					recurse_body(node, ChunkContext::FunctionBody),
				)),
				// ── Fields ──
				"field_declaration"
				| "property_declaration"
				| "constant_declaration"
				| "event_field_declaration" => Some(match extract_field_name(node, source) {
					Some(name) => make_kind_chunk(node, ChunkKind::Field, Some(name), source, None),
					None => group_candidate(node, ChunkKind::Fields, source),
				}),
				// ── Enum members ──
				"enum_member_declaration" | "enum_constant" | "enum_entry" => {
					Some(match extract_identifier(node, source) {
						Some(name) => make_kind_chunk(node, ChunkKind::Variant, Some(name), source, None),
						None => group_candidate(node, ChunkKind::Variants, source),
					})
				},
				_ => None,
			},
			ChunkContext::FunctionBody => Some(classify_function_csharp_java(node, source)),
		}
	}
}

/// Extract the variable name from a field/constant declaration.
///
/// Java `field_declaration` has the structure:
///   `field_declaration` { modifiers, type: `type_identifier`, declarator:
/// `variable_declarator` { name: identifier } }
///
/// `extract_identifier` would find `type_identifier` first, so we look into
/// `variable_declarator` children for the actual variable name.
fn extract_field_name(node: Node<'_>, source: &str) -> Option<String> {
	for child in named_children(node) {
		if child.kind() == "variable_declarator" {
			return extract_identifier(child, source);
		}
	}
	extract_identifier(node, source)
}

fn classify_function_csharp_java<'tree>(
	node: Node<'tree>,
	source: &str,
) -> RawChunkCandidate<'tree> {
	let fn_recurse = || recurse_body(node, ChunkContext::FunctionBody);
	match node.kind() {
		"if_statement" => {
			make_candidate(node, ChunkKind::If, None, NameStyle::Named, None, fn_recurse(), source)
		},
		"switch_statement" | "switch_expression" => {
			make_candidate(node, ChunkKind::Switch, None, NameStyle::Named, None, fn_recurse(), source)
		},
		"try_statement" | "catch_clause" | "finally_clause" => {
			make_candidate(node, ChunkKind::Try, None, NameStyle::Named, None, fn_recurse(), source)
		},
		"for_statement" => {
			make_candidate(node, ChunkKind::For, None, NameStyle::Named, None, fn_recurse(), source)
		},
		"foreach_statement" => {
			make_candidate(node, ChunkKind::For, None, NameStyle::Named, None, fn_recurse(), source)
		},
		"while_statement" => {
			make_candidate(node, ChunkKind::While, None, NameStyle::Named, None, fn_recurse(), source)
		},
		"do_statement" => {
			make_candidate(node, ChunkKind::Block, None, NameStyle::Named, None, fn_recurse(), source)
		},
		"variable_declaration" | "lexical_declaration" => {
			let span = line_span(node.start_position().row + 1, node.end_position().row + 1);
			if span > 1 {
				if let Some(name) = extract_single_declarator_name(node, source) {
					make_kind_chunk(node, ChunkKind::Variable, Some(name), source, None)
				} else {
					group_from_sanitized(node, source)
				}
			} else {
				group_from_sanitized(node, source)
			}
		},
		_ => group_from_sanitized(node, source),
	}
}

fn group_from_sanitized<'t>(node: Node<'t>, source: &str) -> RawChunkCandidate<'t> {
	let sanitized = sanitize_node_kind(node.kind());
	let kind = ChunkKind::from_sanitized_kind(sanitized);
	let identifier = if kind == ChunkKind::Chunk {
		Some(sanitized.to_string())
	} else {
		None
	};
	make_candidate(node, kind, identifier, NameStyle::Group, None, None, source)
}
