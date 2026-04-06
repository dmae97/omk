//! Language-specific chunk classifiers for Bash, Make, and Diff.

use tree_sitter::Node;

use super::{classify::LangClassifier, common::*};

pub struct ShellBuildClassifier;

impl ShellBuildClassifier {
	/// Extract a Make rule target name (child node of kind `targets`).
	fn extract_rule_target(node: Node<'_>, source: &str) -> Option<String> {
		child_by_kind(node, &["targets"])
			.and_then(|t| sanitize_identifier(node_text(source, t.start_byte(), t.end_byte())))
	}

	/// Extract a Make variable/define name (field `name`).
	fn extract_var_name(node: Node<'_>, source: &str) -> Option<String> {
		node
			.child_by_field_name("name")
			.and_then(|n| sanitize_identifier(node_text(source, n.start_byte(), n.end_byte())))
	}
}

impl LangClassifier for ShellBuildClassifier {
	fn classify_root<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		match node.kind() {
			"rule" => {
				let name =
					Self::extract_rule_target(node, source).unwrap_or_else(|| "anonymous".to_string());
				Some(make_container_chunk(
					node,
					format!("rule_{name}"),
					source,
					recurse_into(node, ChunkContext::ClassBody, &[], &["recipe"]),
				))
			},
			"variable_assignment" | "shell_assignment" => {
				let name =
					Self::extract_var_name(node, source).unwrap_or_else(|| "anonymous".to_string());
				Some(make_named_chunk(node, format!("var_{name}"), source, None))
			},
			"define_directive" => {
				let name =
					Self::extract_var_name(node, source).unwrap_or_else(|| "anonymous".to_string());
				Some(make_named_chunk(node, format!("define_{name}"), source, None))
			},
			"conditional" => Some(positional_candidate(node, "if", source)),
			// Bash commands and pipelines
			"command" | "pipeline" => Some(group_candidate(node, "stmts", source)),
			// Bash control flow
			"if_statement" => Some(positional_candidate(node, "if", source)),
			"case_statement" => Some(positional_candidate(node, "switch", source)),
			"while_statement" | "for_statement" => Some(positional_candidate(node, "loop", source)),
			// Bash function definition
			"function_definition" => Some(named_candidate(
				node,
				"fn",
				source,
				recurse_body(node, ChunkContext::FunctionBody),
			)),
			// Diff nodes
			"hunks" => Some(group_candidate(node, "hunks", source)),
			"file_change" => Some(named_candidate(node, "file", source, None)),
			_ => None,
		}
	}

	fn classify_class<'t>(&self, _node: Node<'t>, _source: &str) -> Option<RawChunkCandidate<'t>> {
		None
	}

	fn classify_function<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		match node.kind() {
			"if_statement" => Some(positional_candidate(node, "if", source)),
			"case_statement" => Some(positional_candidate(node, "switch", source)),
			"while_statement" | "for_statement" => Some(positional_candidate(node, "loop", source)),
			"command" | "pipeline" => Some(group_candidate(node, "stmts", source)),
			"subshell" => Some(positional_candidate(node, "block", source)),
			_ => None,
		}
	}

	fn is_root_wrapper(&self, kind: &str) -> bool {
		kind == "makefile"
	}
}
