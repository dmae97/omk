//! Language-specific chunk classifiers for Markdown and Handlebars.

use tree_sitter::Node;

use super::{classify::LangClassifier, common::*};

pub struct MarkupClassifier;

impl MarkupClassifier {
	fn classify_section<'t>(node: Node<'t>, source: &str) -> RawChunkCandidate<'t> {
		let name = extract_markdown_heading(node, source).unwrap_or_else(|| "anonymous".to_string());
		make_container_chunk(
			node,
			format!("section_{name}"),
			source,
			Some(recurse_self(node, ChunkContext::ClassBody)),
		)
	}

	fn classify_block_statement<'t>(node: Node<'t>, source: &str) -> RawChunkCandidate<'t> {
		let name =
			extract_glimmer_block_name(node, source).unwrap_or_else(|| "anonymous".to_string());
		make_container_chunk(
			node,
			format!("block_{name}"),
			source,
			Some(recurse_self(node, ChunkContext::ClassBody)),
		)
	}

	fn classify_mustache_statement<'t>(node: Node<'t>, source: &str) -> RawChunkCandidate<'t> {
		let name =
			extract_glimmer_mustache_name(node, source).unwrap_or_else(|| "anonymous".to_string());
		make_named_chunk(node, format!("mustache_{name}"), source, None)
	}

	/// Classify HTML-like element nodes that appear inside handlebars blocks.
	fn classify_element<'t>(node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		match node.kind() {
			"element" | "script_element" | "style_element" | "element_node" => {
				let name =
					extract_element_tag_name(node, source).unwrap_or_else(|| "anonymous".to_string());
				Some(make_container_chunk(
					node,
					format!("tag_{name}"),
					source,
					Some(recurse_self(node, ChunkContext::ClassBody)),
				))
			},
			"text_node" => Some(group_candidate(node, "text", source)),
			_ => None,
		}
	}
}

impl LangClassifier for MarkupClassifier {
	fn classify_root<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		match node.kind() {
			"section" => Some(Self::classify_section(node, source)),
			"block_statement" => Some(Self::classify_block_statement(node, source)),
			"mustache_statement" => Some(Self::classify_mustache_statement(node, source)),
			"element" | "script_element" | "style_element" | "element_node" | "text_node" => {
				Self::classify_element(node, source)
			},
			_ => None,
		}
	}

	fn classify_class<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		match node.kind() {
			"section" => Some(Self::classify_section(node, source)),
			"block_statement" => Some(Self::classify_block_statement(node, source)),
			"mustache_statement" => Some(Self::classify_mustache_statement(node, source)),
			"element" | "script_element" | "style_element" | "element_node" | "text_node" => {
				Self::classify_element(node, source)
			},
			_ => None,
		}
	}

	fn classify_function<'t>(
		&self,
		_node: Node<'t>,
		_source: &str,
	) -> Option<RawChunkCandidate<'t>> {
		None
	}
}

/// Extract heading text from a Markdown `section` node's `atx_heading` or
/// `setext_heading` child.
fn extract_markdown_heading(node: Node<'_>, source: &str) -> Option<String> {
	named_children(node)
		.into_iter()
		.find(|child| child.kind() == "atx_heading" || child.kind() == "setext_heading")
		.and_then(|heading| {
			sanitize_identifier(node_text(source, heading.start_byte(), heading.end_byte()))
		})
}

/// Extract name from a Handlebars `block_statement` via its
/// `block_statement_start` child.
fn extract_glimmer_block_name(node: Node<'_>, source: &str) -> Option<String> {
	child_by_kind(node, &["block_statement_start"]).and_then(|start| {
		start
			.child_by_field_name("path")
			.or_else(|| child_by_kind(start, &["identifier"]))
			.and_then(|name| {
				sanitize_identifier(node_text(source, name.start_byte(), name.end_byte()))
			})
	})
}

/// Extract name from a Handlebars `mustache_statement`:
/// tries `helper_invocation`'s helper field first, then direct
/// `identifier`/`path_expression`.
fn extract_glimmer_mustache_name(node: Node<'_>, source: &str) -> Option<String> {
	let children = named_children(node);
	for child in children {
		if child.kind() == "helper_invocation"
			&& let Some(helper) = child
				.child_by_field_name("helper")
				.or_else(|| child_by_kind(child, &["identifier", "path_expression"]))
		{
			return sanitize_identifier(node_text(source, helper.start_byte(), helper.end_byte()));
		}
		if matches!(child.kind(), "identifier" | "path_expression") {
			return sanitize_identifier(node_text(source, child.start_byte(), child.end_byte()));
		}
	}
	None
}

/// Extract tag name from an HTML-like element node.
///
/// Handles both standard HTML (`element` → `start_tag`/`self_closing_tag` →
/// `tag_name`) and Handlebars element nodes (`element_node` →
/// `element_node_start`/`element_node_void` → `tag_name`).
fn extract_element_tag_name(node: Node<'_>, source: &str) -> Option<String> {
	// Handlebars element_node uses element_node_start / element_node_void
	if node.kind() == "element_node" {
		return named_children(node).into_iter().find_map(|child| {
			if child.kind() == "element_node_start" || child.kind() == "element_node_void" {
				child_by_kind(child, &["tag_name"]).and_then(|tag| {
					sanitize_identifier(node_text(source, tag.start_byte(), tag.end_byte()))
				})
			} else {
				None
			}
		});
	}

	// Standard HTML: element → start_tag / self_closing_tag → tag_name
	named_children(node).into_iter().find_map(|child| {
		if child.kind() == "start_tag" || child.kind() == "self_closing_tag" {
			child_by_kind(child, &["tag_name"]).and_then(|tag| {
				sanitize_identifier(node_text(source, tag.start_byte(), tag.end_byte()))
			})
		} else {
			None
		}
	})
}
