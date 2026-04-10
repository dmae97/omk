//! Language-specific chunk classifiers for HTML and XML.

use tree_sitter::Node;

use super::{
	classify::{
		ClassifierTables, LangClassifier, NamingMode, RecurseMode, RuleStyle, semantic_rule,
	},
	common::*,
	kind::ChunkKind,
};

pub struct HtmlXmlClassifier;

const HTML_XML_SHARED_RULES: &[super::classify::SemanticRule] = &[semantic_rule(
	"text_node",
	ChunkKind::Text,
	RuleStyle::Group,
	NamingMode::None,
	RecurseMode::None,
)];

const HTML_XML_TABLES: ClassifierTables = ClassifierTables {
	root:                 HTML_XML_SHARED_RULES,
	class:                HTML_XML_SHARED_RULES,
	function:             &[],
	structural_overrides: super::classify::StructuralOverrides::EMPTY,
};

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
				ChunkKind::Tag,
				Some(tag_name),
				source,
				Some(recurse_self(recurse_target, ChunkContext::ClassBody)),
			))
		},
		"text_node" => Some(group_candidate(node, ChunkKind::Text, source)),
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
	fn tables(&self) -> &'static ClassifierTables {
		&HTML_XML_TABLES
	}

	fn classify_override<'t>(
		&self,
		context: ChunkContext,
		node: Node<'t>,
		source: &str,
	) -> Option<RawChunkCandidate<'t>> {
		if matches!(context, ChunkContext::Root | ChunkContext::ClassBody) {
			return classify_element(node, source);
		}
		None
	}
}
