//! JavaScript / TypeScript / TSX chunk classifier.

use tree_sitter::Node;

use super::{
	classify::LangClassifier, common::*, defaults::promote_assigned_expression, kind::ChunkKind,
};

pub struct JsTsClassifier;

fn recurse_internal_module(node: Node<'_>) -> Option<RecurseSpec<'_>> {
	recurse_into(node, ChunkContext::ClassBody, &["body"], &["statement_block"])
}

impl LangClassifier for JsTsClassifier {
	fn classify_root<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		match node.kind() {
			// ── Exports / decorators ──
			"export_statement" => Some(classify_export_statement(node, source)),
			"decorated_definition" => Some(classify_decorated(node, source)),

			// ── Imports ──
			"import_statement" | "import_declaration" => {
				Some(group_candidate(node, ChunkKind::Imports, source))
			},

			// ── Variables ──
			"lexical_declaration" | "variable_declaration" => {
				// Must handle here to ensure promote_assigned_expression runs.
				// The shared defaults classify_var_decl should do this, but we
				// need direct control for JS/TS patterns.
				Some(classify_var_decl_js(node, source))
			},

			// ── Functions ──
			"function_declaration" => Some(named_candidate(
				node,
				ChunkKind::Function,
				source,
				recurse_body(node, ChunkContext::FunctionBody),
			)),

			// ── Containers ──
			"class_declaration" => {
				Some(container_candidate(node, ChunkKind::Class, source, recurse_class(node)))
			},
			"interface_declaration" => {
				Some(container_candidate(node, ChunkKind::Interface, source, recurse_interface(node)))
			},
			"enum_declaration" => {
				Some(container_candidate(node, ChunkKind::Enum, source, recurse_enum(node)))
			},
			"internal_module" => Some(container_candidate(
				node,
				ChunkKind::Module,
				source,
				recurse_internal_module(node),
			)),

			// ── Types ──
			"type_alias_declaration" => Some(named_candidate(node, ChunkKind::Type, source, None)),

			// ── Control flow at top level ──
			"if_statement" | "switch_statement" | "switch_expression" | "try_statement"
			| "for_statement" | "for_in_statement" | "for_of_statement" | "while_statement"
			| "do_statement" | "with_statement" => Some(classify_function_js(node, source)),

			// ── Statements ──
			"expression_statement" => {
				// Unwrap `expression_statement` wrapping an `internal_module` (namespace).
				let inner = named_children(node)
					.into_iter()
					.find(|c| c.kind() == "internal_module");
				if let Some(ns) = inner {
					Some(container_candidate(ns, ChunkKind::Module, source, recurse_internal_module(ns)))
				} else {
					Some(group_candidate(node, ChunkKind::Statements, source))
				}
			},

			_ => None,
		}
	}

	fn classify_class<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		match node.kind() {
			// ── Exports / decorators (re-exported members) ──
			"export_statement" => Some(classify_export_statement(node, source)),
			"decorated_definition" => Some(classify_decorated(node, source)),

			// ── Variables ──
			"lexical_declaration" | "variable_declaration" => Some(classify_var_decl_js(node, source)),

			// ── Constructor ──
			"constructor" => Some(make_kind_chunk(
				node,
				ChunkKind::Constructor,
				None,
				source,
				recurse_body(node, ChunkContext::FunctionBody),
			)),

			// ── Methods ──
			"method_definition" | "method_signature" | "abstract_method_signature" => {
				let name = extract_identifier(node, source).unwrap_or_else(|| "anonymous".to_string());
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

			// ── Fields ──
			"public_field_definition"
			| "field_definition"
			| "property_definition"
			| "property_signature"
			| "property_declaration"
			| "abstract_class_field" => match extract_identifier(node, source) {
				Some(name) => Some(make_kind_chunk(node, ChunkKind::Field, Some(name), source, None)),
				None => Some(group_candidate(node, ChunkKind::Fields, source)),
			},

			// ── Enum members ──
			"enum_assignment" | "enum_member_declaration" => match extract_identifier(node, source) {
				Some(name) => Some(make_kind_chunk(node, ChunkKind::Variant, Some(name), source, None)),
				None => Some(group_candidate(node, ChunkKind::Variants, source)),
			},

			// ── Static blocks ──
			"class_static_block" => {
				Some(make_kind_chunk(node, ChunkKind::StaticInit, None, source, None))
			},

			// ── Types ──
			"type_alias_declaration" => Some(named_candidate(node, ChunkKind::Type, source, None)),

			_ => None,
		}
	}

	fn classify_function<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		Some(classify_function_js(node, source))
	}
}

// ── Function body classification (JS/TS) ────────────────────────────────

/// Classify nodes inside a function body for JS/TS.
fn classify_function_js<'t>(node: Node<'t>, source: &str) -> RawChunkCandidate<'t> {
	let fn_recurse = || recurse_body(node, ChunkContext::FunctionBody);
	match node.kind() {
		// ── Control flow ──
		"if_statement" => {
			make_candidate(node, ChunkKind::If, None, NameStyle::Named, None, fn_recurse(), source)
		},
		"switch_statement" | "switch_expression" => {
			make_candidate(node, ChunkKind::Switch, None, NameStyle::Named, None, fn_recurse(), source)
		},
		"try_statement" => {
			make_candidate(node, ChunkKind::Try, None, NameStyle::Named, None, fn_recurse(), source)
		},

		// ── Loops ──
		"for_statement" => {
			make_candidate(node, ChunkKind::For, None, NameStyle::Named, None, fn_recurse(), source)
		},
		"for_in_statement" => {
			make_candidate(node, ChunkKind::ForIn, None, NameStyle::Named, None, fn_recurse(), source)
		},
		"for_of_statement" => {
			make_candidate(node, ChunkKind::ForOf, None, NameStyle::Named, None, fn_recurse(), source)
		},
		"while_statement" => {
			make_candidate(node, ChunkKind::While, None, NameStyle::Named, None, fn_recurse(), source)
		},
		"do_statement" => {
			make_candidate(node, ChunkKind::Block, None, NameStyle::Named, None, fn_recurse(), source)
		},

		// ── Blocks ──
		"with_statement" => {
			make_candidate(node, ChunkKind::Block, None, NameStyle::Named, None, fn_recurse(), source)
		},

		// ── Variables ──
		"lexical_declaration" | "variable_declaration" => {
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

		// ── Fallback ──
		_ => group_from_sanitized(node, source),
	}
}

// ── Variable declaration (JS/TS) ────────────────────────────────────────

/// Classify `const`/`let`/`var` declarations, promoting arrow functions
/// and class expressions to fn_/class_ chunks.
fn classify_var_decl_js<'t>(node: Node<'t>, source: &str) -> RawChunkCandidate<'t> {
	// Inline promotion logic — look for single variable_declarator with fn/class
	// value.
	let declarators: Vec<Node<'t>> = named_children(node)
		.into_iter()
		.filter(|c| c.kind() == "variable_declarator")
		.collect();
	if declarators.len() == 1 {
		let decl = declarators[0];
		if let Some(value) = decl.child_by_field_name("value") {
			let name = extract_identifier(decl, source).unwrap_or_else(|| "anonymous".to_string());
			match value.kind() {
				"arrow_function" | "function_expression" | "function" => {
					let recurse = recurse_body(value, ChunkContext::FunctionBody);
					return make_kind_chunk(node, ChunkKind::Function, Some(name), source, recurse);
				},
				"class" | "class_expression" => {
					let recurse = recurse_class(value);
					return make_container_chunk(node, ChunkKind::Class, Some(name), source, recurse);
				},
				_ => {},
			}
		}
	}
	// Not promoted — fall back to var_NAME or group.
	if let Some(name) = extract_single_declarator_name(node, source) {
		return make_kind_chunk(node, ChunkKind::Variable, Some(name), source, None);
	}
	group_candidate(node, ChunkKind::Declarations, source)
}

fn group_from_sanitized<'t>(node: Node<'t>, source: &str) -> RawChunkCandidate<'t> {
	let kind_name = sanitize_node_kind(node.kind());
	let kind = ChunkKind::from_sanitized_kind(kind_name.as_str());
	make_candidate(node, kind, kind_name, NameStyle::Group, None, None, source)
}

// ── Export statement ─────────────────────────────────────────────────────

/// Unwrap `export` / `export default` to classify the inner declaration.
///
/// Named exports delegate to the appropriate container/named-chunk builder;
/// `export default …` always maps to `default_export`.  Re-exports and
/// bare expression exports fall through to the `stmts` group.
fn classify_export_statement<'t>(node: Node<'t>, source: &str) -> RawChunkCandidate<'t> {
	let header = normalized_header(source, node.start_byte(), node.end_byte());
	let is_default = header.starts_with("export default");

	let inner = named_children(node)
		.into_iter()
		.find(|child| !is_trivia(child.kind()) && !child.is_error() && child.kind() != "comment");

	let Some(child) = inner else {
		// `export { foo } from "bar"` with no inner declaration node.
		return if is_default {
			make_kind_chunk(node, ChunkKind::DefaultExport, None, source, None)
		} else {
			group_candidate(node, ChunkKind::Statements, source)
		};
	};

	match child.kind() {
		"class_declaration" => {
			let recurse = recurse_class(child);
			if is_default {
				make_container_chunk_from(node, child, ChunkKind::DefaultExport, None, source, recurse)
			} else {
				make_container_chunk_from(
					node,
					child,
					ChunkKind::Class,
					extract_identifier(child, source),
					source,
					recurse,
				)
			}
		},
		"function_declaration"
		| "function"
		| "function_expression"
		| "arrow_function"
		| "generator_function"
		| "generator_function_declaration" => {
			let recurse = recurse_body(child, ChunkContext::FunctionBody);
			if is_default {
				make_kind_chunk_from(node, child, ChunkKind::DefaultExport, None, source, recurse)
			} else {
				make_kind_chunk_from(
					node,
					child,
					ChunkKind::Function,
					extract_identifier(child, source),
					source,
					recurse,
				)
			}
		},
		"interface_declaration" => {
			let recurse = recurse_interface(child);
			if is_default {
				make_container_chunk_from(node, child, ChunkKind::DefaultExport, None, source, recurse)
			} else {
				make_container_chunk_from(
					node,
					child,
					ChunkKind::Interface,
					extract_identifier(child, source),
					source,
					recurse,
				)
			}
		},
		"type_alias_declaration" => {
			if is_default {
				make_kind_chunk_from(node, child, ChunkKind::DefaultExport, None, source, None)
			} else {
				make_kind_chunk_from(
					node,
					child,
					ChunkKind::Type,
					extract_identifier(child, source),
					source,
					None,
				)
			}
		},
		"enum_declaration" => {
			let recurse = recurse_enum(child);
			if is_default {
				make_container_chunk_from(node, child, ChunkKind::DefaultExport, None, source, recurse)
			} else {
				make_container_chunk_from(
					node,
					child,
					ChunkKind::Enum,
					extract_identifier(child, source),
					source,
					recurse,
				)
			}
		},
		"internal_module" => {
			let recurse = recurse_internal_module(child);
			if is_default {
				make_container_chunk_from(node, child, ChunkKind::DefaultExport, None, source, recurse)
			} else {
				make_container_chunk_from(
					node,
					child,
					ChunkKind::Module,
					extract_identifier(child, source),
					source,
					recurse,
				)
			}
		},
		"lexical_declaration" | "variable_declaration" => {
			if is_default {
				make_kind_chunk_from(node, child, ChunkKind::DefaultExport, None, source, None)
			} else {
				promote_assigned_expression(node, child, source)
					.unwrap_or_else(|| super::defaults::classify_var_decl(child, source))
			}
		},
		_ => {
			// expression_statement, re-exports, or anything else.
			if is_default {
				make_kind_chunk_from(node, child, ChunkKind::DefaultExport, None, source, None)
			} else {
				group_candidate(child, ChunkKind::Statements, source)
			}
		},
	}
}

/// Unwrap `@decorator` wrappers (TS/Python `decorated_definition`) to find
/// the inner class or function definition.
fn classify_decorated<'t>(node: Node<'t>, source: &str) -> RawChunkCandidate<'t> {
	let inner = named_children(node).into_iter().find(|c| {
		matches!(
			c.kind(),
			"class_declaration" | "class_definition" | "function_declaration" | "function_definition"
		)
	});

	match inner {
		Some(child) if child.kind() == "class_declaration" || child.kind() == "class_definition" => {
			let recurse = recurse_class(child);
			make_container_chunk(
				node,
				ChunkKind::Class,
				extract_identifier(child, source),
				source,
				recurse,
			)
		},
		Some(child) => {
			// function_declaration | function_definition
			let name = extract_identifier(child, source).unwrap_or_else(|| "anonymous".to_string());
			make_kind_chunk(node, ChunkKind::Function, Some(name), source, {
				let context = ChunkContext::FunctionBody;
				recurse_into(child, context, &["body"], &["block"])
			})
		},
		None => positional_candidate(node, ChunkKind::Block, source),
	}
}
