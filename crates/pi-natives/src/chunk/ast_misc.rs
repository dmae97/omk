//! Chunk classifiers for languages well-served by defaults:
//! Kotlin, Swift, PHP, Solidity, Julia, Odin, Verilog, Zig, Regex, Diff.
//!
//! This is the catch-all classifier: it handles every node kind that any of the
//! miscellaneous languages produce so that nothing silently falls through.

use tree_sitter::Node;

use super::{classify::LangClassifier, common::*, defaults::classify_var_decl};

pub struct MiscClassifier;

impl LangClassifier for MiscClassifier {
	fn classify_root<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		let fn_recurse = || {
			recurse_body(node, ChunkContext::FunctionBody)
				.or_else(|| recurse_into(node, ChunkContext::FunctionBody, &["body"], &["block"]))
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
			| "package_declaration" => group_candidate(node, "imports", source),

			// ── Variables / assignments ──
			"lexical_declaration" | "variable_declaration" => classify_var_decl(node, source),
			"const_declaration" | "var_declaration" => match extract_identifier(node, source) {
				Some(name) => make_named_chunk(node, format!("var_{name}"), source, None),
				None => group_candidate(node, "decls", source),
			},
			"assignment" | "property_declaration" | "state_variable_declaration" => {
				group_candidate(node, "decls", source)
			},

			// ── Statements ──
			"expression_statement" | "global_statement" | "command" | "pipeline" | "function_call" => {
				group_candidate(node, "stmts", source)
			},

			// ── Functions ──
			"function_declaration"
			| "function_definition"
			| "procedure_declaration"
			| "overloaded_procedure_declaration"
			| "test_declaration" => named_candidate(node, "fn", source, fn_recurse()),
			"method_declaration" => {
				named_candidate(node, "meth", source, recurse_body(node, ChunkContext::FunctionBody))
			},
			"constructor_definition"
			| "constructor_declaration"
			| "secondary_constructor"
			| "init_declaration"
			| "fallback_receive_definition" => make_named_chunk(
				node,
				"constructor".to_string(),
				source,
				recurse_body(node, ChunkContext::FunctionBody),
			),

			// ── Containers ──
			"class_declaration" | "class_definition" => {
				container_candidate(node, "class", source, recurse_class(node))
			},
			"interface_declaration" | "protocol_declaration" => {
				container_candidate(node, "iface", source, recurse_interface(node))
			},
			"struct_declaration" | "object_declaration" => {
				container_candidate(node, "struct", source, recurse_class(node))
			},
			"enum_declaration" | "enum_definition" => {
				container_candidate(node, "enum", source, recurse_enum(node))
			},
			"trait_definition" | "class" => {
				container_candidate(node, "trait", source, recurse_class(node))
			},
			"contract_declaration" | "library_declaration" | "trait_declaration" => {
				container_candidate(node, "contract", source, recurse_class(node))
			},
			"namespace_declaration" | "module_definition" | "extension_definition" => {
				container_candidate(node, "mod", source, recurse_class(node))
			},

			// ── Types / aliases ──
			"type_alias_declaration" | "const_type_declaration" | "opaque_declaration" => {
				named_candidate(node, "type", source, recurse_class(node))
			},

			// ── Macros ──
			"macro_definition" | "modifier_definition" => {
				named_candidate(node, "macro", source, recurse_body(node, ChunkContext::FunctionBody))
			},

			// ── Systems (Verilog etc.) ──
			"covergroup_declaration" | "checker_declaration" => {
				container_candidate(node, "group", source, recurse_class(node))
			},
			"module_declaration" => container_candidate(node, "mod", source, recurse_class(node)),
			"union_declaration" => container_candidate(node, "union", source, recurse_class(node)),

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
			| "init_declaration" => make_named_chunk(
				node,
				"constructor".to_string(),
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
					make_named_chunk(
						node,
						"constructor".to_string(),
						source,
						recurse_body(node, ChunkContext::FunctionBody),
					)
				} else {
					make_named_chunk(
						node,
						format!("fn_{name}"),
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
				Some(name) => make_named_chunk(node, format!("field_{name}"), source, None),
				None => group_candidate(node, "fields", source),
			},

			// ── Enum variants ──
			"enum_assignment"
			| "enum_member_declaration"
			| "enum_constant"
			| "enum_entry"
			| "enum_variant" => match extract_identifier(node, source) {
				Some(name) => make_named_chunk(node, format!("variant_{name}"), source, None),
				None => group_candidate(node, "variants", source),
			},

			// ── Other fields ──
			"field_declaration" | "embedded_field" | "container_field" | "binding" => {
				match extract_identifier(node, source) {
					Some(name) => make_named_chunk(node, format!("field_{name}"), source, None),
					None => group_candidate(node, "fields", source),
				}
			},

			// ── Method specs ──
			"method_spec" => named_candidate(node, "meth", source, None),

			// ── Field / method lists ──
			"field_declaration_list" => group_candidate(node, "fields", source),
			"method_spec_list" => group_candidate(node, "methods", source),

			// ── Static initializer ──
			"class_static_block" => make_named_chunk(node, "static_init".to_string(), source, None),

			// ── Decorated definitions ──
			"decorated_definition" => {
				let inner = named_children(node)
					.into_iter()
					.find(|c| c.kind() == "function_definition");
				if let Some(child) = inner {
					let name =
						extract_identifier(child, source).unwrap_or_else(|| "anonymous".to_string());
					make_named_chunk(node, format!("fn_{name}"), source, {
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
			| "flow_pair" => group_candidate(node, "fields", source),

			// ── Types inside classes ──
			"type_item" | "type_alias_declaration" | "type_alias" => {
				named_candidate(node, "type", source, None)
			},

			// ── Const / macro inside classes ──
			"const_item" | "macro_invocation" => group_candidate(node, "fields", source),

			_ => return None,
		})
	}

	fn classify_function<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		let fn_recurse = || recurse_body(node, ChunkContext::FunctionBody);
		Some(match node.kind() {
			// ── Control flow: conditionals ──
			"if_statement" | "unless" | "guard_statement" => make_candidate(
				node,
				"if".to_string(),
				NameStyle::Named,
				None,
				fn_recurse(),
				false,
				source,
			),

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
				"switch".to_string(),
				NameStyle::Named,
				None,
				fn_recurse(),
				false,
				source,
			),

			// ── Control flow: try/catch ──
			"try_statement" | "try_block" | "catch_clause" | "finally_clause"
			| "assembly_statement" => make_candidate(
				node,
				"try".to_string(),
				NameStyle::Named,
				None,
				fn_recurse(),
				false,
				source,
			),

			// ── Loops: for variants (with Python-like check) ──
			"for_statement" | "for_in_statement" | "for_of_statement" => {
				let name = if looks_like_python_statement(node, source) {
					"loop".to_string()
				} else {
					sanitize_node_kind(node.kind())
				};
				make_candidate(node, name, NameStyle::Named, None, fn_recurse(), false, source)
			},

			// ── Loops: while ──
			"while_statement" => {
				let name = if looks_like_python_statement(node, source) {
					"loop"
				} else {
					"while"
				};
				make_candidate(
					node,
					name.to_string(),
					NameStyle::Named,
					None,
					fn_recurse(),
					false,
					source,
				)
			},

			// ── Blocks ──
			"do_statement" | "with_statement" | "do_block" | "subshell" | "async_block"
			| "unsafe_block" | "const_block" | "block_expression" => make_candidate(
				node,
				"block".to_string(),
				NameStyle::Named,
				None,
				fn_recurse(),
				false,
				source,
			),

			// ── Loops: foreach ──
			"foreach_statement" => make_candidate(
				node,
				"for".to_string(),
				NameStyle::Named,
				None,
				fn_recurse(),
				false,
				source,
			),

			// ── Statements ──
			"defer_statement" | "go_statement" | "send_statement" => {
				group_candidate(node, "stmts", source)
			},

			// ── Positional candidates ──
			"elif_clause" => positional_candidate(node, "elif", source),
			"except_clause" => positional_candidate(node, "except", source),
			"when_statement" => positional_candidate(node, "when", source),
			"match_expression" | "match_block" => positional_candidate(node, "match", source),

			// ── Loops / misc expressions ──
			"loop_expression"
			| "while_expression"
			| "for_expression"
			| "errdefer_statement"
			| "comptime_statement"
			| "nosuspend_statement"
			| "suspend_statement"
			| "yul_if_statement"
			| "yul_for_statement" => positional_candidate(node, "loop", source),

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
						make_named_chunk(node, format!("var_{name}"), source, None)
					} else {
						let kind_name = sanitize_node_kind(node.kind());
						group_candidate(node, &kind_name, source)
					}
				} else {
					let kind_name = sanitize_node_kind(node.kind());
					group_candidate(node, &kind_name, source)
				}
			},

			_ => return None,
		})
	}
}
