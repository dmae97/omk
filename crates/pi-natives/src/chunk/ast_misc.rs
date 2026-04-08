//! Chunk classifiers for languages well-served by defaults:
//! Kotlin, Swift, PHP, Solidity, Julia, Odin, Verilog, Zig, Regex, Diff.
//!
//! This is the catch-all classifier: it handles every node kind that any of the
//! miscellaneous languages produce so that nothing silently falls through.

use tree_sitter::Node;

use super::{classify::LangClassifier, common::*, defaults::classify_var_decl, kind::ChunkKind};

pub struct MiscClassifier;

fn sanitized_group_candidate<'t>(node: Node<'t>, source: &str) -> RawChunkCandidate<'t> {
	let sanitized = sanitize_node_kind(node.kind());
	let kind = ChunkKind::from_sanitized_kind(sanitized.as_str());
	// For unknown kinds that fall back to `Chunk`, preserve the original
	// tree-sitter kind as the identifier so the path stays informative.
	let identifier = if kind == ChunkKind::Chunk {
		Some(sanitized)
	} else {
		None
	};
	make_candidate(node, kind, identifier, NameStyle::Group, None, None, source)
}

impl LangClassifier for MiscClassifier {
	fn classify_root<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
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
			// ── Imports / package headers ──
			"import_statement"
			| "import_declaration"
			| "using_directive"
			| "using_statement"
			| "namespace_use_declaration"
			| "namespace_statement"
			| "import_list"
			| "import_header"
			| "package_header"
			| "package_declaration" => group_candidate(node, ChunkKind::Imports, source),

			// ── Variables / assignments ──
			"lexical_declaration" | "variable_declaration" => classify_var_decl(node, source),
			"const_declaration" | "var_declaration" => match extract_identifier(node, source) {
				Some(name) => make_kind_chunk(node, ChunkKind::Variable, Some(name), source, None),
				None => group_candidate(node, ChunkKind::Declarations, source),
			},
			"assignment" | "property_declaration" | "state_variable_declaration" => {
				group_candidate(node, ChunkKind::Declarations, source)
			},

			// ── Statements ──
			"expression_statement" | "global_statement" | "command" | "pipeline" | "function_call" => {
				group_candidate(node, ChunkKind::Statements, source)
			},

			// ── Functions ──
			"function_declaration"
			| "function_definition"
			| "procedure_declaration"
			| "overloaded_procedure_declaration"
			| "test_declaration" => named_candidate(node, ChunkKind::Function, source, fn_recurse()),
			"method_declaration" => named_candidate(
				node,
				ChunkKind::Method,
				source,
				recurse_body(node, ChunkContext::FunctionBody),
			),
			"constructor_definition"
			| "constructor_declaration"
			| "secondary_constructor"
			| "init_declaration"
			| "fallback_receive_definition" => make_kind_chunk(
				node,
				ChunkKind::Constructor,
				None,
				source,
				recurse_body(node, ChunkContext::FunctionBody),
			),

			// ── Containers ──
			"class_declaration" | "class_definition" => {
				container_candidate(node, ChunkKind::Class, source, recurse_class(node))
			},
			"interface_declaration" | "protocol_declaration" => {
				container_candidate(node, ChunkKind::Iface, source, recurse_interface(node))
			},
			"struct_declaration" | "object_declaration" => {
				container_candidate(node, ChunkKind::Struct, source, recurse_class(node))
			},
			"enum_declaration" | "enum_definition" => {
				container_candidate(node, ChunkKind::Enum, source, recurse_enum(node))
			},
			"trait_definition" | "class" => {
				container_candidate(node, ChunkKind::Trait, source, recurse_class(node))
			},
			"contract_declaration" | "library_declaration" | "trait_declaration" => {
				container_candidate(node, ChunkKind::Contract, source, recurse_class(node))
			},
			"namespace_declaration"
			| "namespace_definition"
			| "module_definition"
			| "extension_definition" => {
				container_candidate(node, ChunkKind::Module, source, module_recurse())
			},

			// ── Types / aliases ──
			"type_alias_declaration" | "const_type_declaration" | "opaque_declaration" => {
				named_candidate(node, ChunkKind::Type, source, recurse_class(node))
			},

			// ── Macros ──
			"macro_definition" | "modifier_definition" => named_candidate(
				node,
				ChunkKind::Macro,
				source,
				recurse_body(node, ChunkContext::FunctionBody),
			),

			// ── Systems (Verilog etc.) ──
			"covergroup_declaration" | "checker_declaration" => {
				container_candidate(node, ChunkKind::Group, source, recurse_class(node))
			},
			"module_declaration" => {
				container_candidate(node, ChunkKind::Module, source, recurse_class(node))
			},
			"union_declaration" => {
				container_candidate(node, ChunkKind::Union, source, recurse_class(node))
			},

			// ── Control flow at top level → delegate to function-level ──
			"if_statement"
			| "unless"
			| "guard_statement"
			| "switch_statement"
			| "switch_expression"
			| "case_statement"
			| "expression_switch_statement"
			| "type_switch_statement"
			| "select_statement"
			| "try_statement"
			| "try_block"
			| "for_statement"
			| "for_in_statement"
			| "for_of_statement"
			| "foreach_statement"
			| "while_statement"
			| "do_statement"
			| "with_statement" => return self.classify_function(node, source),

			_ => return None,
		})
	}

	fn classify_class<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		Some(match node.kind() {
			// ── Constructors ──
			"constructor"
			| "constructor_declaration"
			| "secondary_constructor"
			| "init_declaration" => make_kind_chunk(
				node,
				ChunkKind::Constructor,
				None,
				source,
				recurse_body(node, ChunkContext::FunctionBody),
			),

			// ── Methods ──
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

			// ── Fields (named properties) ──
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

			// ── Enum variants ──
			"enum_assignment"
			| "enum_member_declaration"
			| "enum_constant"
			| "enum_entry"
			| "enum_variant" => match extract_identifier(node, source) {
				Some(name) => make_kind_chunk(node, ChunkKind::Variant, Some(name), source, None),
				None => group_candidate(node, ChunkKind::Variants, source),
			},

			// ── Other fields ──
			"field_declaration" | "embedded_field" | "container_field" | "binding" => {
				match extract_identifier(node, source) {
					Some(name) => make_kind_chunk(node, ChunkKind::Field, Some(name), source, None),
					None => group_candidate(node, ChunkKind::Fields, source),
				}
			},

			// ── Method specs ──
			"method_spec" => named_candidate(node, ChunkKind::Method, source, None),

			// ── Field / method lists ──
			"field_declaration_list" => group_candidate(node, ChunkKind::Fields, source),
			"method_spec_list" => group_candidate(node, ChunkKind::Methods, source),

			// ── Static initializer ──
			"class_static_block" => make_kind_chunk(node, ChunkKind::StaticInit, None, source, None),

			// ── Decorated definitions ──
			"decorated_definition" => {
				let inner = named_children(node)
					.into_iter()
					.find(|c| c.kind() == "function_definition");
				if let Some(child) = inner {
					let name =
						extract_identifier(child, source).unwrap_or_else(|| "anonymous".to_string());
					make_kind_chunk(node, ChunkKind::Function, Some(name), source, {
						let context = ChunkContext::FunctionBody;
						recurse_into(child, context, &["body"], &["block"])
					})
				} else {
					return None;
				}
			},

			// ── Grouped field-like entries ──
			"assignment"
			| "expression_statement"
			| "attribute"
			| "pair"
			| "block_mapping_pair"
			| "flow_pair" => group_candidate(node, ChunkKind::Fields, source),

			// ── Types inside classes ──
			"type_item" | "type_alias_declaration" | "type_alias" => {
				named_candidate(node, ChunkKind::Type, source, None)
			},

			// ── Const / macro inside classes ──
			"const_item" | "macro_invocation" => group_candidate(node, ChunkKind::Fields, source),

			_ => return None,
		})
	}

	fn classify_function<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		let fn_recurse = || recurse_body(node, ChunkContext::FunctionBody);
		Some(match node.kind() {
			// ── Control flow: conditionals ──
			"if_statement" | "unless" | "guard_statement" => {
				make_candidate(node, ChunkKind::If, None, NameStyle::Named, None, fn_recurse(), source)
			},

			// ── Control flow: switches ──
			"switch_statement"
			| "switch_expression"
			| "case_statement"
			| "case_match"
			| "expression_switch_statement"
			| "type_switch_statement"
			| "select_statement"
			| "receive_statement"
			| "yul_switch_statement" => make_candidate(
				node,
				ChunkKind::Switch,
				None,
				NameStyle::Named,
				None,
				fn_recurse(),
				source,
			),

			// ── Control flow: try/catch ──
			"try_statement" | "try_block" | "catch_clause" | "finally_clause"
			| "assembly_statement" => {
				make_candidate(node, ChunkKind::Try, None, NameStyle::Named, None, fn_recurse(), source)
			},

			// ── Loops: for variants (with Python-like check) ──
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

			// ── Loops: while ──
			"while_statement" => {
				let kind = if looks_like_python_statement(node, source) {
					ChunkKind::Loop
				} else {
					ChunkKind::While
				};
				make_candidate(node, kind, None, NameStyle::Named, None, fn_recurse(), source)
			},

			// ── Blocks ──
			"do_statement" | "with_statement" | "do_block" | "subshell" | "async_block"
			| "unsafe_block" | "const_block" | "block_expression" => make_candidate(
				node,
				ChunkKind::Block,
				None,
				NameStyle::Named,
				None,
				fn_recurse(),
				source,
			),

			// ── Loops: foreach ──
			"foreach_statement" => {
				make_candidate(node, ChunkKind::For, None, NameStyle::Named, None, fn_recurse(), source)
			},

			// ── Statements ──
			"defer_statement" | "go_statement" | "send_statement" => {
				group_candidate(node, ChunkKind::Statements, source)
			},

			// ── Positional candidates ──
			"elif_clause" => positional_candidate(node, ChunkKind::Elif, source),
			"except_clause" => positional_candidate(node, ChunkKind::Except, source),
			"when_statement" => positional_candidate(node, ChunkKind::When, source),
			"match_expression" | "match_block" => positional_candidate(node, ChunkKind::Match, source),

			// ── Loops / misc expressions ──
			"loop_expression"
			| "while_expression"
			| "for_expression"
			| "errdefer_statement"
			| "comptime_statement"
			| "nosuspend_statement"
			| "suspend_statement"
			| "yul_if_statement"
			| "yul_for_statement" => positional_candidate(node, ChunkKind::Loop, source),

			// ── Variable declarations ──
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
}
