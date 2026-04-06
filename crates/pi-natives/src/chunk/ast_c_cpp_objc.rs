//! Language-specific chunk classifiers for C, C++, and Objective-C.

use tree_sitter::Node;

use super::{classify::LangClassifier, common::*, defaults::classify_var_decl};

pub struct CCppClassifier;

// ── C/C++ declarator name extraction ────────────────────────────────────

/// Extract the function name from a C/C++ `function_definition` or
/// `function_declaration` node by traversing into the `declarator` chain.
fn extract_c_function_name(node: Node<'_>, source: &str) -> Option<String> {
	let decl = node.child_by_field_name("declarator")?;
	extract_c_declarator_name(decl, source)
}

/// Recursively resolve a C/C++ declarator to its leaf identifier.
/// Handles `function_declarator`, `pointer_declarator`, `reference_declarator`,
/// `qualified_identifier`, `destructor_name`, `template_function`, etc.
fn extract_c_declarator_name(node: Node<'_>, source: &str) -> Option<String> {
	match node.kind() {
		"identifier" | "field_identifier" | "type_identifier" => {
			sanitize_identifier(node_text(source, node.start_byte(), node.end_byte()))
		},
		"destructor_name" => {
			// ~ClassName
			sanitize_identifier(node_text(source, node.start_byte(), node.end_byte()))
		},
		"qualified_identifier" | "scoped_identifier" => {
			// e.g. Entity::update — extract the "name" field or last identifier
			node
				.child_by_field_name("name")
				.and_then(|n| extract_c_declarator_name(n, source))
				.or_else(|| {
					named_children(node)
						.into_iter()
						.rev()
						.find(|c| {
							matches!(
								c.kind(),
								"identifier" | "destructor_name" | "template_function" | "field_identifier"
							)
						})
						.and_then(|c| extract_c_declarator_name(c, source))
				})
		},
		"template_function" => {
			// template_function has a "name" field or direct identifier child
			node
				.child_by_field_name("name")
				.and_then(|n| sanitize_identifier(node_text(source, n.start_byte(), n.end_byte())))
				.or_else(|| {
					named_children(node)
						.into_iter()
						.find(|c| c.kind() == "identifier")
						.and_then(|c| {
							sanitize_identifier(node_text(source, c.start_byte(), c.end_byte()))
						})
				})
		},
		_ => {
			// function_declarator, pointer_declarator, reference_declarator, etc.
			// recurse into the "declarator" field
			node
				.child_by_field_name("declarator")
				.and_then(|inner| extract_c_declarator_name(inner, source))
				.or_else(|| {
					// fallback: look for direct identifier-like child
					named_children(node)
						.into_iter()
						.find(|c| {
							matches!(
								c.kind(),
								"identifier"
									| "field_identifier"
									| "qualified_identifier"
									| "scoped_identifier"
									| "destructor_name"
									| "template_function"
							)
						})
						.and_then(|c| extract_c_declarator_name(c, source))
				})
		},
	}
}

/// Extract the field name from a C/C++ `field_declaration` node.
/// The name sits in the `declarator` field which may be a plain
/// `field_identifier`, or a `function_declarator` / `pointer_declarator` etc.
fn extract_c_field_name(node: Node<'_>, source: &str) -> Option<String> {
	let decl = node.child_by_field_name("declarator")?;
	extract_c_declarator_name(decl, source)
}

/// Build a prefixed name for a C/C++ function node using declarator traversal.
fn c_prefixed_fn_name(prefix: &str, node: Node<'_>, source: &str) -> String {
	let identifier =
		extract_c_function_name(node, source).unwrap_or_else(|| "anonymous".to_string());
	format!("{prefix}_{identifier}")
}

impl LangClassifier for CCppClassifier {
	fn classify_root<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		match node.kind() {
			// ── Imports ──
			"include_directive" | "preproc_include" | "using_directive" | "using_statement"
			| "import_declaration" | "module_import" => Some(group_candidate(node, "imports", source)),

			// ── Functions ──
			"function_definition" | "function_declaration" => Some(make_named_chunk(
				node,
				c_prefixed_fn_name("fn", node, source),
				source,
				recurse_body(node, ChunkContext::FunctionBody),
			)),
			"constructor_definition" => Some(make_named_chunk(
				node,
				"constructor".to_string(),
				source,
				recurse_body(node, ChunkContext::FunctionBody),
			)),

			// ── Templates (unwrap to find the inner declaration) ──
			"template_declaration" => {
				// Find the inner function_definition / class_specifier / etc.
				let inner = named_children(node).into_iter().find(|c| {
					matches!(
						c.kind(),
						"function_definition"
							| "function_declaration"
							| "class_specifier"
							| "struct_specifier"
							| "type_alias_declaration"
					)
				});
				match inner {
					Some(inner) => {
						let mut candidate = self.classify_root(inner, source)?;
						// Expand range to include the template<...> prefix
						candidate.range_start_byte = node.start_byte();
						candidate.range_start_line = node.start_position().row + 1;
						candidate.checksum_start_byte = node.start_byte();
						Some(candidate)
					},
					None => Some(named_candidate(
						node,
						"template",
						source,
						recurse_body(node, ChunkContext::FunctionBody),
					)),
				}
			},

			// ── Containers ──
			"class_specifier" | "class_declaration" | "class_interface" | "class_implementation" => {
				Some(container_candidate(node, "class", source, recurse_class(node)))
			},
			"struct_specifier" | "struct_declaration" => {
				Some(container_candidate(node, "struct", source, recurse_class(node)))
			},
			"enum_specifier" | "enum_declaration" => {
				Some(container_candidate(node, "enum", source, recurse_enum(node)))
			},
			"namespace_definition" => {
				Some(container_candidate(node, "mod", source, recurse_class(node)))
			},
			"union_declaration" => {
				Some(container_candidate(node, "union", source, recurse_class(node)))
			},

			// ── Types ──
			"type_alias_declaration" | "user_defined_type_definition" => {
				Some(named_candidate(node, "type", source, recurse_class(node)))
			},

			// ── Variables / assignments ──
			"variable_declaration" => Some(classify_var_decl(node, source)),
			"assignment_statement" | "property_declaration" => {
				Some(group_candidate(node, "decls", source))
			},

			// ── Macros ──
			"macro_definition" => Some(named_candidate(
				node,
				"macro",
				source,
				recurse_body(node, ChunkContext::FunctionBody),
			)),

			// ── Control flow (top-level scripts) ──
			"if_statement" | "switch_statement" | "for_statement" | "while_statement"
			| "do_statement" | "try_block" => Some(classify_function_c(node, source)),

			// ── Statements ──
			"expression_statement" => Some(group_candidate(node, "stmts", source)),

			_ => None,
		}
	}

	fn classify_class<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		match node.kind() {
			// ── Methods ──
			"function_definition" | "function_declaration" | "method_declaration" => {
				let name = extract_c_function_name(node, source)
					.or_else(|| extract_identifier(node, source))
					.unwrap_or_else(|| "anonymous".to_string());
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
			"constructor_definition" | "constructor_declaration" => Some(make_named_chunk(
				node,
				"constructor".to_string(),
				source,
				recurse_body(node, ChunkContext::FunctionBody),
			)),

			// ── Fields ──
			"field_declaration" => Some(match extract_c_field_name(node, source) {
				Some(name) => make_named_chunk(node, format!("field_{name}"), source, None),
				None => group_candidate(node, "fields", source),
			}),

			// ── Enum variants ──
			"enum_constant" => Some(match extract_identifier(node, source) {
				Some(name) => make_named_chunk(node, format!("variant_{name}"), source, None),
				None => group_candidate(node, "variants", source),
			}),

			// ── Nested containers ──
			"class_specifier" | "class_declaration" | "class_interface" | "class_implementation" => {
				Some(container_candidate(node, "class", source, recurse_class(node)))
			},
			"struct_specifier" | "struct_declaration" => {
				Some(container_candidate(node, "struct", source, recurse_class(node)))
			},
			"enum_specifier" | "enum_declaration" => {
				Some(container_candidate(node, "enum", source, recurse_enum(node)))
			},
			"union_declaration" => {
				Some(container_candidate(node, "union", source, recurse_class(node)))
			},
			"namespace_definition" => {
				Some(container_candidate(node, "mod", source, recurse_class(node)))
			},

			// ── Templates (class body) ──
			"template_declaration" => {
				let inner = named_children(node).into_iter().find(|c| {
					matches!(
						c.kind(),
						"function_definition"
							| "function_declaration"
							| "class_specifier"
							| "struct_specifier"
							| "type_alias_declaration"
					)
				});
				match inner {
					Some(inner) => {
						let mut candidate = self.classify_class(inner, source)?;
						candidate.range_start_byte = node.start_byte();
						candidate.range_start_line = node.start_position().row + 1;
						candidate.checksum_start_byte = node.start_byte();
						Some(candidate)
					},
					None => Some(named_candidate(
						node,
						"template",
						source,
						recurse_body(node, ChunkContext::FunctionBody),
					)),
				}
			},

			// ── Types ──
			"type_alias_declaration" => Some(named_candidate(node, "type", source, None)),

			_ => None,
		}
	}

	fn classify_function<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		Some(classify_function_c(node, source))
	}
}

fn classify_function_c<'tree>(node: Node<'tree>, source: &str) -> RawChunkCandidate<'tree> {
	let fn_recurse = || recurse_body(node, ChunkContext::FunctionBody);
	match node.kind() {
		"if_statement" => {
			make_candidate(node, "if".to_string(), NameStyle::Named, None, fn_recurse(), false, source)
		},
		"switch_statement" => make_candidate(
			node,
			"switch".to_string(),
			NameStyle::Named,
			None,
			fn_recurse(),
			false,
			source,
		),
		"try_block" | "catch_clause" | "finally_clause" => make_candidate(
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
		"variable_declaration" => {
			let span = line_span(node.start_position().row + 1, node.end_position().row + 1);
			if span > 1 {
				if let Some(name) = extract_single_declarator_name(node, source) {
					make_named_chunk(node, format!("var_{name}"), source, None)
				} else {
					group_candidate(node, "variable", source)
				}
			} else {
				group_candidate(node, "variable", source)
			}
		},
		_ => {
			let kind_name = sanitize_node_kind(node.kind());
			group_candidate(node, &kind_name, source)
		},
	}
}
