//! Language-specific chunk classifiers for Bash, Make, and Diff.

use tree_sitter::Node;

use super::{
	classify::{
		ClassifierTables, LangClassifier, NamingMode, RecurseMode, RuleStyle, StructuralOverrides,
		semantic_rule,
	},
	common::*,
	kind::ChunkKind,
};

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

	/// Strip the conventional `a/` or `b/` prefix from git diff paths.
	fn strip_ab_prefix(path: &str) -> &str {
		path
			.strip_prefix("a/")
			.or_else(|| path.strip_prefix("b/"))
			.unwrap_or(path)
	}

	/// Extract the file path from a diff `block` node.
	///
	/// Extraction priority:
	/// 1. `new_file` child -> `filename` child text (skip if `/dev/null`)
	/// 2. `old_file` child -> `filename` child text (skip if `/dev/null`)
	/// 3. `command` child -> parse `a/path b/path` from filename children
	fn extract_diff_filename(node: Node<'_>, source: &str) -> Option<String> {
		// Try new_file first (most diffs have it)
		if let Some(new_file) = child_by_kind(node, &["new_file"])
			&& let Some(filename) = child_by_kind(new_file, &["filename"])
		{
			let text = node_text(source, filename.start_byte(), filename.end_byte()).trim();
			if text != "/dev/null" {
				return sanitize_identifier(Self::strip_ab_prefix(text));
			}
		}

		// Fall back to old_file (deleted files)
		if let Some(old_file) = child_by_kind(node, &["old_file"])
			&& let Some(filename) = child_by_kind(old_file, &["filename"])
		{
			let text = node_text(source, filename.start_byte(), filename.end_byte()).trim();
			if text != "/dev/null" {
				return sanitize_identifier(Self::strip_ab_prefix(text));
			}
		}

		// Last resort: extract from the `command` line ("diff --git a/path b/path").
		// The grammar's `filename` rule is `repeat1(/\S+/)`, so it captures both
		// paths as a single node like "a/foo.ts b/foo.ts". Take the last
		// space-delimited segment (the b-side path).
		if let Some(command) = child_by_kind(node, &["command"])
			&& let Some(filename) = child_by_kind(command, &["filename"])
		{
			let text = node_text(source, filename.start_byte(), filename.end_byte()).trim();
			let b_side = text.rsplit_once(' ').map_or(text, |(_, b)| b);
			return sanitize_identifier(Self::strip_ab_prefix(b_side));
		}

		None
	}
}

impl LangClassifier for ShellBuildClassifier {
	fn tables(&self) -> &'static ClassifierTables {
		static TABLES: ClassifierTables = ClassifierTables {
			root:                 &[
				semantic_rule(
					"conditional",
					ChunkKind::If,
					RuleStyle::Positional,
					NamingMode::None,
					RecurseMode::None,
				),
				semantic_rule(
					"command",
					ChunkKind::Statements,
					RuleStyle::Group,
					NamingMode::None,
					RecurseMode::None,
				),
				semantic_rule(
					"pipeline",
					ChunkKind::Statements,
					RuleStyle::Group,
					NamingMode::None,
					RecurseMode::None,
				),
				semantic_rule(
					"if_statement",
					ChunkKind::If,
					RuleStyle::Positional,
					NamingMode::None,
					RecurseMode::None,
				),
				semantic_rule(
					"case_statement",
					ChunkKind::Switch,
					RuleStyle::Positional,
					NamingMode::None,
					RecurseMode::None,
				),
				semantic_rule(
					"while_statement",
					ChunkKind::Loop,
					RuleStyle::Positional,
					NamingMode::None,
					RecurseMode::None,
				),
				semantic_rule(
					"for_statement",
					ChunkKind::Loop,
					RuleStyle::Positional,
					NamingMode::None,
					RecurseMode::None,
				),
				semantic_rule(
					"function_definition",
					ChunkKind::Function,
					RuleStyle::Named,
					NamingMode::AutoIdentifier,
					RecurseMode::Auto(ChunkContext::FunctionBody),
				),
				semantic_rule(
					"hunks",
					ChunkKind::Hunks,
					RuleStyle::Group,
					NamingMode::None,
					RecurseMode::None,
				),
			],
			class:                &[semantic_rule(
				"hunk",
				ChunkKind::Hunk,
				RuleStyle::Positional,
				NamingMode::None,
				RecurseMode::None,
			)],
			function:             &[
				semantic_rule(
					"if_statement",
					ChunkKind::If,
					RuleStyle::Positional,
					NamingMode::None,
					RecurseMode::None,
				),
				semantic_rule(
					"case_statement",
					ChunkKind::Switch,
					RuleStyle::Positional,
					NamingMode::None,
					RecurseMode::None,
				),
				semantic_rule(
					"while_statement",
					ChunkKind::Loop,
					RuleStyle::Positional,
					NamingMode::None,
					RecurseMode::None,
				),
				semantic_rule(
					"for_statement",
					ChunkKind::Loop,
					RuleStyle::Positional,
					NamingMode::None,
					RecurseMode::None,
				),
				semantic_rule(
					"command",
					ChunkKind::Statements,
					RuleStyle::Group,
					NamingMode::None,
					RecurseMode::None,
				),
				semantic_rule(
					"pipeline",
					ChunkKind::Statements,
					RuleStyle::Group,
					NamingMode::None,
					RecurseMode::None,
				),
				semantic_rule(
					"subshell",
					ChunkKind::Block,
					RuleStyle::Positional,
					NamingMode::None,
					RecurseMode::None,
				),
			],
			structural_overrides: StructuralOverrides {
				extra_trivia:            &[],
				preserved_trivia:        &[],
				extra_root_wrappers:     &["makefile"],
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
			ChunkContext::Root => classify_root_custom(node, source),
			_ => None,
		}
	}

	fn preserve_children(
		&self,
		_parent: &RawChunkCandidate<'_>,
		children: &[RawChunkCandidate<'_>],
	) -> bool {
		// Diff file blocks should always preserve hunk children
		children.iter().any(|c| c.kind == ChunkKind::Hunk)
	}
}

fn classify_root_custom<'t>(node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
	match node.kind() {
		"rule" => {
			let name = ShellBuildClassifier::extract_rule_target(node, source)
				.unwrap_or_else(|| "anonymous".to_string());
			Some(make_container_chunk(
				node,
				ChunkKind::Rule,
				Some(name),
				source,
				recurse_into(node, ChunkContext::ClassBody, &[], &["recipe"]),
			))
		},
		"variable_assignment" | "shell_assignment" => {
			let name = ShellBuildClassifier::extract_var_name(node, source)
				.unwrap_or_else(|| "anonymous".to_string());
			Some(make_kind_chunk(node, ChunkKind::Variable, Some(name), source, None))
		},
		"define_directive" => {
			let name = ShellBuildClassifier::extract_var_name(node, source)
				.unwrap_or_else(|| "anonymous".to_string());
			Some(make_kind_chunk(node, ChunkKind::Define, Some(name), source, None))
		},
		"block" => {
			let identifier = ShellBuildClassifier::extract_diff_filename(node, source);
			let recurse = recurse_into(node, ChunkContext::ClassBody, &[], &["hunks"]);
			let mut candidate =
				make_container_chunk(node, ChunkKind::File, identifier, source, recurse);
			// Always expand hunks so individual @@ sections are addressable,
			// even for small diffs below the leaf threshold.
			candidate.force_recurse = recurse.is_some();
			Some(candidate)
		},
		_ => None,
	}
}
