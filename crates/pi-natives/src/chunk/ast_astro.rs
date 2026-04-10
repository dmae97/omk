//! Language-specific chunk classifiers for Astro.

use tree_sitter::Node;

use super::{
	classify::{ClassifierTables, LangClassifier, StructuralOverrides},
	common::*,
	kind::ChunkKind,
};

pub struct AstroClassifier;

impl LangClassifier for AstroClassifier {
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
		_context: ChunkContext,
		node: Node<'t>,
		source: &str,
	) -> Option<RawChunkCandidate<'t>> {
		classify_astro_node(node, source)
	}
}

fn classify_astro_node<'t>(node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
	match node.kind() {
		"frontmatter" => Some(classify_frontmatter(node, source)),
		"frontmatter_js_block" => Some(group_candidate(node, ChunkKind::Code, source)),
		"element" => classify_element(node, source),
		"script_element" => Some(classify_script_element(node, source)),
		"style_element" => Some(classify_style_element(node, source)),
		"html_interpolation" => Some(classify_html_interpolation(node, source)),
		"attribute_interpolation" => Some(classify_attribute_interpolation(node, source)),
		"attribute_js_expr" => Some(group_candidate(node, ChunkKind::Expression, source)),
		"text" => Some(group_candidate(node, ChunkKind::Text, source)),
		_ => None,
	}
}

fn classify_frontmatter<'t>(node: Node<'t>, source: &str) -> RawChunkCandidate<'t> {
	force_container(make_container_chunk(
		node,
		ChunkKind::Frontmatter,
		None,
		source,
		recurse_into(node, ChunkContext::ClassBody, &[], &["frontmatter_js_block"]),
	))
}

fn classify_element<'t>(node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
	let tag_name = extract_tag_name(node, source)?;
	let recurse = Some(recurse_self(node, ChunkContext::ClassBody));
	if is_component_name(tag_name.as_str()) {
		Some(force_container(make_explicit_candidate(
			node,
			ChunkKind::Tag,
			format!("component_{tag_name}"),
			source,
			recurse,
		)))
	} else {
		Some(force_container(make_container_chunk(
			node,
			ChunkKind::Tag,
			Some(tag_name),
			source,
			recurse,
		)))
	}
}

fn classify_script_element<'t>(node: Node<'t>, source: &str) -> RawChunkCandidate<'t> {
	let identifier = has_attribute(node, "is:inline", source).then_some("inline".to_string());
	// The Astro grammar exposes script bodies as `raw_text`, not nested JS AST.
	make_kind_chunk(node, ChunkKind::Script, identifier, source, None)
}

fn classify_style_element<'t>(node: Node<'t>, source: &str) -> RawChunkCandidate<'t> {
	let identifier = if has_attribute(node, "define:vars", source) {
		Some("vars".to_string())
	} else if has_attribute(node, "is:global", source) {
		Some("global".to_string())
	} else {
		None
	};
	// The Astro grammar exposes style bodies as `raw_text`, so the section itself
	// is the truthful chunk boundary.
	make_kind_chunk(node, ChunkKind::Style, identifier, source, None)
}

fn classify_html_interpolation<'t>(node: Node<'t>, source: &str) -> RawChunkCandidate<'t> {
	let identifier = child_by_kind(node, &["permissible_text"])
		.and_then(|expr| sanitize_identifier(node_text(source, expr.start_byte(), expr.end_byte())));

	if let Some(nested_element) =
		child_by_kind(node, &["element", "script_element", "style_element"])
	{
		force_container(make_container_chunk(
			node,
			ChunkKind::Expression,
			identifier,
			source,
			Some(recurse_self(nested_element, ChunkContext::ClassBody)),
		))
	} else {
		make_kind_chunk(node, ChunkKind::Expression, identifier, source, None)
	}
}

fn classify_attribute_interpolation<'t>(node: Node<'t>, source: &str) -> RawChunkCandidate<'t> {
	let identifier = child_by_kind(node, &["attribute_js_expr"])
		.and_then(|expr| sanitize_identifier(node_text(source, expr.start_byte(), expr.end_byte())))
		.map_or_else(|| "expr".to_string(), |expr| format!("expr_{expr}"));
	make_kind_chunk(node, ChunkKind::Attr, Some(identifier), source, None)
}

fn make_explicit_candidate<'t>(
	node: Node<'t>,
	kind: ChunkKind,
	identifier: impl Into<Option<String>>,
	source: &str,
	recurse: Option<RecurseSpec<'t>>,
) -> RawChunkCandidate<'t> {
	make_candidate(
		node,
		kind,
		identifier,
		NameStyle::Named,
		signature_for_node(node, source),
		recurse,
		source,
	)
}

const fn force_container(mut candidate: RawChunkCandidate<'_>) -> RawChunkCandidate<'_> {
	candidate.force_recurse = true;
	candidate
}

fn extract_tag_name(node: Node<'_>, source: &str) -> Option<String> {
	child_by_kind(node, &["start_tag", "self_closing_tag"])
		.and_then(|tag| child_by_kind(tag, &["tag_name"]))
		.and_then(|tag_name| {
			sanitize_identifier(node_text(source, tag_name.start_byte(), tag_name.end_byte()))
		})
}

fn has_attribute(node: Node<'_>, name: &str, source: &str) -> bool {
	child_by_kind(node, &["start_tag", "self_closing_tag"])
		.into_iter()
		.flat_map(named_children)
		.filter(|child| child.kind() == "attribute")
		.filter_map(|attr| extract_attribute_name(attr, source))
		.any(|attr_name| attr_name == name)
}

fn extract_attribute_name(node: Node<'_>, source: &str) -> Option<String> {
	child_by_kind(node, &["attribute_name"]).map(|name| {
		node_text(source, name.start_byte(), name.end_byte())
			.trim()
			.to_string()
	})
}

fn is_component_name(tag_name: &str) -> bool {
	tag_name.chars().next().is_some_and(char::is_uppercase)
}
