//! Chunk classifiers for languages well-served by defaults:
//! Kotlin, Swift, PHP, Solidity, Julia, Odin, Verilog, Zig, Regex, Diff.
//!
//! This is the catch-all classifier: it handles every node kind that any of the
//! miscellaneous languages produce so that nothing silently falls through.

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

pub struct MiscClassifier;

fn sanitized_group_candidate<'t>(node: Node<'t>, source: &str) -> RawChunkCandidate<'t> {
	let sanitized = sanitize_node_kind(node.kind());
	let kind = ChunkKind::from_sanitized_kind(sanitized);
	// For unknown kinds that fall back to `Chunk`, preserve the original
	// tree-sitter kind as the identifier so the path stays informative.
	let identifier = if kind == ChunkKind::Chunk {
		Some(sanitized.to_string())
	} else {
		None
	};
	make_candidate(node, kind, identifier, NameStyle::Group, None, None, source)
}

// ── Root-level table rules ──────────────────────────────────────────────────
//
// Control flow kinds that previously delegated to classify_function are
// duplicated here so they resolve at root without a cross-context call.

const MISC_ROOT_RULES: &[super::classify::SemanticRule] = &[
	// Imports / package headers
	semantic_rule(
		"import_statement",
		ChunkKind::Imports,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
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
		"using_statement",
		ChunkKind::Imports,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"namespace_use_declaration",
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
	semantic_rule(
		"import_list",
		ChunkKind::Imports,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"import_header",
		ChunkKind::Imports,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"package_header",
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
	// Variables / assignments (simple group)
	semantic_rule(
		"assignment",
		ChunkKind::Declarations,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
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
	// Statements
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
	semantic_rule(
		"command",
		ChunkKind::Statements,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"pipeline",
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
	// Methods
	semantic_rule(
		"method_declaration",
		ChunkKind::Method,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	// Constructors
	semantic_rule(
		"constructor_definition",
		ChunkKind::Constructor,
		RuleStyle::Named,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"constructor_declaration",
		ChunkKind::Constructor,
		RuleStyle::Named,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"secondary_constructor",
		ChunkKind::Constructor,
		RuleStyle::Named,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"init_declaration",
		ChunkKind::Constructor,
		RuleStyle::Named,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"fallback_receive_definition",
		ChunkKind::Constructor,
		RuleStyle::Named,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	// Containers
	semantic_rule(
		"class_declaration",
		ChunkKind::Class,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::ClassBody),
	),
	semantic_rule(
		"class_definition",
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
		"protocol_declaration",
		ChunkKind::Iface,
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
		"object_declaration",
		ChunkKind::Struct,
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
		"enum_definition",
		ChunkKind::Enum,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::ClassBody),
	),
	semantic_rule(
		"trait_definition",
		ChunkKind::Trait,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::ClassBody),
	),
	semantic_rule(
		"class",
		ChunkKind::Trait,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::ClassBody),
	),
	semantic_rule(
		"contract_declaration",
		ChunkKind::Contract,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::ClassBody),
	),
	semantic_rule(
		"library_declaration",
		ChunkKind::Contract,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::ClassBody),
	),
	semantic_rule(
		"trait_declaration",
		ChunkKind::Contract,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::ClassBody),
	),
	// Types / aliases
	semantic_rule(
		"type_alias_declaration",
		ChunkKind::Type,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::ClassBody),
	),
	semantic_rule(
		"const_type_declaration",
		ChunkKind::Type,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::ClassBody),
	),
	semantic_rule(
		"opaque_declaration",
		ChunkKind::Type,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::ClassBody),
	),
	// Macros
	semantic_rule(
		"macro_definition",
		ChunkKind::Macro,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"modifier_definition",
		ChunkKind::Macro,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	// Systems (Verilog etc.)
	semantic_rule(
		"covergroup_declaration",
		ChunkKind::Group,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::ClassBody),
	),
	semantic_rule(
		"checker_declaration",
		ChunkKind::Group,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::ClassBody),
	),
	semantic_rule(
		"module_declaration",
		ChunkKind::Module,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::ClassBody),
	),
	semantic_rule(
		"union_declaration",
		ChunkKind::Union,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::Auto(ChunkContext::ClassBody),
	),
	// Control flow at top level (same rules as function table)
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
		"guard_statement",
		ChunkKind::If,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"switch_statement",
		ChunkKind::Switch,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"switch_expression",
		ChunkKind::Switch,
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
		"expression_switch_statement",
		ChunkKind::Switch,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"type_switch_statement",
		ChunkKind::Switch,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"select_statement",
		ChunkKind::Switch,
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
		"try_block",
		ChunkKind::Try,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"foreach_statement",
		ChunkKind::For,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"do_statement",
		ChunkKind::Block,
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
];

// ── Class-level table rules ─────────────────────────────────────────────────

const MISC_CLASS_RULES: &[super::classify::SemanticRule] = &[
	// Constructors
	semantic_rule(
		"constructor",
		ChunkKind::Constructor,
		RuleStyle::Named,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"constructor_declaration",
		ChunkKind::Constructor,
		RuleStyle::Named,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"secondary_constructor",
		ChunkKind::Constructor,
		RuleStyle::Named,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"init_declaration",
		ChunkKind::Constructor,
		RuleStyle::Named,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	// Method specs
	semantic_rule(
		"method_spec",
		ChunkKind::Method,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::None,
	),
	// Field / method lists
	semantic_rule(
		"field_declaration_list",
		ChunkKind::Fields,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"method_spec_list",
		ChunkKind::Methods,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
	// Static initializer
	semantic_rule(
		"class_static_block",
		ChunkKind::StaticInit,
		RuleStyle::Named,
		NamingMode::None,
		RecurseMode::None,
	),
	// Types inside classes
	semantic_rule(
		"type_item",
		ChunkKind::Type,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::None,
	),
	semantic_rule(
		"type_alias_declaration",
		ChunkKind::Type,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::None,
	),
	semantic_rule(
		"type_alias",
		ChunkKind::Type,
		RuleStyle::Named,
		NamingMode::AutoIdentifier,
		RecurseMode::None,
	),
	// Const / macro inside classes
	semantic_rule(
		"const_item",
		ChunkKind::Fields,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"macro_invocation",
		ChunkKind::Fields,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
	// Grouped field-like entries
	semantic_rule(
		"assignment",
		ChunkKind::Fields,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"expression_statement",
		ChunkKind::Fields,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"attribute",
		ChunkKind::Fields,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule("pair", ChunkKind::Fields, RuleStyle::Group, NamingMode::None, RecurseMode::None),
	semantic_rule(
		"block_mapping_pair",
		ChunkKind::Fields,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"flow_pair",
		ChunkKind::Fields,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
];

// ── Function-level table rules ──────────────────────────────────────────────

const MISC_FUNCTION_RULES: &[super::classify::SemanticRule] = &[
	// Control flow: conditionals
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
		"guard_statement",
		ChunkKind::If,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	// Control flow: switches
	semantic_rule(
		"switch_statement",
		ChunkKind::Switch,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"switch_expression",
		ChunkKind::Switch,
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
		"expression_switch_statement",
		ChunkKind::Switch,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"type_switch_statement",
		ChunkKind::Switch,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"select_statement",
		ChunkKind::Switch,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"receive_statement",
		ChunkKind::Switch,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"yul_switch_statement",
		ChunkKind::Switch,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	// Control flow: try/catch
	semantic_rule(
		"try_statement",
		ChunkKind::Try,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"try_block",
		ChunkKind::Try,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"catch_clause",
		ChunkKind::Try,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"finally_clause",
		ChunkKind::Try,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"assembly_statement",
		ChunkKind::Try,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	// Blocks
	semantic_rule(
		"do_statement",
		ChunkKind::Block,
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
		"do_block",
		ChunkKind::Block,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"subshell",
		ChunkKind::Block,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"async_block",
		ChunkKind::Block,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"unsafe_block",
		ChunkKind::Block,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"const_block",
		ChunkKind::Block,
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
	// Loops: foreach
	semantic_rule(
		"foreach_statement",
		ChunkKind::For,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	// Statements
	semantic_rule(
		"defer_statement",
		ChunkKind::Statements,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"go_statement",
		ChunkKind::Statements,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"send_statement",
		ChunkKind::Statements,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
	// Positional candidates
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
		"when_statement",
		ChunkKind::When,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"match_expression",
		ChunkKind::Match,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"match_block",
		ChunkKind::Match,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::None,
	),
	// Loops / misc expressions
	semantic_rule(
		"loop_expression",
		ChunkKind::Loop,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"while_expression",
		ChunkKind::Loop,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"for_expression",
		ChunkKind::Loop,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"errdefer_statement",
		ChunkKind::Loop,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"comptime_statement",
		ChunkKind::Loop,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"nosuspend_statement",
		ChunkKind::Loop,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"suspend_statement",
		ChunkKind::Loop,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"yul_if_statement",
		ChunkKind::Loop,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"yul_for_statement",
		ChunkKind::Loop,
		RuleStyle::Positional,
		NamingMode::None,
		RecurseMode::None,
	),
];

const MISC_TABLES: ClassifierTables = ClassifierTables {
	root:                 MISC_ROOT_RULES,
	class:                MISC_CLASS_RULES,
	function:             MISC_FUNCTION_RULES,
	structural_overrides: StructuralOverrides::EMPTY,
};

impl LangClassifier for MiscClassifier {
	fn tables(&self) -> &'static ClassifierTables {
		&MISC_TABLES
	}

	fn classify_override<'t>(
		&self,
		context: ChunkContext,
		node: Node<'t>,
		source: &str,
	) -> Option<RawChunkCandidate<'t>> {
		match context {
			ChunkContext::Root => classify_root_override(node, source),
			ChunkContext::ClassBody => classify_class_override(node, source),
			ChunkContext::FunctionBody => classify_function_override(node, source),
		}
	}
}

/// Root-level overrides for arms that need custom logic (`classify_var_decl`,
/// conditional identifier extraction, or custom recurse fallbacks).
fn classify_root_override<'t>(node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
	let fn_recurse = || {
		recurse_body(node, ChunkContext::FunctionBody)
			.or_else(|| recurse_into(node, ChunkContext::FunctionBody, &["body"], &["block"]))
	};
	let module_recurse = || {
		recurse_class(node).or_else(|| {
			recurse_into(node, ChunkContext::ClassBody, &["body"], &[
				"compound_statement",
				"statement_block",
				"declaration_list",
				"block",
			])
		})
	};
	Some(match node.kind() {
		// classify_var_decl delegation
		"lexical_declaration" | "variable_declaration" => classify_var_decl(node, source),

		// Conditional identifier extraction
		"const_declaration" | "var_declaration" => match extract_identifier(node, source) {
			Some(name) => make_kind_chunk(node, ChunkKind::Variable, Some(name), source, None),
			None => group_candidate(node, ChunkKind::Declarations, source),
		},

		// Custom recurse fallback (recurse_into for body/block)
		"function_declaration"
		| "function_definition"
		| "procedure_declaration"
		| "overloaded_procedure_declaration"
		| "test_declaration" => named_candidate(node, ChunkKind::Function, source, fn_recurse()),

		// Custom recurse fallback (module_recurse with compound_statement etc.)
		"namespace_declaration"
		| "namespace_definition"
		| "module_definition"
		| "extension_definition" => {
			container_candidate(node, ChunkKind::Module, source, module_recurse())
		},

		// Conditional loop kinds: looks_like_python_statement changes the ChunkKind
		"for_statement" | "for_in_statement" | "for_of_statement" => {
			let fn_recurse = recurse_body(node, ChunkContext::FunctionBody);
			let kind = if looks_like_python_statement(node, source) {
				ChunkKind::Loop
			} else {
				match node.kind() {
					"for_statement" => ChunkKind::For,
					"for_in_statement" => ChunkKind::ForIn,
					"for_of_statement" => ChunkKind::ForOf,
					_ => unreachable!(),
				}
			};
			make_candidate(node, kind, None, NameStyle::Named, None, fn_recurse, source)
		},

		// Conditional: looks_like_python_statement
		"while_statement" => {
			let kind = if looks_like_python_statement(node, source) {
				ChunkKind::Loop
			} else {
				ChunkKind::While
			};
			make_candidate(
				node,
				kind,
				None,
				NameStyle::Named,
				None,
				recurse_body(node, ChunkContext::FunctionBody),
				source,
			)
		},

		_ => return None,
	})
}

/// Class-level overrides for arms with conditional logic (constructor name
/// checks, identifier extraction fallbacks, decorated definitions).
fn classify_class_override<'t>(node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
	Some(match node.kind() {
		// Conditional: name == "constructor" changes the ChunkKind
		"method_definition"
		| "method_signature"
		| "abstract_method_signature"
		| "method_declaration"
		| "function_declaration"
		| "function_definition"
		| "function_item"
		| "procedure_declaration"
		| "protocol_function_declaration"
		| "method"
		| "singleton_method" => {
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

		// Conditional identifier extraction with group fallback
		"public_field_definition"
		| "field_definition"
		| "property_definition"
		| "property_signature"
		| "property_declaration"
		| "protocol_property_declaration"
		| "abstract_class_field"
		| "const_declaration"
		| "constant_declaration"
		| "event_field_declaration" => match extract_identifier(node, source) {
			Some(name) => make_kind_chunk(node, ChunkKind::Field, Some(name), source, None),
			None => group_candidate(node, ChunkKind::Fields, source),
		},

		// Conditional identifier extraction
		"enum_assignment"
		| "enum_member_declaration"
		| "enum_constant"
		| "enum_entry"
		| "enum_variant" => match extract_identifier(node, source) {
			Some(name) => make_kind_chunk(node, ChunkKind::Variant, Some(name), source, None),
			None => group_candidate(node, ChunkKind::Variants, source),
		},

		// Conditional identifier extraction
		"field_declaration" | "embedded_field" | "container_field" | "binding" => {
			match extract_identifier(node, source) {
				Some(name) => make_kind_chunk(node, ChunkKind::Field, Some(name), source, None),
				None => group_candidate(node, ChunkKind::Fields, source),
			}
		},

		// Custom child-node logic (recurse_into on inner function_definition)
		"decorated_definition" => {
			let inner = named_children(node)
				.into_iter()
				.find(|c| c.kind() == "function_definition");
			if let Some(child) = inner {
				let name = extract_identifier(child, source).unwrap_or_else(|| "anonymous".to_string());
				make_kind_chunk(node, ChunkKind::Function, Some(name), source, {
					let context = ChunkContext::FunctionBody;
					recurse_into(child, context, &["body"], &["block"])
				})
			} else {
				return None;
			}
		},

		_ => return None,
	})
}

/// Function-level overrides for arms with conditional logic
/// (Python-like detection, span-based variable handling).
fn classify_function_override<'t>(node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
	let fn_recurse = || recurse_body(node, ChunkContext::FunctionBody);
	Some(match node.kind() {
		// Conditional: looks_like_python_statement changes the ChunkKind
		"for_statement" | "for_in_statement" | "for_of_statement" => {
			let kind = if looks_like_python_statement(node, source) {
				ChunkKind::Loop
			} else {
				match node.kind() {
					"for_statement" => ChunkKind::For,
					"for_in_statement" => ChunkKind::ForIn,
					"for_of_statement" => ChunkKind::ForOf,
					_ => unreachable!(),
				}
			};
			make_candidate(node, kind, None, NameStyle::Named, None, fn_recurse(), source)
		},

		// Conditional: looks_like_python_statement
		"while_statement" => {
			let kind = if looks_like_python_statement(node, source) {
				ChunkKind::Loop
			} else {
				ChunkKind::While
			};
			make_candidate(node, kind, None, NameStyle::Named, None, fn_recurse(), source)
		},

		// Conditional span/name logic
		"lexical_declaration"
		| "variable_declaration"
		| "const_declaration"
		| "var_declaration"
		| "short_var_declaration"
		| "let_declaration" => {
			let span = line_span(node.start_position().row + 1, node.end_position().row + 1);
			if span > 1 {
				if let Some(name) = extract_single_declarator_name(node, source) {
					make_kind_chunk(node, ChunkKind::Variable, Some(name), source, None)
				} else {
					sanitized_group_candidate(node, source)
				}
			} else {
				sanitized_group_candidate(node, source)
			}
		},

		_ => return None,
	})
}
