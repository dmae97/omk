//! PowerShell-specific chunk classifier.

use tree_sitter::Node;

use super::{classify::LangClassifier, common::*, kind::ChunkKind};

pub struct PowershellClassifier;

impl LangClassifier for PowershellClassifier {
	fn classify_root<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		Some(match node.kind() {
			"param_block" => group_candidate(node, ChunkKind::Parameters, source),
			"statement_list" => make_container_chunk(
				node,
				ChunkKind::Body,
				None,
				source,
				Some(recurse_self(node, ChunkContext::Root)),
			),
			"class_statement" => make_container_chunk(
				node,
				ChunkKind::Class,
				Some(powershell_name(node, source)?),
				source,
				Some(recurse_self(node, ChunkContext::ClassBody)),
			),
			"function_statement" => make_container_chunk(
				node,
				ChunkKind::Function,
				Some(powershell_name(node, source)?),
				source,
				Some(recurse_self(node, ChunkContext::FunctionBody)),
			),
			"pipeline" => classify_powershell_pipeline(node, source),
			"switch_statement" | "if_statement" | "foreach_statement" => {
				return self.classify_function(node, source);
			},
			"flow_control_statement" => group_candidate(node, ChunkKind::Statements, source),
			_ => return None,
		})
	}

	fn classify_class<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		Some(match node.kind() {
			"class_property_definition" => match powershell_name(node, source) {
				Some(name) => make_kind_chunk(node, ChunkKind::Field, Some(name), source, None),
				None => group_candidate(node, ChunkKind::Fields, source),
			},
			"class_method_definition" => classify_class_method(node, source)?,
			_ => return None,
		})
	}

	fn classify_function<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		Some(match node.kind() {
			"class_method_parameter_list" | "param_block" => {
				group_candidate(node, ChunkKind::Parameters, source)
			},
			"script_block" => make_container_chunk(
				node,
				block_kind_for_parent(node),
				None,
				source,
				Some(recurse_self(node, ChunkContext::FunctionBody)),
			),
			"script_block_body" | "statement_block" => make_container_chunk(
				node,
				ChunkKind::Block,
				None,
				source,
				recurse_into(node, ChunkContext::FunctionBody, &[], &["statement_list"]),
			),
			"pipeline" => classify_powershell_pipeline(node, source),
			"if_statement" => make_container_chunk(
				node,
				ChunkKind::If,
				None,
				source,
				recurse_into(node, ChunkContext::FunctionBody, &[], &["statement_block"]),
			),
			"foreach_statement" => make_container_chunk(
				node,
				ChunkKind::Loop,
				None,
				source,
				recurse_into(node, ChunkContext::FunctionBody, &[], &["statement_block"]),
			),
			"switch_statement" => make_container_chunk(
				node,
				ChunkKind::Switch,
				None,
				source,
				recurse_into(node, ChunkContext::FunctionBody, &[], &["switch_body"]),
			),
			"switch_clauses" => make_container_chunk(
				node,
				ChunkKind::Cases,
				None,
				source,
				Some(recurse_self(node, ChunkContext::FunctionBody)),
			),
			"switch_clause" => make_container_chunk(
				node,
				ChunkKind::Case,
				None,
				source,
				recurse_into(node, ChunkContext::FunctionBody, &[], &["statement_block"]),
			),
			"flow_control_statement" => group_candidate(node, ChunkKind::Statements, source),
			_ => return None,
		})
	}

	fn is_trivia(&self, kind: &str) -> bool {
		matches!(kind, "function_name" | "simple_name" | "type_literal" | "switch_condition")
	}
}

fn classify_class_method<'t>(node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
	let name = powershell_name(node, source)?;
	let class_name = powershell_name(node.parent()?, source)?;
	let (kind, identifier) = if name == "new" || name == class_name {
		(ChunkKind::Constructor, None)
	} else {
		(ChunkKind::Function, Some(name))
	};

	Some(make_container_chunk(
		node,
		kind,
		identifier,
		source,
		Some(recurse_self(node, ChunkContext::FunctionBody)),
	))
}

fn classify_powershell_pipeline<'t>(node: Node<'t>, source: &str) -> RawChunkCandidate<'t> {
	if let Some(command_name) = powershell_command_name(node, source)
		&& matches!(command_name.as_str(), "using" | "using-module" | "Import-Module")
	{
		return group_candidate(node, ChunkKind::Imports, source);
	}

	if let Some((name, script_block)) = assigned_script_block(node, source) {
		return make_container_chunk_from(
			node,
			node,
			ChunkKind::Block,
			Some(name),
			source,
			Some(recurse_self(script_block, ChunkContext::FunctionBody)),
		);
	}

	if child_by_kind(node, &["assignment_expression"]).is_some() {
		group_candidate(node, ChunkKind::Declarations, source)
	} else {
		group_candidate(node, ChunkKind::Statements, source)
	}
}

fn assigned_script_block<'t>(node: Node<'t>, source: &str) -> Option<(String, Node<'t>)> {
	let assignment = child_by_kind(node, &["assignment_expression"])?;
	let lhs = child_by_kind(assignment, &["left_assignment_expression"])?;
	let name = sanitize_identifier(
		node_text(source, lhs.start_byte(), lhs.end_byte()).trim_start_matches('$'),
	)?;
	let script_block = named_children(assignment)
		.into_iter()
		.filter(|child| child.kind() != "left_assignment_expression")
		.find_map(find_script_block)?;
	Some((name, script_block))
}

fn find_script_block(node: Node<'_>) -> Option<Node<'_>> {
	if node.kind() == "script_block" {
		return Some(node);
	}
	for child in named_children(node) {
		if let Some(script_block) = find_script_block(child) {
			return Some(script_block);
		}
	}
	None
}

fn block_kind_for_parent(node: Node<'_>) -> ChunkKind {
	match node.parent().map(|parent| parent.kind()) {
		Some("function_statement" | "class_method_definition") => ChunkKind::Body,
		_ => ChunkKind::Block,
	}
}

fn powershell_name(node: Node<'_>, source: &str) -> Option<String> {
	find_named_text(node, source, &[
		"function_name",
		"simple_name",
		"member_name",
		"type_identifier",
		"variable",
	])
	.and_then(|text| sanitize_identifier(text.trim_start_matches('$')))
}

fn powershell_command_name(node: Node<'_>, source: &str) -> Option<String> {
	find_named_text(node, source, &["command_name"]).and_then(sanitize_identifier)
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
