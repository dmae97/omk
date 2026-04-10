//! Chunk classifier for Dockerfile syntax.

use tree_sitter::Node;

use super::{
	classify::{
		ClassifierTables, LangClassifier, NamingMode, RecurseMode, RuleStyle, semantic_rule,
	},
	common::*,
	kind::ChunkKind,
};

pub struct DockerfileClassifier;

const DOCKERFILE_ROOT_RULES: &[super::classify::SemanticRule] = &[
	semantic_rule(
		"run_instruction",
		ChunkKind::Cmd,
		RuleStyle::Named,
		NamingMode::SanitizedKind,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"cmd_instruction",
		ChunkKind::Cmd,
		RuleStyle::Named,
		NamingMode::SanitizedKind,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"entrypoint_instruction",
		ChunkKind::Cmd,
		RuleStyle::Named,
		NamingMode::SanitizedKind,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"copy_instruction",
		ChunkKind::Copy,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"add_instruction",
		ChunkKind::Add,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"workdir_instruction",
		ChunkKind::Workdir,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"expose_instruction",
		ChunkKind::Expose,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"user_instruction",
		ChunkKind::User,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
];

const DOCKERFILE_FUNCTION_RULES: &[super::classify::SemanticRule] = &[
	semantic_rule(
		"cmd_instruction",
		ChunkKind::Cmd,
		RuleStyle::Named,
		NamingMode::SanitizedKind,
		RecurseMode::Auto(ChunkContext::FunctionBody),
	),
	semantic_rule(
		"shell_command",
		ChunkKind::Shell,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"json_string_array",
		ChunkKind::Argv,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
];

const DOCKERFILE_TABLES: ClassifierTables = ClassifierTables {
	root:                 DOCKERFILE_ROOT_RULES,
	class:                &[],
	function:             DOCKERFILE_FUNCTION_RULES,
	structural_overrides: super::classify::StructuralOverrides::EMPTY,
};

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

impl LangClassifier for DockerfileClassifier {
	fn tables(&self) -> &'static ClassifierTables {
		&DOCKERFILE_TABLES
	}

	fn classify_override<'t>(
		&self,
		context: ChunkContext,
		node: Node<'t>,
		source: &str,
	) -> Option<RawChunkCandidate<'t>> {
		match context {
			ChunkContext::Root => match node.kind() {
				"from_instruction" => {
					let name =
						extract_stage_name(node, source).unwrap_or_else(|| "anonymous".to_string());
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
				"healthcheck_instruction" => Some(make_container_chunk(
					node,
					ChunkKind::Healthcheck,
					None,
					source,
					recurse_into(node, ChunkContext::FunctionBody, &[], &["cmd_instruction"]),
				)),
				_ => None,
			},
			_ => None,
		}
	}
}
