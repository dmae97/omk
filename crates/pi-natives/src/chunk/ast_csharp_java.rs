//! Language-specific chunk classifiers for C# and Java.

use tree_sitter::Node;

use super::{classify::LangClassifier, common::*, defaults::classify_var_decl};

pub struct CSharpJavaClassifier;

impl LangClassifier for CSharpJavaClassifier {
	fn classify_root<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		match node.kind() {
			// ── Imports ──
			"import_declaration"
			| "using_directive"
			| "package_declaration"
			| "namespace_statement" => Some(group_candidate(node, "imports", source)),

			// ── Functions ──
			"method_declaration" => Some(named_candidate(
				node,
				"meth",
				source,
				recurse_body(node, ChunkContext::FunctionBody),
			)),
			"function_declaration" | "function_definition" => Some(named_candidate(
				node,
				"fn",
				source,
				recurse_body(node, ChunkContext::FunctionBody),
			)),

			// ── Constructors ──
			"constructor_declaration" => Some(make_named_chunk(
				node,
				"constructor".to_string(),
				source,
				recurse_body(node, ChunkContext::FunctionBody),
			)),

			// ── Containers ──
			"class_declaration" => {
				Some(container_candidate(node, "class", source, recurse_class(node)))
			},
			"interface_declaration" => {
				Some(container_candidate(node, "iface", source, recurse_interface(node)))
			},
			"enum_declaration" => Some(container_candidate(node, "enum", source, recurse_enum(node))),
			"namespace_declaration" | "file_scoped_namespace_declaration" => {
				Some(container_candidate(node, "mod", source, recurse_class(node)))
			},
			"struct_declaration" | "record_declaration" => {
				Some(container_candidate(node, "struct", source, recurse_class(node)))
			},

			// ── Types ──
			"type_alias_declaration" => {
				Some(named_candidate(node, "type", source, recurse_class(node)))
			},

			// ── Variables / assignments ──
			"variable_declaration" | "lexical_declaration" => Some(classify_var_decl(node, source)),
			"property_declaration" | "state_variable_declaration" => {
				Some(group_candidate(node, "decls", source))
			},

			// ── Control flow (top-level scripts) ──
			"if_statement" | "switch_statement" | "switch_expression" | "for_statement"
			| "foreach_statement" | "while_statement" | "do_statement" | "try_statement" => {
				Some(classify_function_csharp_java(node, source))
			},

			// ── Statements ──
			"expression_statement" => Some(group_candidate(node, "stmts", source)),

			_ => None,
		}
	}

	fn classify_class<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		match node.kind() {
			// ── Container declarations (inside namespace/class bodies) ──
			"class_declaration" => {
				Some(container_candidate(node, "class", source, recurse_class(node)))
			},
			"interface_declaration" => {
				Some(container_candidate(node, "iface", source, recurse_interface(node)))
			},
			"enum_declaration" => Some(container_candidate(node, "enum", source, recurse_enum(node))),
			"struct_declaration" | "record_declaration" => {
				Some(container_candidate(node, "struct", source, recurse_class(node)))
			},
			"namespace_declaration" | "file_scoped_namespace_declaration" => {
				Some(container_candidate(node, "mod", source, recurse_class(node)))
			},

			// ── Methods ──
			"method_declaration" | "function_declaration" | "function_definition" => {
				let name = extract_identifier(node, source).unwrap_or_else(|| "anonymous".to_string());
				if name == "constructor" {
					Some(make_named_chunk(
						node,
						"constructor".to_string(),
						source,
						recurse_body(node, ChunkContext::FunctionBody),
					))
				} else {
					Some(make_named_chunk(
						node,
						format!("fn_{name}"),
						source,
						recurse_body(node, ChunkContext::FunctionBody),
					))
				}
			},

			// ── Constructors ──
			"constructor_declaration" | "secondary_constructor" => Some(make_named_chunk(
				node,
				"constructor".to_string(),
				source,
				recurse_body(node, ChunkContext::FunctionBody),
			)),

			// ── Fields ──
			"field_declaration"
			| "property_declaration"
			| "constant_declaration"
			| "event_field_declaration" => Some(match extract_field_name(node, source) {
				Some(name) => make_named_chunk(node, format!("field_{name}"), source, None),
				None => group_candidate(node, "fields", source),
			}),

			// ── Enum members ──
			"enum_member_declaration" | "enum_constant" | "enum_entry" => {
				Some(match extract_identifier(node, source) {
					Some(name) => make_named_chunk(node, format!("variant_{name}"), source, None),
					None => group_candidate(node, "variants", source),
				})
			},

			// ── Static blocks ──
			"class_static_block" => {
				Some(make_named_chunk(node, "static_init".to_string(), source, None))
			},

			_ => None,
		}
	}

	fn classify_function<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		Some(classify_function_csharp_java(node, source))
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
			make_candidate(node, "if".to_string(), NameStyle::Named, None, fn_recurse(), false, source)
		},
		"switch_statement" | "switch_expression" => make_candidate(
			node,
			"switch".to_string(),
			NameStyle::Named,
			None,
			fn_recurse(),
			false,
			source,
		),
		"try_statement" | "catch_clause" | "finally_clause" => make_candidate(
			node,
			"try".to_string(),
			NameStyle::Named,
			None,
			fn_recurse(),
			false,
			source,
		),
		"for_statement" => make_candidate(
			node,
			"for".to_string(),
			NameStyle::Named,
			None,
			fn_recurse(),
			false,
			source,
		),
		"foreach_statement" => make_candidate(
			node,
			"for".to_string(),
			NameStyle::Named,
			None,
			fn_recurse(),
			false,
			source,
		),
		"while_statement" => make_candidate(
			node,
			"while".to_string(),
			NameStyle::Named,
			None,
			fn_recurse(),
			false,
			source,
		),
		"do_statement" => make_candidate(
			node,
			"block".to_string(),
			NameStyle::Named,
			None,
			fn_recurse(),
			false,
			source,
		),
		"variable_declaration" | "lexical_declaration" => {
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
