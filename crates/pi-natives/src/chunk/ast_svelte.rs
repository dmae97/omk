//! Language-specific chunk classifier for Svelte.

use tree_sitter::Node;

use super::{
	classify::{ClassifierTables, LangClassifier, StructuralOverrides},
	common::*,
	kind::ChunkKind,
};

pub struct SvelteClassifier;

impl LangClassifier for SvelteClassifier {
	fn tables(&self) -> &'static ClassifierTables {
		static TABLES: ClassifierTables = ClassifierTables {
			root:                 &[],
			class:                &[],
			function:             &[],
			structural_overrides: StructuralOverrides {
				extra_trivia:            &[],
				preserved_trivia:        &[],
				extra_root_wrappers:     &["document"],
				preserved_root_wrappers: &[],
				absorbable_attrs:        &[],
			},
		};
		&TABLES
	}

	fn classify_override<'t>(
		&self,
		context: ChunkContext,
		node: Node<'t>,
		source: &str,
	) -> Option<RawChunkCandidate<'t>> {
		let include_plain_elements = matches!(context, ChunkContext::Root);
		classify_svelte_node(node, source, include_plain_elements)
	}
}

fn classify_svelte_node<'t>(
	node: Node<'t>,
	source: &str,
	include_plain_elements: bool,
) -> Option<RawChunkCandidate<'t>> {
	match node.kind() {
		"script_element" => Some(classify_script_element(node, source)),
		"style_element" => Some(classify_style_element(node, source)),
		"snippet_statement" => Some(classify_snippet_statement(node, source)),
		"if_statement" => Some(classify_if_statement(node, source)),
		"else_if_statement" => Some(classify_else_if_statement(node, source)),
		"else_statement" => Some(classify_else_statement(node, source)),
		"each_statement" => Some(classify_each_statement(node, source)),
		"await_statement" => Some(classify_await_statement(node, source)),
		"then_statement" => Some(classify_then_statement(node, source)),
		"catch_statement" => Some(classify_catch_statement(node, source)),
		"render_expr" => Some(classify_render_expr(node, source)),
		"html_interpolation" => Some(group_candidate(node, ChunkKind::Html, source)),
		"interpolation" => Some(group_candidate(node, ChunkKind::Interpolation, source)),
		"expression" => Some(group_candidate(node, ChunkKind::Expression, source)),
		"element" if include_plain_elements || element_has_structure(node) => {
			classify_element(node, source)
		},
		_ => None,
	}
}

fn classify_script_element<'t>(node: Node<'t>, source: &str) -> RawChunkCandidate<'t> {
	let kind = if has_attribute(node, "module", source)
		|| attribute_value(node, "context", source).as_deref() == Some("module")
	{
		ChunkKind::ScriptModule
	} else {
		ChunkKind::Script
	};

	// The grammar exposes script contents as a single `raw_text` child, so the
	// element boundary is the most truthful chunk.
	positional_candidate(node, kind, source)
}

fn classify_style_element<'t>(node: Node<'t>, source: &str) -> RawChunkCandidate<'t> {
	let kind = if has_attribute(node, "scoped", source) {
		ChunkKind::StyleScoped
	} else {
		ChunkKind::Style
	};
	positional_candidate(node, kind, source)
}

fn classify_snippet_statement<'t>(node: Node<'t>, source: &str) -> RawChunkCandidate<'t> {
	let identifier = child_by_kind(node, &["snippet_start_expr"])
		.and_then(|start| child_by_kind(start, &["snippet_name"]))
		.and_then(|name| sanitize_identifier(node_text(source, name.start_byte(), name.end_byte())));
	force_container(make_container_chunk(
		node,
		ChunkKind::Snippet,
		identifier,
		source,
		Some(recurse_self(node, ChunkContext::ClassBody)),
	))
}

fn classify_if_statement<'t>(node: Node<'t>, source: &str) -> RawChunkCandidate<'t> {
	let identifier = block_expr_identifier(node, source, "if_start_expr", &["raw_text_expr"]);
	force_container(make_container_chunk(
		node,
		ChunkKind::If,
		identifier,
		source,
		Some(recurse_self(node, ChunkContext::ClassBody)),
	))
}

fn classify_else_if_statement<'t>(node: Node<'t>, source: &str) -> RawChunkCandidate<'t> {
	let identifier = block_expr_identifier(node, source, "else_if_expr", &["raw_text_expr"])
		.map_or_else(|| "if".to_string(), |expr| format!("if_{expr}"));
	make_named_container_chunk(node, ChunkKind::Else, identifier, source)
}

fn classify_else_statement<'t>(node: Node<'t>, source: &str) -> RawChunkCandidate<'t> {
	force_container(make_container_chunk(
		node,
		ChunkKind::Else,
		None,
		source,
		Some(recurse_self(node, ChunkContext::ClassBody)),
	))
}

fn classify_each_statement<'t>(node: Node<'t>, source: &str) -> RawChunkCandidate<'t> {
	let expr = block_expr_identifier(node, source, "each_start_expr", &["raw_text_each"]);
	let id = expr.map_or_else(|| "each".to_string(), |expr| format!("each_{expr}"));
	make_named_container_chunk(node, ChunkKind::Loop, id, source)
}

fn classify_await_statement<'t>(node: Node<'t>, source: &str) -> RawChunkCandidate<'t> {
	let expr = block_expr_identifier(node, source, "await_start_expr", &["raw_text_expr"]);
	let id = expr.map_or_else(|| "await".to_string(), |expr| format!("await_{expr}"));
	make_named_container_chunk(node, ChunkKind::With, id, source)
}

fn classify_then_statement<'t>(node: Node<'t>, source: &str) -> RawChunkCandidate<'t> {
	let expr = block_expr_identifier(node, source, "then_expr", &["raw_text_expr"]);
	let id = expr.map_or_else(|| "then".to_string(), |expr| format!("then_{expr}"));
	make_named_container_chunk(node, ChunkKind::After, id, source)
}

fn classify_catch_statement<'t>(node: Node<'t>, source: &str) -> RawChunkCandidate<'t> {
	let identifier = block_expr_identifier(node, source, "catch_expr", &["raw_text_expr"]);
	force_container(make_container_chunk(
		node,
		ChunkKind::Catch,
		identifier,
		source,
		Some(recurse_self(node, ChunkContext::ClassBody)),
	))
}

fn classify_render_expr<'t>(node: Node<'t>, source: &str) -> RawChunkCandidate<'t> {
	let identifier = child_by_kind(node, &["snippet_name"])
		.and_then(|name| sanitize_identifier(node_text(source, name.start_byte(), name.end_byte())));
	make_kind_chunk(node, ChunkKind::Render, identifier, source, None)
}

fn classify_element<'t>(node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
	let tag_name = extract_markup_tag_name(node, source)?;
	Some(force_container(make_container_chunk(
		node,
		ChunkKind::Tag,
		Some(tag_name),
		source,
		Some(recurse_self(node, ChunkContext::ClassBody)),
	)))
}

fn make_named_container_chunk<'t>(
	node: Node<'t>,
	kind: ChunkKind,
	identifier: impl Into<Option<String>>,
	source: &str,
) -> RawChunkCandidate<'t> {
	force_container(make_candidate(
		node,
		kind,
		identifier,
		NameStyle::Named,
		signature_for_node(node, source),
		Some(recurse_self(node, ChunkContext::ClassBody)),
		source,
	))
}

const fn force_container(mut candidate: RawChunkCandidate<'_>) -> RawChunkCandidate<'_> {
	candidate.force_recurse = true;
	candidate
}

fn block_expr_identifier(
	node: Node<'_>,
	source: &str,
	header_kind: &str,
	expr_kinds: &[&str],
) -> Option<String> {
	child_by_kind(node, &[header_kind])
		.and_then(|header| child_by_kind(header, expr_kinds))
		.and_then(|expr| sanitize_identifier(node_text(source, expr.start_byte(), expr.end_byte())))
}

fn element_has_structure(node: Node<'_>) -> bool {
	named_children(node).into_iter().any(|child| {
		matches!(
			child.kind(),
			"snippet_statement"
				| "if_statement"
				| "else_if_statement"
				| "else_statement"
				| "each_statement"
				| "await_statement"
				| "then_statement"
				| "catch_statement"
				| "render_expr"
				| "html_interpolation"
				| "interpolation"
				| "expression"
				| "element"
		)
	})
}

fn extract_markup_tag_name(node: Node<'_>, source: &str) -> Option<String> {
	start_like(node)
		.and_then(|start| child_by_kind(start, &["tag_name"]))
		.and_then(|tag| sanitize_identifier(node_text(source, tag.start_byte(), tag.end_byte())))
}

fn has_attribute(node: Node<'_>, name: &str, source: &str) -> bool {
	start_like(node)
		.into_iter()
		.flat_map(named_children)
		.filter(|child| child.kind() == "attribute")
		.filter_map(|attr| extract_attribute_name(attr, source))
		.any(|attr_name| attr_name == name)
}

fn attribute_value(node: Node<'_>, name: &str, source: &str) -> Option<String> {
	let start = start_like(node)?;
	for child in named_children(start) {
		if child.kind() != "attribute" {
			continue;
		}
		if extract_attribute_name(child, source).as_deref() != Some(name) {
			continue;
		}
		if let Some(value) = child_by_kind(child, &["attribute_value", "quoted_attribute_value"]) {
			return sanitize_identifier(&unquote_text(node_text(
				source,
				value.start_byte(),
				value.end_byte(),
			)));
		}
		return Some(name.to_string());
	}
	None
}

fn extract_attribute_name(node: Node<'_>, source: &str) -> Option<String> {
	child_by_kind(node, &["attribute_name"])
		.and_then(|name| sanitize_identifier(node_text(source, name.start_byte(), name.end_byte())))
}

fn start_like(node: Node<'_>) -> Option<Node<'_>> {
	child_by_kind(node, &["start_tag", "self_closing_tag"])
}
