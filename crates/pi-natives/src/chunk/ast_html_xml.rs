//! Language-specific chunk classifiers for HTML and XML.

use tree_sitter::Node;

use super::{classify::LangClassifier, common::*};

pub struct HtmlXmlClassifier;

/// Classify an element-like node as a container with tag semantics.
///
/// Uses `extract_markup_tag_name` directly because the shared
/// `extract_identifier` does not handle HTML/XML start-tag structures.
fn classify_element<'t>(node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
	match node.kind() {
		"element" | "script_element" | "style_element" => {
			let tag_name =
				extract_markup_tag_name(node, source).unwrap_or_else(|| "anonymous".to_string());
			// HTML: child elements are direct children of `element`.
			// XML: child elements are inside a `content` wrapper node.
			let recurse_target = child_by_kind(node, &["content"]).unwrap_or(node);
			Some(make_container_chunk(
				node,
				format!("tag_{tag_name}"),
				source,
				Some(recurse_self(recurse_target, ChunkContext::ClassBody)),
			))
		},
		"text_node" => Some(group_candidate(node, "text", source)),
		_ => None,
	}
}

/// Extract the tag name from an HTML/XML element node.
///
/// HTML: `element` → `start_tag`/`self_closing_tag` → `tag_name`
/// XML (tree-sitter-xml): `element` → `STag`/`EmptyElemTag` → `Name`
fn extract_markup_tag_name(node: Node<'_>, source: &str) -> Option<String> {
	named_children(node).into_iter().find_map(|child| {
		let tag_name_kinds: &[&str] = match child.kind() {
			// HTML
			"start_tag" | "self_closing_tag" => &["tag_name"],
			// XML (tree-sitter-xml grammar)
			"STag" | "EmptyElemTag" => &["Name"],
			_ => return None,
		};
		child_by_kind(child, tag_name_kinds)
			.and_then(|tag| sanitize_identifier(node_text(source, tag.start_byte(), tag.end_byte())))
	})
}

impl LangClassifier for HtmlXmlClassifier {
	fn classify_root<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		classify_element(node, source)
	}

	fn classify_class<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		classify_element(node, source)
	}

	fn classify_function<'t>(
		&self,
		_node: Node<'t>,
		_source: &str,
	) -> Option<RawChunkCandidate<'t>> {
		None
	}
}
