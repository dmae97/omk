//! Language-specific chunk classification for TLA+ / `PlusCal`.
//!
//! The shared defaults are too noisy for TLA+: the parser exposes a top-level
//! `module` wrapper, `PlusCal` algorithms live inside block comments, and the
//! generated translation section introduces operator definitions we do not want
//! to surface in chunked read/edit views.

use tree_sitter::Node;

use super::{
	classify::LangClassifier,
	common::{
		ChunkContext, RawChunkCandidate, RecurseSpec, child_by_kind, extract_identifier,
		group_candidate, make_container_chunk, make_container_chunk_from, make_named_chunk,
		positional_candidate, recurse_self, sanitize_identifier,
	},
	types::ChunkNode,
};

pub struct TlaplusClassifier;

impl LangClassifier for TlaplusClassifier {
	fn classify_root<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		match node.kind() {
			"module" => Some(make_container_chunk(
				node,
				prefixed(node, "mod", source),
				source,
				Some(recurse_self(node, ChunkContext::Root)),
			)),
			"variable_declaration" | "constant_declaration" | "recursive_declaration" => {
				Some(group_candidate(node, "decls", source))
			},
			"operator_definition" => {
				Some(make_named_chunk(node, prefixed(node, "operator", source), source, None))
			},
			"module_definition" => Some(make_container_chunk(
				node,
				prefixed(node, "mod", source),
				source,
				Some(recurse_self(node, ChunkContext::Root)),
			)),
			"pcal_algorithm" => Some(make_container_chunk(
				node,
				prefixed(node, "algo", source),
				source,
				recurse_child(node, "pcal_algorithm_body", ChunkContext::ClassBody),
			)),
			"block_comment" => child_by_kind(node, &["pcal_algorithm"]).map(|algorithm| {
				make_container_chunk_from(
					node,
					algorithm,
					prefixed(algorithm, "algo", source),
					source,
					recurse_child(algorithm, "pcal_algorithm_body", ChunkContext::ClassBody),
				)
			}),
			_ => None,
		}
	}

	fn classify_class<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		match node.kind() {
			"pcal_procedure" => Some(make_container_chunk(
				node,
				prefixed(node, "proc", source),
				source,
				recurse_child(node, "pcal_algorithm_body", ChunkContext::ClassBody),
			)),
			"pcal_process" => Some(make_container_chunk(
				node,
				prefixed(node, "process", source),
				source,
				recurse_child(node, "pcal_algorithm_body", ChunkContext::ClassBody),
			)),
			"pcal_var_decls" => Some(group_candidate(node, "decls", source)),
			_ => None,
		}
	}

	fn classify_function<'t>(&self, node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
		match node.kind() {
			// PlusCal control flow
			"pcal_if" => Some(positional_candidate(node, "if", source)),
			"pcal_while" => Some(positional_candidate(node, "loop", source)),
			"pcal_either" => Some(positional_candidate(node, "either", source)),
			"pcal_with" => Some(positional_candidate(node, "with", source)),
			// PlusCal assignments
			"pcal_assign" => Some(group_candidate(node, "stmts", source)),
			_ => None,
		}
	}

	fn preserve_trivia(&self, kind: &str) -> bool {
		kind == "block_comment"
	}

	fn is_trivia(&self, kind: &str) -> bool {
		matches!(kind, "header_line" | "double_line" | "extends" | "pcal_algorithm_start")
	}

	fn preserve_root_wrapper(&self, kind: &str) -> bool {
		kind == "module"
	}

	fn preserve_children(
		&self,
		parent: &RawChunkCandidate<'_>,
		_children: &[RawChunkCandidate<'_>],
	) -> bool {
		let name = parent.base_name.as_str();
		name.starts_with("mod_")
			|| name.starts_with("algo_")
			|| name.starts_with("proc_")
			|| name.starts_with("process_")
	}

	fn post_process(
		&self,
		chunks: &mut Vec<ChunkNode>,
		root_children: &mut Vec<String>,
		source: &str,
	) {
		let ranges = translation_ranges(source);
		if ranges.is_empty() {
			return;
		}

		let removed_by_range = ranges
			.iter()
			.map(|range| {
				chunks
					.iter()
					.filter(|chunk| {
						!chunk.path.is_empty() && chunk_wholly_inside_translation_fence(chunk, *range)
					})
					.cloned()
					.collect::<Vec<_>>()
			})
			.collect::<Vec<_>>();
		let removed_paths = removed_by_range
			.iter()
			.flatten()
			.map(|chunk| chunk.path.clone())
			.collect::<Vec<_>>();
		if removed_paths.is_empty() {
			return;
		}

		chunks.retain(|chunk| !removed_paths.iter().any(|removed| removed == &chunk.path));
		for chunk in chunks.iter_mut() {
			chunk
				.children
				.retain(|child| !removed_paths.iter().any(|removed| removed == child));
		}
		root_children.retain(|child| !removed_paths.iter().any(|removed| removed == child));

		for (index, range) in ranges.iter().copied().enumerate() {
			let removed_chunks = &removed_by_range[index];
			if removed_chunks.is_empty() {
				continue;
			}
			let synthetic = translation_chunk(range, removed_chunks[0].parent_path.clone(), source);
			let synthetic_path = synthetic.path.clone();
			if let Some(parent_path) = synthetic.parent_path.as_ref() {
				if let Some(parent) = chunks.iter_mut().find(|chunk| chunk.path == *parent_path) {
					parent.children.push(synthetic_path);
				}
			} else {
				root_children.push(synthetic_path);
			}
			chunks.push(synthetic);
		}
	}
}

fn prefixed(node: Node<'_>, prefix: &str, source: &str) -> String {
	let name = extract_identifier(node, source)
		.or_else(|| {
			child_by_kind(node, &["identifier"])
				.and_then(|child| sanitize_identifier(child.utf8_text(source.as_bytes()).ok()?))
		})
		.unwrap_or_else(|| "anonymous".to_string());
	format!("{prefix}_{name}")
}

fn recurse_child<'tree>(
	node: Node<'tree>,
	kind: &'static str,
	context: ChunkContext,
) -> Option<RecurseSpec<'tree>> {
	child_by_kind(node, &[kind]).map(|child| RecurseSpec { node: child, context })
}

#[derive(Clone, Copy)]
struct TranslationRange {
	start_line: u32,
	end_line:   u32,
}

fn translation_ranges(source: &str) -> Vec<TranslationRange> {
	let lines = source.split('\n').collect::<Vec<_>>();
	let mut ranges = Vec::new();
	let mut current_start: Option<u32> = None;

	for (index, line) in lines.iter().enumerate() {
		let line_no = index as u32 + 1;
		let trimmed = line.trim();
		if trimmed == r"\* BEGIN TRANSLATION" {
			current_start = Some(line_no);
			continue;
		}
		if trimmed == r"\* END TRANSLATION"
			&& let Some(start_line) = current_start.take()
		{
			push_translation_range(&mut ranges, start_line, line_no, lines.len() as u32);
		}
	}

	if let Some(start_line) = current_start {
		push_translation_range(&mut ranges, start_line, lines.len() as u32, lines.len() as u32);
	}

	ranges
}

fn push_translation_range(
	ranges: &mut Vec<TranslationRange>,
	start_line: u32,
	end_line: u32,
	total_lines: u32,
) {
	let clamped_end = end_line.min(total_lines.max(start_line));
	ranges.push(TranslationRange { start_line, end_line: clamped_end });
}

/// True when the chunk's span lies entirely inside the `\* BEGIN` … `\* END`
/// translation fence. We must not treat broad containers (e.g. the `module`
/// chunk spanning the whole file) as translation-only, or the module node is
/// removed and children become orphaned.
const fn chunk_wholly_inside_translation_fence(chunk: &ChunkNode, range: TranslationRange) -> bool {
	chunk.start_line >= range.start_line && chunk.end_line <= range.end_line
}

fn translation_chunk(
	range: TranslationRange,
	parent_path: Option<String>,
	source: &str,
) -> ChunkNode {
	let path = match &parent_path {
		Some(parent) => format!("{parent}.translation_{}", range.start_line),
		None => format!("translation_{}", range.start_line),
	};
	let (start_byte, end_byte) = byte_range_for_lines(source, range.start_line, range.end_line);
	let checksum = super::chunk_checksum(&source.as_bytes()[start_byte as usize..end_byte as usize]);
	ChunkNode {
		path,
		name: format!("translation_{}", range.start_line),
		leaf: true,
		parent_path,
		children: Vec::new(),
		signature: Some("translation block".to_string()),
		start_line: range.start_line,
		end_line: range.end_line,
		line_count: range.end_line.saturating_sub(range.start_line) + 1,
		start_byte,
		end_byte,
		checksum_start_byte: start_byte,
		prologue_end_byte: None,
		epilogue_start_byte: None,
		checksum,
		error: false,
		indent: 0,
		indent_char: String::new(),
		group: false,
	}
}

fn byte_range_for_lines(source: &str, start_line: u32, end_line: u32) -> (u32, u32) {
	let mut start_byte = 0usize;
	let mut current_line = 1u32;
	for (byte_index, byte) in source.bytes().enumerate() {
		if current_line == start_line {
			start_byte = byte_index;
			break;
		}
		if byte == b'\n' {
			current_line += 1;
			start_byte = byte_index + 1;
		}
	}

	let mut end_byte = source.len();
	current_line = 1;
	for (byte_index, byte) in source.bytes().enumerate() {
		if current_line > end_line {
			end_byte = byte_index;
			break;
		}
		if byte == b'\n' {
			current_line += 1;
			if current_line > end_line {
				end_byte = byte_index + 1;
				break;
			}
		}
	}

	(start_byte as u32, end_byte as u32)
}
