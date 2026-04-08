//! Language-specific chunk classifiers for CSS and SCSS.

use tree_sitter::Node;

use super::{classify::LangClassifier, common::*, kind::ChunkKind};

pub struct CssClassifier;

/// Extract a CSS selector name from a `rule_set` or `at_rule` node.
///
/// Tries known child kinds first (`selectors`, `selector_query`, `identifier`),
/// then falls back to parsing the normalised header text.
fn extract_css_selector(node: Node<'_>, source: &str) -> Option<String> {
	if let Some(sel) = child_by_kind(node, &["selectors", "selector_query", "identifier"]) {
		return sanitize_identifier(node_text(source, sel.start_byte(), sel.end_byte()));
	}
	let header = normalized_header(source, node.start_byte(), node.end_byte());
	let selector = header
		.trim_start_matches('@')
		.split('{')
		.next()
		.unwrap_or(header.as_str())
		.trim();
	sanitize_identifier(selector)
}

/// Classify a CSS `rule_set` as a named container.
fn classify_rule_set<'t>(node: Node<'t>, source: &str) -> RawChunkCandidate<'t> {
	let name = extract_css_selector(node, source).unwrap_or_else(|| "anonymous".to_string());
	make_container_chunk(
		node,
		ChunkKind::Rule,
		Some(name),
		source,
		recurse_into(node, ChunkContext::ClassBody, &[], &["block"]),
	)
}

/// Classify a CSS at-rule (`@media`, `@keyframes`, `@supports`, etc.) as a
/// named container.
fn classify_at_rule<'t>(node: Node<'t>, source: &str) -> RawChunkCandidate<'t> {
	let name = extract_css_selector(node, source).unwrap_or_else(|| "rule".to_string());
	make_container_chunk(
		node,
		ChunkKind::At,
		Some(name),
		source,
		recurse_into(node, ChunkContext::ClassBody, &[], &["block", "keyframe_block_list"]),
	)
}

/// Shared dispatch for CSS node kinds, used in both root and class-body
/// contexts.
fn classify_css_node<'t>(node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
	match node.kind() {
		"rule_set" => Some(classify_rule_set(node, source)),
		"at_rule" | "media_statement" | "keyframes_statement" | "supports_statement" => {
			Some(classify_at_rule(node, source))
		},
		"keyframe_block" => Some(named_candidate(
			node,
			ChunkKind::Frame,
			source,
			Some(recurse_self(node, ChunkContext::ClassBody)),
		)),
		"declaration" => Some(group_candidate(node, ChunkKind::Fields, source)),
		_ => None,
	}
}

impl LangClassifier for CssClassifier {
	fn classify_root<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		classify_css_node(node, source)
	}

	fn classify_class<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		classify_css_node(node, source)
	}

	fn classify_function<'t>(
		&self,
		_node: Node<'t>,
		_source: &str,
	) -> Option<RawChunkCandidate<'t>> {
		None
	}

	fn is_root_wrapper(&self, kind: &str) -> bool {
		kind == "stylesheet"
	}
}
