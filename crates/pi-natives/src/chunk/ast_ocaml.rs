//! OCaml-specific chunk classifier.

use tree_sitter::Node;

use super::{
	classify::{ClassifierTables, LangClassifier, StructuralOverrides},
	common::*,
	kind::ChunkKind,
};

pub struct OcamlClassifier;

impl LangClassifier for OcamlClassifier {
	fn tables(&self) -> &'static ClassifierTables {
		static TABLES: ClassifierTables = ClassifierTables {
			root:                 &[],
			class:                &[],
			function:             &[],
			structural_overrides: StructuralOverrides::EMPTY,
		};
		&TABLES
	}

	fn classify_override<'t>(
		&self,
		context: ChunkContext,
		node: Node<'t>,
		source: &str,
	) -> Option<RawChunkCandidate<'t>> {
		match context {
			ChunkContext::Root => classify_ocaml_item(node, source),
			ChunkContext::ClassBody => classify_class(node, source),
			ChunkContext::FunctionBody => classify_function(node, source),
		}
	}
}

fn classify_class<'t>(node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
	match node.kind() {
		"method_definition" => Some(make_kind_chunk(
			node,
			ChunkKind::Function,
			ocaml_named_text(node, source, &["method_name"]),
			source,
			ocaml_method_recurse(node),
		)),
		"method_specification" => Some(make_kind_chunk(
			node,
			ChunkKind::Function,
			ocaml_named_text(node, source, &["method_name"]),
			source,
			None,
		)),
		"instance_variable_definition" => {
			Some(match ocaml_named_text(node, source, &["instance_variable_name"]) {
				Some(name) => make_kind_chunk(node, ChunkKind::Field, Some(name), source, None),
				None => group_candidate(node, ChunkKind::Fields, source),
			})
		},
		_ => classify_ocaml_item(node, source),
	}
}

fn classify_function<'t>(node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
	match node.kind() {
		"function_expression" | "match_expression" => Some(make_candidate(
			node,
			ChunkKind::Match,
			None,
			NameStyle::Named,
			signature_for_node(node, source),
			Some(recurse_self(node, ChunkContext::FunctionBody)),
			source,
		)),
		"match_case" => Some(make_candidate(
			node,
			ChunkKind::Case,
			None,
			NameStyle::Named,
			signature_for_node(node, source),
			Some(recurse_self(node, ChunkContext::FunctionBody)),
			source,
		)),
		"let_expression" => Some(make_candidate(
			node,
			ChunkKind::Let,
			None,
			NameStyle::Named,
			signature_for_node(node, source),
			Some(recurse_self(node, ChunkContext::FunctionBody)),
			source,
		)),
		_ => classify_ocaml_item(node, source),
	}
}

fn classify_ocaml_item<'t>(node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
	Some(match node.kind() {
		"open_module" => group_candidate(node, ChunkKind::Imports, source),
		"module_definition" => make_container_chunk(
			node,
			ChunkKind::Module,
			ocaml_named_text(node, source, &["module_name"]),
			source,
			ocaml_module_recurse(node),
		),
		"module_type_definition" => make_candidate(
			node,
			ChunkKind::Interface,
			format!("modtype_{}", ocaml_named_text(node, source, &["module_type_name"])?),
			NameStyle::Named,
			signature_for_node(node, source),
			ocaml_module_type_recurse(node),
			source,
		),
		"class_definition" => make_container_chunk(
			node,
			ChunkKind::Class,
			ocaml_named_text(node, source, &["class_name"]),
			source,
			ocaml_class_recurse(node),
		),
		"class_type_definition" => make_candidate(
			node,
			ChunkKind::Iface,
			format!("classtype_{}", ocaml_named_text(node, source, &["class_type_name"])?),
			NameStyle::Named,
			signature_for_node(node, source),
			ocaml_class_type_recurse(node),
			source,
		),
		"type_definition" => make_kind_chunk(
			node,
			ChunkKind::Type,
			ocaml_named_text(node, source, &["type_constructor"]),
			source,
			None,
		),
		"exception_definition" => make_candidate(
			node,
			ChunkKind::Constructor,
			format!("exception_{}", ocaml_named_text(node, source, &["constructor_name"])?),
			NameStyle::Named,
			signature_for_node(node, source),
			None,
			source,
		),
		"value_definition" => classify_ocaml_value_definition(node, source)?,
		"value_specification" => make_kind_chunk(
			node,
			ChunkKind::Val,
			ocaml_named_text(node, source, &["value_name"]),
			source,
			None,
		),
		_ => return None,
	})
}

fn classify_ocaml_value_definition<'t>(
	node: Node<'t>,
	source: &str,
) -> Option<RawChunkCandidate<'t>> {
	let name = ocaml_named_text(node, source, &["value_name"])?;
	let recurse = ocaml_value_recurse(node);
	if ocaml_value_definition_is_function(node) {
		Some(make_kind_chunk(node, ChunkKind::Function, Some(name), source, recurse))
	} else {
		Some(make_kind_chunk(node, ChunkKind::Val, Some(name), source, recurse))
	}
}

fn ocaml_named_text(node: Node<'_>, source: &str, kinds: &[&str]) -> Option<String> {
	find_named_text(node, source, kinds).and_then(sanitize_identifier)
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

fn ocaml_module_recurse(node: Node<'_>) -> Option<RecurseSpec<'_>> {
	recurse_into(node, ChunkContext::ClassBody, &[], &["module_binding"]).and_then(|binding| {
		recurse_into(binding.node, ChunkContext::ClassBody, &["body"], &["structure", "signature"])
	})
}

fn ocaml_module_type_recurse(node: Node<'_>) -> Option<RecurseSpec<'_>> {
	recurse_into(node, ChunkContext::ClassBody, &["body"], &["signature"])
}

fn ocaml_class_recurse(node: Node<'_>) -> Option<RecurseSpec<'_>> {
	recurse_into(node, ChunkContext::ClassBody, &[], &["class_binding"]).and_then(|binding| {
		recurse_into(binding.node, ChunkContext::ClassBody, &["body"], &["object_expression"])
	})
}

fn ocaml_class_type_recurse(node: Node<'_>) -> Option<RecurseSpec<'_>> {
	recurse_into(node, ChunkContext::ClassBody, &[], &["class_type_binding"]).and_then(|binding| {
		recurse_into(binding.node, ChunkContext::ClassBody, &["body"], &["class_body_type"])
	})
}

fn ocaml_method_recurse(node: Node<'_>) -> Option<RecurseSpec<'_>> {
	recurse_into(node, ChunkContext::FunctionBody, &["body"], &[
		"function_expression",
		"match_expression",
		"let_expression",
	])
}

fn ocaml_value_recurse(node: Node<'_>) -> Option<RecurseSpec<'_>> {
	recurse_into(node, ChunkContext::FunctionBody, &[], &["let_binding"]).and_then(|binding| {
		named_children(binding.node)
			.into_iter()
			.find(|child| {
				matches!(child.kind(), "function_expression" | "match_expression" | "let_expression")
			})
			.map(|child| RecurseSpec { node: child, context: ChunkContext::FunctionBody })
	})
}

fn ocaml_value_definition_is_function(node: Node<'_>) -> bool {
	recurse_into(node, ChunkContext::FunctionBody, &[], &["let_binding"]).is_some_and(|binding| {
		named_children(binding.node)
			.into_iter()
			.any(|child| matches!(child.kind(), "parameter" | "function_expression"))
	})
}
