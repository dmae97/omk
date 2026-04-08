//! Chunk classifier for Dockerfile syntax.

use tree_sitter::Node;

use super::{classify::LangClassifier, common::*, kind::ChunkKind};

pub struct DockerfileClassifier;

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

fn extract_stage_name(node: Node<'_>, source: &str) -> Option<String> {
	if let Some(alias) = child_by_kind(node, &["image_alias"]) {
		return sanitize_identifier(child_text(source, alias));
	}

	child_by_kind(node, &["image_spec"]).and_then(|image| {
		let image_name = child_by_kind(image, &["image_name"]).unwrap_or(image);
		sanitize_identifier(child_text(source, image_name))
	})
}

fn extract_pair_key(node: Node<'_>, pair_kind: &str, source: &str) -> Option<String> {
	first_named_child_of_kind(node, pair_kind)
		.and_then(first_named_child)
		.and_then(|key| sanitize_identifier(unquote_text(child_text(source, key)).as_str()))
}

fn extract_arg_name(node: Node<'_>, source: &str) -> Option<String> {
	first_named_child(node).and_then(|name| sanitize_identifier(child_text(source, name)))
}

fn recurse_command(node: Node<'_>) -> Option<RecurseSpec<'_>> {
	recurse_into(node, ChunkContext::FunctionBody, &[], &["shell_command", "json_string_array"])
}

fn classify_command_instruction<'t>(node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
	let chunk_name = match node.kind() {
		"run_instruction" => "run",
		"cmd_instruction" => "cmd",
		"entrypoint_instruction" => "entrypoint",
		_ => return None,
	};

	Some(make_candidate(
		node,
		ChunkKind::Cmd,
		chunk_name.to_string(),
		NameStyle::Named,
		signature_for_node(node, source),
		recurse_command(node),
		source,
	))
}

impl LangClassifier for DockerfileClassifier {
	fn classify_root<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		match node.kind() {
			"from_instruction" => {
				let name = extract_stage_name(node, source).unwrap_or_else(|| "anonymous".to_string());
				Some(make_kind_chunk(node, ChunkKind::Stage, Some(name), source, None))
			},
			"arg_instruction" => {
				let name = extract_arg_name(node, source).unwrap_or_else(|| "anonymous".to_string());
				Some(make_kind_chunk(node, ChunkKind::Arg, Some(name), source, None))
			},
			"env_instruction" => {
				let name = extract_pair_key(node, "env_pair", source)
					.unwrap_or_else(|| "anonymous".to_string());
				Some(make_kind_chunk(node, ChunkKind::Env, Some(name), source, None))
			},
			"label_instruction" => {
				let name = extract_pair_key(node, "label_pair", source)
					.unwrap_or_else(|| "anonymous".to_string());
				Some(make_kind_chunk(node, ChunkKind::Label, Some(name), source, None))
			},
			"run_instruction" | "cmd_instruction" | "entrypoint_instruction" => {
				classify_command_instruction(node, source)
			},
			"healthcheck_instruction" => Some(make_container_chunk(
				node,
				ChunkKind::Healthcheck,
				None,
				source,
				recurse_into(node, ChunkContext::FunctionBody, &[], &["cmd_instruction"]),
			)),
			"copy_instruction" => Some(group_candidate(node, ChunkKind::Copy, source)),
			"add_instruction" => Some(group_candidate(node, ChunkKind::Add, source)),
			"workdir_instruction" => Some(group_candidate(node, ChunkKind::Workdir, source)),
			"expose_instruction" => Some(group_candidate(node, ChunkKind::Expose, source)),
			"user_instruction" => Some(group_candidate(node, ChunkKind::User, source)),
			_ => None,
		}
	}

	fn classify_class<'t>(&self, _node: Node<'t>, _source: &str) -> Option<RawChunkCandidate<'t>> {
		None
	}

	fn classify_function<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		match node.kind() {
			"cmd_instruction" => classify_command_instruction(node, source),
			"shell_command" => Some(group_candidate(node, ChunkKind::Shell, source)),
			"json_string_array" => Some(group_candidate(node, ChunkKind::Argv, source)),
			_ => None,
		}
	}
}
