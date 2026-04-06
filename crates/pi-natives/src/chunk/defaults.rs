//! Default (shared) classification logic.
//!
//! These functions handle node kinds that are common across many languages.
//! Per-language classifiers are tried first; these defaults are the fallback.

use tree_sitter::Node;

use super::common::*;

// ── Root-level defaults ──────────────────────────────────────────────────

pub fn classify_root_default<'tree>(node: Node<'tree>, source: &str) -> RawChunkCandidate<'tree> {
	match node.kind() {
		// ── Imports / package headers ──
		"import_statement"
		| "import_from_statement"
		| "use_declaration"
		| "import_declaration"
		| "using_directive"
		| "namespace_use_declaration"
		| "module_import"
		| "include_directive"
		| "import_list"
		| "import_header"
		| "package_header"
		| "package_declaration"
		| "using_statement"
		| "namespace_statement"
		| "preproc_include"
		| "extern_crate_declaration"
		| "yaml_directive"
		| "tag_directive"
		| "reserved_directive" => group_candidate(node, "imports", source),

		// ── Variables / assignments ──
		"lexical_declaration" | "variable_declaration" => classify_var_decl(node, source),
		"const_declaration" | "var_declaration" | "short_var_declaration" => {
			match extract_identifier(node, source) {
				Some(name) => make_named_chunk(node, format!("var_{name}"), source, None),
				None => group_candidate(node, "decls", source),
			}
		},
		"assignment"
		| "assignment_statement"
		| "property_declaration"
		| "state_variable_declaration" => group_candidate(node, "decls", source),
		"expression_statement" | "global_statement" | "command" | "pipeline" | "function_call" => {
			group_candidate(node, "stmts", source)
		},

		// ── Containers / namespaces / modules ──
		"class_declaration"
		| "class_definition"
		| "class_specifier"
		| "class_interface"
		| "class_implementation" => container_candidate(node, "class", source, recurse_class(node)),
		"interface_declaration" | "protocol_declaration" | "trait_definition" => {
			container_candidate(node, "iface", source, recurse_interface(node))
		},
		"namespace_declaration"
		| "file_scoped_namespace_declaration"
		| "namespace_definition"
		| "namespace_definition_name"
		| "module_definition"
		| "module"
		| "mod_item"
		| "package_clause"
		| "object_definition"
		| "extension_definition"
		| "foreign_block" => container_candidate(node, "mod", source, recurse_class(node)),
		"struct_item" | "struct_specifier" | "struct_declaration" | "record_declaration"
		| "object_declaration" => container_candidate(node, "struct", source, recurse_class(node)),
		"enum_declaration" | "enum_item" | "enum_specifier" | "enum_definition" => {
			container_candidate(node, "enum", source, recurse_enum(node))
		},
		"trait_item" | "class" | "deftype" | "defrecord" => {
			container_candidate(node, "trait", source, recurse_class(node))
		},
		"contract_declaration" | "library_declaration" | "trait_declaration" => {
			container_candidate(node, "contract", source, recurse_class(node))
		},

		// ── Functions / methods / macros ──
		"function_declaration"
		| "function_definition"
		| "function_item"
		| "procedure_declaration"
		| "overloaded_procedure_declaration"
		| "function_definition_header"
		| "test_declaration" => named_candidate(
			node,
			"fn",
			source,
			recurse_body(node, ChunkContext::FunctionBody)
				.or_else(|| recurse_body(node, ChunkContext::FunctionBody))
				.or_else(|| {
					let context = ChunkContext::FunctionBody;
					recurse_into(node, context, &["body"], &["block"])
				}),
		),
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
		"macro_definition" | "macro_rule" | "modifier_definition" => {
			named_candidate(node, "macro", source, recurse_body(node, ChunkContext::FunctionBody))
		},

		// ── Types / aliases ──
		"type_alias_declaration"
		| "type_item"
		| "type_alias"
		| "user_defined_type_definition"
		| "const_type_declaration"
		| "opaque_declaration" => named_candidate(node, "type", source, recurse_class(node)),

		// ── Systems extras ──
		"static_item" => group_candidate(node, "decls", source),
		"union_declaration" => container_candidate(node, "union", source, recurse_class(node)),
		"covergroup_declaration" | "checker_declaration" => {
			container_candidate(node, "group", source, recurse_class(node))
		},
		"module_declaration" => container_candidate(node, "mod", source, recurse_class(node)),
		"inner_attribute_item" => group_candidate(node, "attrs", source),
		_ => infer_named_candidate(node, source),
	}
}

// ── Class-level defaults ─────────────────────────────────────────────────

pub fn classify_class_default<'tree>(node: Node<'tree>, source: &str) -> RawChunkCandidate<'tree> {
	match node.kind() {
		"constructor" | "constructor_declaration" | "secondary_constructor" | "init_declaration" => {
			make_named_chunk(
				node,
				"constructor".to_string(),
				source,
				recurse_body(node, ChunkContext::FunctionBody),
			)
		},
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
		"enum_assignment"
		| "enum_member_declaration"
		| "enum_constant"
		| "enum_entry"
		| "enum_variant" => match extract_identifier(node, source) {
			Some(name) => make_named_chunk(node, format!("variant_{name}"), source, None),
			None => group_candidate(node, "variants", source),
		},
		"field_declaration" | "embedded_field" | "container_field" | "binding" => {
			match extract_identifier(node, source) {
				Some(name) => make_named_chunk(node, format!("field_{name}"), source, None),
				None => group_candidate(node, "fields", source),
			}
		},
		"method_spec" => named_candidate(node, "meth", source, None),
		"field_declaration_list" => group_candidate(node, "fields", source),
		"method_spec_list" => group_candidate(node, "methods", source),
		"class_static_block" => make_named_chunk(node, "static_init".to_string(), source, None),
		"decorated_definition" => {
			let inner = named_children(node)
				.into_iter()
				.find(|c| c.kind() == "function_definition");
			if let Some(child) = inner {
				let name = extract_identifier(child, source).unwrap_or_else(|| "anonymous".to_string());
				make_named_chunk(node, format!("fn_{name}"), source, {
					let context = ChunkContext::FunctionBody;
					recurse_into(child, context, &["body"], &["block"])
				})
			} else {
				infer_named_candidate(node, source)
			}
		},
		"assignment"
		| "expression_statement"
		| "attribute"
		| "pair"
		| "block_mapping_pair"
		| "flow_pair" => group_candidate(node, "fields", source),
		"type_item" | "type_alias_declaration" | "type_alias" => {
			named_candidate(node, "type", source, None)
		},
		"const_item" => group_candidate(node, "fields", source),
		"macro_invocation" => group_candidate(node, "fields", source),
		_ => infer_named_candidate(node, source),
	}
}

// ── Function-level defaults ──────────────────────────────────────────────

pub fn classify_function_default<'tree>(
	node: Node<'tree>,
	source: &str,
) -> RawChunkCandidate<'tree> {
	match node.kind() {
		"if_statement" | "unless" | "guard_statement" => positional_candidate(node, "if", source),
		"switch_statement"
		| "switch_expression"
		| "case_statement"
		| "case_match"
		| "expression_switch_statement"
		| "type_switch_statement"
		| "select_statement"
		| "receive_statement"
		| "yul_switch_statement" => positional_candidate(node, "switch", source),
		"try_statement" | "try_block" | "catch_clause" | "finally_clause" | "assembly_statement" => {
			positional_candidate(node, "try", source)
		},
		"for_statement" | "for_in_statement" | "for_of_statement" => {
			if looks_like_python_statement(node, source) {
				positional_candidate(node, "loop", source)
			} else {
				positional_candidate(node, "for", source)
			}
		},
		"while_statement" => {
			if looks_like_python_statement(node, source) {
				positional_candidate(node, "loop", source)
			} else {
				positional_candidate(node, "while", source)
			}
		},
		"do_statement" | "with_statement" | "do_block" | "subshell" | "async_block"
		| "unsafe_block" | "const_block" | "block_expression" => {
			positional_candidate(node, "block", source)
		},
		"foreach_statement" => positional_candidate(node, "for", source),
		"defer_statement" | "go_statement" | "send_statement" => {
			group_candidate(node, "stmts", source)
		},
		"elif_clause" => positional_candidate(node, "elif", source),
		"except_clause" => positional_candidate(node, "except", source),
		"when_statement" => positional_candidate(node, "when", source),
		"match_expression" | "match_block" => positional_candidate(node, "match", source),
		"loop_expression"
		| "while_expression"
		| "for_expression"
		| "errdefer_statement"
		| "comptime_statement"
		| "nosuspend_statement"
		| "suspend_statement"
		| "yul_if_statement"
		| "yul_for_statement" => positional_candidate(node, "loop", source),
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
		_ => {
			let kind_name = sanitize_node_kind(node.kind());
			group_candidate(node, &kind_name, source)
		},
	}
}

// ── Variable declaration classification (shared) ─────────────────────────

pub fn classify_var_decl<'tree>(node: Node<'tree>, source: &str) -> RawChunkCandidate<'tree> {
	if let Some(candidate) = promote_assigned_expression(node, node, source) {
		return candidate;
	}
	if let Some(name) = extract_single_declarator_name(node, source) {
		return make_named_chunk(node, format!("var_{name}"), source, None);
	}
	group_candidate(node, "decls", source)
}

pub fn promote_assigned_expression<'tree>(
	range_node: Node<'tree>,
	declaration_node: Node<'tree>,
	source: &str,
) -> Option<RawChunkCandidate<'tree>> {
	let declarators: Vec<Node<'tree>> = named_children(declaration_node)
		.into_iter()
		.filter(|c| c.kind() == "variable_declarator")
		.collect();
	if declarators.len() != 1 {
		return None;
	}

	let decl = declarators[0];
	let value = decl.child_by_field_name("value")?;
	let name = extract_identifier(decl, source).unwrap_or_else(|| "anonymous".to_string());

	match value.kind() {
		"arrow_function" | "function_expression" | "function" => {
			let recurse = recurse_body(value, ChunkContext::FunctionBody);
			Some(make_named_chunk_from(range_node, value, format!("fn_{name}"), source, recurse))
		},
		"class" | "class_expression" => {
			let recurse = recurse_class(value);
			Some(make_container_chunk_from(
				range_node,
				value,
				format!("class_{name}"),
				source,
				recurse,
			))
		},
		_ => None,
	}
}
