//! Chunk classifier for INI.
//!
//! The tree-sitter INI grammar is intentionally flat: a document contains
//! root-level `setting` nodes and `section` containers, and a section contains
//! only its own `setting` children. Mirror that structure directly instead of
//! inventing deeper hierarchy.

use tree_sitter::Node;

use super::{classify::LangClassifier, common::*, kind::ChunkKind};

pub struct IniClassifier;

impl LangClassifier for IniClassifier {
	fn classify_root<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		classify_ini_root(node, source)
	}

	fn classify_class<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		classify_ini_class(node, source)
	}
}

fn classify_ini_root<'t>(node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
	Some(match node.kind() {
		"section" => make_container_chunk(
			node,
			ChunkKind::Section,
			Some(ini_name(node, source)?),
			source,
			Some(recurse_self(node, ChunkContext::ClassBody)),
		),
		// INI permits settings before any section header; keep them as first-class
		// chunks instead of forcing them under a synthetic container.
		"setting" => {
			make_kind_chunk(node, ChunkKind::Key, Some(ini_name(node, source)?), source, None)
		},
		_ => return None,
	})
}

fn classify_ini_class<'t>(node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
	Some(match node.kind() {
		"setting" => {
			make_kind_chunk(node, ChunkKind::Key, Some(ini_name(node, source)?), source, None)
		},
		_ => return None,
	})
}

fn ini_name(node: Node<'_>, source: &str) -> Option<String> {
	find_named_text(node, source, &["section_name", "setting_name", "text"]).and_then(|text| {
		sanitize_identifier(text.trim().trim_start_matches('[').trim_end_matches(']'))
	})
}

fn find_named_text<'a>(node: Node<'_>, source: &'a str, kinds: &[&str]) -> Option<&'a str> {
	if kinds.iter().any(|kind| node.kind() == *kind) {
		return Some(node_text(source, node.start_byte(), node.end_byte()));
	}

	for child in named_children(node) {
		if let Some(text) = find_named_text(child, source, kinds) {
			return Some(text);
		}
	}

	None
}
