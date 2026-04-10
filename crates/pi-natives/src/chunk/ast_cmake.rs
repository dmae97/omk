//! CMake-specific chunk classifier.

use tree_sitter::Node;

use super::{
	classify::{ClassifierTables, LangClassifier, StructuralOverrides},
	common::*,
	kind::ChunkKind,
};

pub struct CMakeClassifier;

fn child_text<'a>(source: &'a str, node: Node<'_>) -> &'a str {
	node_text(source, node.start_byte(), node.end_byte())
}

fn first_named_child(node: Node<'_>) -> Option<Node<'_>> {
	named_children(node).into_iter().next()
}

fn first_named_child_of_kind<'t>(node: Node<'t>, kind: &str) -> Option<Node<'t>> {
	named_children(node)
		.into_iter()
		.find(|child| child.kind() == kind)
}

fn command_name(node: Node<'_>, source: &str) -> Option<String> {
	first_named_child(node).and_then(|child| sanitize_identifier(child_text(source, child)))
}

fn argument_nodes(node: Node<'_>) -> Vec<Node<'_>> {
	first_named_child_of_kind(node, "argument_list")
		.map(named_children)
		.unwrap_or_default()
		.into_iter()
		.filter(|child| child.kind() == "argument")
		.collect()
}

fn nth_argument_name(node: Node<'_>, index: usize, source: &str) -> Option<String> {
	argument_nodes(node)
		.into_iter()
		.nth(index)
		.and_then(|arg| sanitize_identifier(child_text(source, arg)))
}

fn classify_definition<'t>(node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
	match node.kind() {
		"function_def" => {
			let header = first_named_child_of_kind(node, "function_command")?;
			let name = nth_argument_name(header, 0, source).unwrap_or_else(|| "anonymous".to_string());
			Some(make_container_chunk(
				node,
				ChunkKind::Function,
				Some(name),
				source,
				recurse_into(node, ChunkContext::FunctionBody, &[], &["body"]),
			))
		},
		"macro_def" => {
			let header = first_named_child_of_kind(node, "macro_command")?;
			let name = nth_argument_name(header, 0, source).unwrap_or_else(|| "anonymous".to_string());
			Some(make_container_chunk(
				node,
				ChunkKind::Macro,
				Some(name),
				source,
				recurse_into(node, ChunkContext::FunctionBody, &[], &["body"]),
			))
		},
		"if_condition" => Some(make_container_chunk(
			node,
			ChunkKind::If,
			None,
			source,
			Some(recurse_self(node, ChunkContext::FunctionBody)),
		)),
		"foreach_loop" | "while_loop" => Some(make_container_chunk(
			node,
			ChunkKind::Loop,
			None,
			source,
			recurse_into(node, ChunkContext::FunctionBody, &[], &["body"]),
		)),
		_ => None,
	}
}

fn classify_command<'t>(node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
	if node.kind() != "normal_command" {
		return None;
	}

	let command = command_name(node, source)?;
	Some(match command.as_str() {
		"cmake_minimum_required" => make_kind_chunk(node, ChunkKind::VersionGate, None, source, None),
		"project" => {
			let name = nth_argument_name(node, 0, source).unwrap_or_else(|| "anonymous".to_string());
			make_kind_chunk(node, ChunkKind::Project, Some(name), source, None)
		},
		"include" | "find_package" => group_candidate(node, ChunkKind::Imports, source),
		"option" => {
			let name = nth_argument_name(node, 0, source).unwrap_or_else(|| "anonymous".to_string());
			make_kind_chunk(node, ChunkKind::Option, Some(name), source, None)
		},
		"set" => {
			let name = nth_argument_name(node, 0, source).unwrap_or_else(|| "anonymous".to_string());
			make_kind_chunk(node, ChunkKind::Variable, Some(name), source, None)
		},
		"add_library" | "add_executable" | "add_custom_target" => {
			let name = nth_argument_name(node, 0, source).unwrap_or_else(|| "anonymous".to_string());
			make_kind_chunk(node, ChunkKind::Target, Some(name), source, None)
		},
		"install" | "export" => group_candidate(node, ChunkKind::Install, source),
		other => make_kind_chunk(node, ChunkKind::Cmd, Some(other.to_string()), source, None),
	})
}

fn classify_if_child<'t>(node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
	match node.kind() {
		"if_command" => Some(group_candidate(node, ChunkKind::Cond, source)),
		"elseif_command" => Some(positional_candidate(node, ChunkKind::Elif, source)),
		"else_command" => Some(positional_candidate(node, ChunkKind::Else, source)),
		"body" => Some(make_container_chunk(
			node,
			ChunkKind::Block,
			None,
			source,
			Some(recurse_self(node, ChunkContext::FunctionBody)),
		)),
		_ => None,
	}
}

impl LangClassifier for CMakeClassifier {
	fn tables(&self) -> &'static ClassifierTables {
		static TABLES: ClassifierTables = ClassifierTables {
			root:                 &[],
			class:                &[],
			function:             &[],
			structural_overrides: StructuralOverrides {
				extra_trivia:            &[
					"endif_command",
					"endforeach_command",
					"endwhile_command",
					"endfunction_command",
					"endmacro_command",
				],
				preserved_trivia:        &[],
				extra_root_wrappers:     &[],
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
		match context {
			ChunkContext::Root => {
				classify_definition(node, source).or_else(|| classify_command(node, source))
			},
			ChunkContext::FunctionBody => classify_definition(node, source)
				.or_else(|| classify_if_child(node, source))
				.or_else(|| classify_command(node, source)),
			ChunkContext::ClassBody => None,
		}
	}
}
