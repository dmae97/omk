//! Language-specific chunk classifiers for Python and Starlark.

use tree_sitter::Node;

use super::{classify::LangClassifier, common::*};

pub struct PythonClassifier;

impl LangClassifier for PythonClassifier {
	fn classify_root<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		match node.kind() {
			"decorated_definition" => Some(classify_decorated(node, source)),
			_ => None,
		}
	}
}

fn classify_decorated<'t>(node: Node<'t>, source: &str) -> RawChunkCandidate<'t> {
	let inner = named_children(node)
		.into_iter()
		.find(|c| c.kind() == "class_definition" || c.kind() == "function_definition");
	match inner {
		Some(child) if child.kind() == "class_definition" => make_container_chunk(
			node,
			prefixed_name("class", child, source),
			source,
			recurse_into(child, ChunkContext::ClassBody, &["body"], &["block"]),
		),
		Some(child) if child.kind() == "function_definition" => make_named_chunk(
			node,
			prefixed_name("fn", child, source),
			source,
			recurse_into(child, ChunkContext::FunctionBody, &["body"], &["block"]),
		),
		_ => positional_candidate(node, "block", source),
	}
}
