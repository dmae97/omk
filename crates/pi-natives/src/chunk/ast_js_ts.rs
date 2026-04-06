//! JavaScript / TypeScript / TSX chunk classifier.

use tree_sitter::Node;

use super::{classify::LangClassifier, common::*, defaults::promote_assigned_expression};

pub struct JsTsClassifier;

impl LangClassifier for JsTsClassifier {
	fn classify_root<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		match node.kind() {
			"export_statement" => Some(classify_export_statement(node, source)),
			"decorated_definition" => Some(classify_decorated(node, source)),
			"lexical_declaration" | "variable_declaration" => {
				// Must handle here to ensure promote_assigned_expression runs.
				// The shared defaults classify_var_decl should do this, but we
				// need direct control for JS/TS patterns.
				Some(classify_var_decl_js(node, source))
			},
			_ => None,
		}
	}

	fn classify_class<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		match node.kind() {
			"method_definition" => {
				let name = extract_identifier(node, source).unwrap_or_else(|| "anonymous".to_string());
				if name == "constructor" {
					Some(make_named_chunk(
						node,
						"constructor".to_string(),
						source,
						recurse_body(node, ChunkContext::FunctionBody),
					))
				} else {
					None // let defaults handle normal methods
				}
			},
			_ => None,
		}
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
					return make_named_chunk(node, format!("fn_{name}"), source, recurse);
				},
				"class" | "class_expression" => {
					let recurse = recurse_class(value);
					return make_container_chunk(node, format!("class_{name}"), source, recurse);
				},
				_ => {},
			}
		}
	}
	// Not promoted — fall back to var_NAME or group.
	if let Some(name) = extract_single_declarator_name(node, source) {
		return make_named_chunk(node, format!("var_{name}"), source, None);
	}
	group_candidate(node, "decls", source)
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
			make_named_chunk(node, "default_export".to_string(), source, None)
		} else {
			group_candidate(node, "stmts", source)
		};
	};

	match child.kind() {
		"class_declaration" => {
			let recurse = recurse_class(child);
			if is_default {
				make_container_chunk_from(node, child, "default_export".to_string(), source, recurse)
			} else {
				make_container_chunk_from(
					node,
					child,
					prefixed_name("class", child, source),
					source,
					recurse,
				)
			}
		},
		"function_declaration" => {
			let recurse = recurse_body(child, ChunkContext::FunctionBody);
			if is_default {
				make_named_chunk_from(node, child, "default_export".to_string(), source, recurse)
			} else {
				make_named_chunk_from(node, child, prefixed_name("fn", child, source), source, recurse)
			}
		},
		"interface_declaration" => {
			let recurse = recurse_interface(child);
			if is_default {
				make_container_chunk_from(node, child, "default_export".to_string(), source, recurse)
			} else {
				make_container_chunk_from(
					node,
					child,
					prefixed_name("iface", child, source),
					source,
					recurse,
				)
			}
		},
		"type_alias_declaration" => {
			if is_default {
				make_named_chunk_from(node, child, "default_export".to_string(), source, None)
			} else {
				make_named_chunk_from(node, child, prefixed_name("type", child, source), source, None)
			}
		},
		"enum_declaration" => {
			let recurse = recurse_enum(child);
			if is_default {
				make_container_chunk_from(node, child, "default_export".to_string(), source, recurse)
			} else {
				make_container_chunk_from(
					node,
					child,
					prefixed_name("enum", child, source),
					source,
					recurse,
				)
			}
		},
		"lexical_declaration" | "variable_declaration" => {
			if is_default {
				make_named_chunk_from(node, child, "default_export".to_string(), source, None)
			} else {
				promote_assigned_expression(node, child, source)
					.unwrap_or_else(|| super::defaults::classify_var_decl(child, source))
			}
		},
		_ => {
			// expression_statement, re-exports, or anything else.
			if is_default {
				make_named_chunk_from(node, child, "default_export".to_string(), source, None)
			} else {
				group_candidate(child, "stmts", source)
			}
		},
	}
}

// ── Decorated definition ─────────────────────────────────────────────────

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
			make_container_chunk(node, prefixed_name("class", child, source), source, recurse)
		},
		Some(child) => {
			// function_declaration | function_definition
			let name = extract_identifier(child, source).unwrap_or_else(|| "anonymous".to_string());
			make_named_chunk(node, format!("fn_{name}"), source, {
				let context = ChunkContext::FunctionBody;
				recurse_into(child, context, &["body"], &["block"])
			})
		},
		None => positional_candidate(node, "block", source),
	}
}
