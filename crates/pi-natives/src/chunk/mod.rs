//! Chunk-tree parsing powered by tree-sitter with best-effort structural
//! grouping.
//!
//! The module is split into:
//! - `types` — napi-exported data structures
//! - `common` — shared helpers used by all classifiers
//! - `defaults` — default classification logic (language-agnostic node kinds)
//! - `classify` — `LangClassifier` trait and dispatch
//! - `ast_*` — per-language classifier implementations

mod classify;
pub(crate) mod common;
mod defaults;
pub mod types;

// Per-language classifiers
mod ast_bash_make_diff;
mod ast_c_cpp_objc;
mod ast_clojure;
mod ast_csharp_java;
mod ast_css;
mod ast_data_formats;
mod ast_elixir;
mod ast_go;
mod ast_haskell_scala;
mod ast_html_xml;
mod ast_js_ts;
mod ast_markup;
mod ast_misc;
mod ast_nix_hcl;
mod ast_python;
mod ast_ruby_lua;
mod ast_rust;
mod ast_tlaplus;
mod render;

use std::collections::HashMap;

use ast_grep_core::tree_sitter::LanguageExt;
use napi::{Error, Result};
use napi_derive::napi;
use tree_sitter::{Node, Parser, Tree};
use xxhash_rust::xxh64::xxh64;

pub use self::types::{ChunkNode, ChunkTree, RenderChunkTreeParams};
use self::{
	classify::{LangClassifier, classifier_for},
	common::*,
	render::{line_to_containing_chunk_path, render_chunk_tree},
};
use crate::language::SupportLang;

// ── Napi exports ─────────────────────────────────────────────────────────

#[napi(js_name = "parseChunkTree")]
pub fn parse_chunk_tree(source: String, language: String) -> Result<ChunkTree> {
	build_chunk_tree(source.as_str(), language.as_str())
}

#[napi(js_name = "resolveChunkPath")]
pub fn resolve_chunk_path(tree: ChunkTree, chunk_path: String) -> Option<ChunkNode> {
	tree
		.chunks
		.iter()
		.find(|chunk| chunk.path == chunk_path)
		.cloned()
}

#[napi(js_name = "lineToChunkPath")]
pub fn line_to_chunk_path(tree: ChunkTree, line: u32) -> Option<String> {
	if line == 0 {
		return None;
	}

	tree
		.chunks
		.iter()
		.filter(|chunk| {
			chunk.kind == "leaf"
				&& chunk.start_line <= line
				&& line <= chunk.end_line
				&& !chunk.path.is_empty()
		})
		.min_by_key(|chunk| chunk.line_count)
		.map(|chunk| chunk.path.clone())
		.or_else(|| {
			tree
				.chunks
				.iter()
				.find(|chunk| {
					chunk.path.is_empty() && (chunk.start_line == 0 || line <= chunk.end_line)
				})
				.map(|chunk| chunk.path.clone())
		})
}
#[napi(js_name = "lineToContainingChunkPath")]
pub fn line_to_containing_chunk_path_napi(tree: ChunkTree, line: u32) -> Option<String> {
	line_to_containing_chunk_path(&tree, line)
}

#[napi(js_name = "renderChunkTree")]
pub fn render_chunk_tree_napi(params: RenderChunkTreeParams) -> Result<String> {
	Ok(render_chunk_tree(&params))
}

// ── Core build logic ─────────────────────────────────────────────────────

pub(crate) fn build_chunk_tree(source: &str, language: &str) -> Result<ChunkTree> {
	let normalized_language = language.trim().to_ascii_lowercase();
	let total_lines = total_line_count(source);
	let root_checksum = chunk_checksum(source.as_bytes());

	let Some(chunk_lang) = resolve_chunk_lang(normalized_language.as_str()) else {
		return Ok(build_blank_line_tree(source, language.to_string(), total_lines, root_checksum));
	};

	let classifier = classifier_for(normalized_language.as_str());
	let tree = parse_tree(source, chunk_lang)?;
	let root = tree.root_node();
	let parse_errors = count_parse_errors(root);
	let mut acc = ChunkAccumulator::default();
	let mut root_children =
		collect_children_for_context(root, ChunkContext::Root, source, classifier)
			.into_iter()
			.map(|candidate| build_chunk(candidate, "", source, &mut acc, classifier))
			.collect::<Vec<_>>();

	classifier.post_process(&mut acc.chunks, &mut root_children, source);

	insert_file_preamble_chunk(source, &mut acc.chunks, &mut root_children);

	acc.chunks.insert(0, ChunkNode {
		path:        String::new(),
		name:        "<root>".to_string(),
		kind:        "branch".to_string(),
		parent_path: None,
		children:    root_children.clone(),
		signature:   None,
		start_line:  u32::from(total_lines != 0),
		end_line:    total_lines as u32,
		line_count:  total_lines as u32,
		start_byte:  0,
		end_byte:    source.len() as u32,
		checksum:    root_checksum.clone(),
		error:       false,
		indent:      0,
		indent_char: String::new(),
	});

	Ok(ChunkTree {
		language: normalized_language,
		checksum: root_checksum,
		line_count: total_lines as u32,
		parse_errors: parse_errors as u32,
		fallback: false,
		root_path: String::new(),
		root_children,
		chunks: acc.chunks,
	})
}

fn parse_tree(source: &str, language: SupportLang) -> Result<Tree> {
	let mut parser = Parser::new();
	let ts_language = language.get_ts_language();
	parser
		.set_language(&ts_language)
		.map_err(|err| Error::from_reason(format!("Failed to set parser language: {err}")))?;
	parser
		.parse(source, None)
		.ok_or_else(|| Error::from_reason("Tree-sitter failed to parse source".to_string()))
}

fn build_blank_line_tree(
	source: &str,
	language: String,
	total_lines: usize,
	checksum: String,
) -> ChunkTree {
	let mut chunks = vec![ChunkNode {
		path:        String::new(),
		name:        "<root>".to_string(),
		kind:        "branch".to_string(),
		parent_path: None,
		children:    Vec::new(),
		signature:   None,
		start_line:  u32::from(total_lines != 0),
		end_line:    total_lines as u32,
		line_count:  total_lines as u32,
		start_byte:  0,
		end_byte:    source.len() as u32,
		checksum:    checksum.clone(),
		error:       false,
		indent:      0,
		indent_char: String::new(),
	}];
	let line_starts = line_start_offsets(source);
	let mut root_children = Vec::new();
	let mut seen_names = HashMap::<String, usize>::new();
	let lines: Vec<&str> = if source.is_empty() {
		Vec::new()
	} else {
		source.split('\n').collect()
	};
	let mut start_line = 0usize;

	while start_line < lines.len() {
		while start_line < lines.len() && lines[start_line].trim().is_empty() {
			start_line += 1;
		}
		if start_line >= lines.len() {
			break;
		}

		let mut end_line = start_line;
		while end_line + 1 < lines.len() && !lines[end_line + 1].trim().is_empty() {
			end_line += 1;
		}

		let name = infer_fallback_block_name(lines[start_line], &mut seen_names);
		let start_byte = line_starts[start_line];
		let end_byte = line_end_offset(source, &line_starts, end_line);
		root_children.push(name.clone());
		chunks.push(ChunkNode {
			path:        name.clone(),
			name:        name.clone(),
			kind:        "leaf".to_string(),
			parent_path: Some(String::new()),
			children:    Vec::new(),
			signature:   None,
			start_line:  (start_line + 1) as u32,
			end_line:    (end_line + 1) as u32,
			line_count:  (end_line - start_line + 1) as u32,
			start_byte:  start_byte as u32,
			end_byte:    end_byte as u32,
			checksum:    chunk_checksum(
				source
					.as_bytes()
					.get(start_byte..end_byte)
					.unwrap_or_default(),
			),
			error:       false,
			indent:      0,
			indent_char: String::new(),
		});
		start_line = end_line + 1;
	}

	if let Some(root) = chunks.first_mut() {
		root.children.clone_from(&root_children);
	}

	ChunkTree {
		language,
		checksum,
		line_count: total_lines as u32,
		parse_errors: 0,
		fallback: true,
		root_path: String::new(),
		root_children,
		chunks,
	}
}

// ── Chunk building ───────────────────────────────────────────────────────

fn build_chunk(
	candidate: RawChunkCandidate<'_>,
	parent_path: &str,
	source: &str,
	acc: &mut ChunkAccumulator,
	classifier: &dyn classify::LangClassifier,
) -> String {
	let path = if parent_path.is_empty() {
		candidate.base_name.clone()
	} else {
		format!("{parent_path}.{}", candidate.base_name)
	};
	let line_count = candidate
		.range_end_line
		.saturating_sub(candidate.range_start_line)
		+ 1;
	let checksum = chunk_checksum(
		source
			.as_bytes()
			.get(candidate.checksum_start_byte..candidate.range_end_byte)
			.unwrap_or_default(),
	);
	let recurse = candidate.recurse;
	let child_candidates = recurse
		.map(|recurse| {
			collect_children_for_context(recurse.node, recurse.context, source, classifier)
		})
		.unwrap_or_default();
	let recurse_parse_errors = recurse.map_or(0, |recurse| count_parse_errors(recurse.node));
	let should_collapse = !classifier.preserve_children(&candidate, &child_candidates)
		&& recurse.is_some()
		&& recurse_parse_errors == 0
		&& should_collapse_trivial_children(&candidate, &child_candidates);
	let should_recurse = !candidate.error
		&& recurse.is_some()
		&& !should_collapse
		&& (candidate.force_recurse
			|| recurse_parse_errors > 0
			|| (line_count > *LEAF_THRESHOLD
				&& recursion_narrows_scope(line_count, &child_candidates)));
	let children = if should_recurse {
		child_candidates
			.into_iter()
			.map(|child| build_chunk(child, path.as_str(), source, acc, classifier))
			.collect::<Vec<_>>()
	} else {
		Vec::new()
	};

	let kind = if !children.is_empty() || (candidate.force_recurse && !should_collapse) {
		"branch"
	} else {
		"leaf"
	};
	let (indent, indent_char) = detect_indent(source, candidate.range_start_byte);
	acc.chunks.push(ChunkNode {
		path: path.clone(),
		name: candidate.base_name,
		kind: kind.to_string(),
		parent_path: Some(parent_path.to_string()),
		children,
		signature: candidate.signature,
		start_line: candidate.range_start_line as u32,
		end_line: candidate.range_end_line as u32,
		line_count: line_count as u32,
		start_byte: candidate.range_start_byte as u32,
		end_byte: candidate.range_end_byte as u32,
		checksum,
		error: candidate.error,
		indent,
		indent_char,
	});
	path
}

// ── Child collection ─────────────────────────────────────────────────────

pub(crate) fn collect_children_for_context<'tree>(
	container: Node<'tree>,
	context: ChunkContext,
	source: &str,
	classifier: &dyn LangClassifier,
) -> Vec<RawChunkCandidate<'tree>> {
	let named_children_list = children_for_context(container, context, classifier);
	let mut raw = Vec::new();

	for (index, child) in named_children_list.iter().enumerate() {
		let is_skippable_trivia = (is_trivia(child.kind()) || classifier.is_trivia(child.kind()))
			&& !classifier.preserve_trivia(child.kind());
		if is_skippable_trivia || child.is_missing() {
			continue;
		}

		let mut candidate = classify_node(*child, context, source, classifier);
		attach_leading_trivia(&mut candidate, &named_children_list, index, classifier);
		raw.push(candidate);
	}

	group_candidates(raw)
}

fn children_for_context<'tree>(
	container: Node<'tree>,
	context: ChunkContext,
	classifier: &dyn LangClassifier,
) -> Vec<Node<'tree>> {
	match context {
		ChunkContext::Root => flatten_root_children(container, classifier),
		ChunkContext::ClassBody | ChunkContext::FunctionBody => named_children(container),
	}
}

fn flatten_root_children<'tree>(
	container: Node<'tree>,
	classifier: &dyn LangClassifier,
) -> Vec<Node<'tree>> {
	let children = named_children(container);
	if children.len() == 1
		&& ((is_root_wrapper_kind(children[0].kind())
			&& !classifier.preserve_root_wrapper(children[0].kind()))
			|| classifier.is_root_wrapper(children[0].kind()))
	{
		return flatten_root_children(children[0], classifier);
	}
	children
}

fn classify_node<'tree>(
	node: Node<'tree>,
	context: ChunkContext,
	source: &str,
	classifier: &dyn LangClassifier,
) -> RawChunkCandidate<'tree> {
	if node.is_error() || node.kind() == "ERROR" {
		return make_candidate(
			node,
			"<error>".to_string(),
			NameStyle::Error,
			None,
			None,
			false,
			source,
		);
	}

	// Try language-specific classifier first, then fall back to defaults.
	match context {
		ChunkContext::Root => classifier
			.classify_root(node, source)
			.unwrap_or_else(|| defaults::classify_root_default(node, source)),
		ChunkContext::ClassBody => classifier
			.classify_class(node, source)
			.unwrap_or_else(|| defaults::classify_class_default(node, source)),
		ChunkContext::FunctionBody => classifier
			.classify_function(node, source)
			.unwrap_or_else(|| defaults::classify_function_default(node, source)),
	}
}

fn attach_leading_trivia<'tree>(
	candidate: &mut RawChunkCandidate<'tree>,
	named_children_list: &[Node<'tree>],
	index: usize,
	classifier: &dyn LangClassifier,
) {
	let mut cursor = index;
	while cursor > 0 {
		let prev = named_children_list[cursor - 1];
		if !is_trivia(prev.kind())
			&& !is_absorbable_attribute(prev.kind())
			&& !classifier.is_trivia(prev.kind())
			&& !classifier.is_absorbable_attr(prev.kind())
		{
			break;
		}

		let prev_end_line = prev.end_position().row + 1;
		if candidate.range_start_line > prev_end_line + 1 {
			break;
		}

		candidate.range_start_byte = prev.start_byte();
		candidate.range_start_line = prev.start_position().row + 1;
		if prev.kind() == "comment" {
			candidate.has_leading_comment = true;
		}
		cursor -= 1;
	}
}

// ── Grouping / deduplication ─────────────────────────────────────────────

fn group_candidates(candidates: Vec<RawChunkCandidate<'_>>) -> Vec<RawChunkCandidate<'_>> {
	let mut grouped: Vec<RawChunkCandidate<'_>> = Vec::new();

	for candidate in candidates {
		if let Some(last) = grouped.last_mut() {
			let last_line_count = line_span(last.range_start_line, last.range_end_line);
			let next_line_count = line_span(candidate.range_start_line, candidate.range_end_line);
			let can_merge = last.groupable
				&& candidate.groupable
				&& last.base_name == candidate.base_name
				&& !candidate.has_leading_comment
				&& candidate.range_start_line <= last.range_end_line + 1
				&& last_line_count + next_line_count <= *MAX_CHUNK_LINES;
			if can_merge {
				last.range_end_byte = candidate.range_end_byte;
				last.range_end_line = candidate.range_end_line;
				continue;
			}
		}
		grouped.push(candidate);
	}

	assign_unique_names(grouped)
}

fn assign_unique_names(mut candidates: Vec<RawChunkCandidate<'_>>) -> Vec<RawChunkCandidate<'_>> {
	let mut totals = HashMap::<String, usize>::new();
	for candidate in &candidates {
		*totals.entry(candidate.base_name.clone()).or_insert(0) += 1;
	}
	let mut seen = HashMap::<String, usize>::new();

	for candidate in &mut candidates {
		let count = seen.entry(candidate.base_name.clone()).or_insert(0);
		*count += 1;
		let occurrence = *count;
		let total = *totals.get(candidate.base_name.as_str()).unwrap_or(&1);

		candidate.base_name = match candidate.name_style {
			NameStyle::Error => {
				if total > 1 {
					format!("error_{occurrence}")
				} else {
					"error".to_string()
				}
			},
			NameStyle::Named => {
				if total > 1 {
					format!("{}_{}", candidate.base_name, occurrence)
				} else {
					candidate.base_name.clone()
				}
			},
			NameStyle::Group => {
				if total == 1 || occurrence == 1 {
					candidate.base_name.clone()
				} else {
					format!("{}_{}", candidate.base_name, occurrence)
				}
			},
		};
	}

	candidates
}

// ── Collapse heuristics ──────────────────────────────────────────────────

/// Returns `true` when splitting a parent into children actually provides
/// meaningful scope narrowing. Recursion is only worthwhile if addressing
/// the largest child saves at least `PI_CHUNK_MIN_SAVINGS` lines compared
/// to addressing the parent directly.
fn recursion_narrows_scope(parent_lines: usize, children: &[RawChunkCandidate<'_>]) -> bool {
	if children.is_empty() {
		return false;
	}
	let max_child_lines = children
		.iter()
		.map(|c| line_span(c.range_start_line, c.range_end_line))
		.max()
		.unwrap_or(0);
	parent_lines.saturating_sub(max_child_lines) >= *MIN_RECURSE_SAVINGS
}

fn should_collapse_trivial_children(
	parent: &RawChunkCandidate<'_>,
	children: &[RawChunkCandidate<'_>],
) -> bool {
	if children.is_empty() {
		return false;
	}

	let has_addressable_leaf_members = children.iter().all(|child| {
		child.base_name.starts_with("field_") || child.base_name.starts_with("variant_")
	});
	if has_addressable_leaf_members
		&& (parent.base_name.starts_with("struct_")
			|| parent.base_name.starts_with("enum_")
			|| parent.base_name.starts_with("type_"))
	{
		return false;
	}

	if children.len() == 1 && is_collapsible_flat_child(&children[0]) {
		return true;
	}

	if !children.iter().all(is_collapsible_flat_child) {
		return false;
	}
	let total_lines: usize = children
		.iter()
		.map(|c| line_span(c.range_start_line, c.range_end_line))
		.sum();
	total_lines <= *LEAF_THRESHOLD
}

const fn is_trivial_child_candidate(candidate: &RawChunkCandidate<'_>) -> bool {
	!candidate.error
		&& !candidate.has_leading_comment
		&& candidate.recurse.is_none()
		&& line_span(candidate.range_start_line, candidate.range_end_line) == 1
}

const fn is_collapsible_flat_child(candidate: &RawChunkCandidate<'_>) -> bool {
	(candidate.groupable || is_trivial_child_candidate(candidate))
		&& !candidate.error
		&& !candidate.has_leading_comment
		&& candidate.recurse.is_none()
}

// ── Utility ──────────────────────────────────────────────────────────────

fn count_parse_errors(node: Node<'_>) -> usize {
	let mut count = usize::from(node.is_error() || node.is_missing());
	for child in named_children(node) {
		count += count_parse_errors(child);
	}
	count
}

fn resolve_chunk_lang(language: &str) -> Option<SupportLang> {
	SupportLang::from_alias(language)
}

fn infer_fallback_block_name(first_line: &str, seen: &mut HashMap<String, usize>) -> String {
	let trimmed = first_line.trim();
	let base = trimmed
		.split(|c: char| !c.is_alphanumeric() && c != '_' && c != '-')
		.next()
		.unwrap_or("")
		.trim_matches(|c: char| !c.is_alphanumeric() && c != '_');
	let base = if base.is_empty() { "chunk" } else { base };
	let count = seen.entry(base.to_string()).or_insert(0);
	*count += 1;
	if *count == 1 {
		base.to_string()
	} else {
		format!("{base}#{count}")
	}
}

fn line_start_offsets(source: &str) -> Vec<usize> {
	let mut starts = vec![0usize];
	for (index, byte) in source.bytes().enumerate() {
		if byte == b'\n' {
			starts.push(index + 1);
		}
	}
	starts
}

fn line_end_offset(source: &str, line_starts: &[usize], line_index: usize) -> usize {
	if line_index + 1 < line_starts.len() {
		line_starts[line_index + 1]
	} else {
		source.len()
	}
}

/// Same 16-character nibble alphabet as
/// `packages/coding-agent/src/patch/hashline.ts` (no digits).
const HASHLINE_NIBBLE_ALPHABET: &[u8; 16] = b"ZPMQVRWSNKTXJBYH";

/// Low 16 bits of XXH64, encoded as four letters (two bytes × two nibbles
/// each).
pub(crate) fn chunk_checksum(bytes: &[u8]) -> String {
	let h = xxh64(bytes, 0);
	let w = (h & 0xffff) as u16;
	let b0 = (w >> 8) as u8;
	let b1 = (w & 0xff) as u8;
	let mut out = String::with_capacity(4);
	for byte in [b0, b1] {
		let hi = usize::from(byte >> 4);
		let lo = usize::from(byte & 0x0f);
		out.push(char::from(HASHLINE_NIBBLE_ALPHABET[hi]));
		out.push(char::from(HASHLINE_NIBBLE_ALPHABET[lo]));
	}
	out
}

/// When the first structural chunk begins after line 1, insert a leaf chunk
/// `file_preamble` covering leading comments/whitespace so they stay
/// addressable via chunk paths (not only raw line ops).
fn insert_file_preamble_chunk(
	source: &str,
	chunks: &mut Vec<ChunkNode>,
	root_children: &mut Vec<String>,
) {
	if root_children.is_empty() {
		return;
	}
	if chunks.iter().any(|c| c.path == "file_preamble")
		|| root_children.iter().any(|p| p == "file_preamble")
	{
		return;
	}
	let mut min_start = u32::MAX;
	for path in root_children.iter() {
		if let Some(chunk) = chunks.iter().find(|c| c.path == *path) {
			min_start = min_start.min(chunk.start_line);
		}
	}
	if min_start <= 1 {
		return;
	}
	let line_starts = line_start_offsets(source);
	let start_byte: u32 = 0;
	let end_byte = line_starts
		.get(min_start as usize - 1)
		.copied()
		.unwrap_or(source.len()) as u32;
	if end_byte <= start_byte {
		return;
	}
	let preamble_end_line = min_start - 1;
	let line_count = preamble_end_line;
	let checksum = chunk_checksum(
		source
			.as_bytes()
			.get(start_byte as usize..end_byte as usize)
			.unwrap_or_default(),
	);
	let preamble = ChunkNode {
		path: "file_preamble".to_string(),
		name: "file_preamble".to_string(),
		kind: "leaf".to_string(),
		parent_path: Some(String::new()),
		children: Vec::new(),
		signature: None,
		start_line: 1,
		end_line: preamble_end_line,
		line_count,
		start_byte,
		end_byte,
		checksum,
		error: false,
		indent: 0,
		indent_char: String::new(),
	};
	chunks.push(preamble);
	root_children.insert(0, "file_preamble".to_string());
}

pub(crate) fn sort_chunk_children_by_position(chunks: &mut [ChunkNode]) {
	let positions = chunks
		.iter()
		.map(|chunk| (chunk.path.clone(), (chunk.start_line, chunk.end_line)))
		.collect::<HashMap<_, _>>();
	for chunk in chunks.iter_mut() {
		chunk.children.sort_by(|left, right| {
			let left_pos = positions.get(left).copied().unwrap_or((u32::MAX, u32::MAX));
			let right_pos = positions
				.get(right)
				.copied()
				.unwrap_or((u32::MAX, u32::MAX));
			left_pos.cmp(&right_pos).then_with(|| left.cmp(right))
		});
	}
}

pub(crate) fn rename_chunk_subtree(
	chunks: &mut [ChunkNode],
	old_prefix: &str,
	new_prefix: &str,
	new_parent_path: &str,
) {
	let old_child_prefix = format!("{old_prefix}.");
	for chunk in chunks.iter_mut() {
		if chunk.path == old_prefix {
			chunk.path = new_prefix.to_string();
			chunk.parent_path = Some(new_parent_path.to_string());
		} else if let Some(rest) = chunk.path.strip_prefix(old_child_prefix.as_str()) {
			chunk.path = format!("{new_prefix}.{rest}");
		}

		if let Some(parent_path) = chunk.parent_path.as_mut() {
			if parent_path == old_prefix {
				*parent_path = new_prefix.to_string();
			} else if let Some(rest) = parent_path.strip_prefix(old_child_prefix.as_str()) {
				*parent_path = format!("{new_prefix}.{rest}");
			}
		}

		for child_path in &mut chunk.children {
			if child_path == old_prefix {
				*child_path = new_prefix.to_string();
			} else if let Some(rest) = child_path.strip_prefix(old_child_prefix.as_str()) {
				*child_path = format!("{new_prefix}.{rest}");
			}
		}
	}
}

// ── Tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
	use std::fmt::Write as _;

	use super::{build_chunk_tree, line_to_chunk_path, resolve_chunk_lang};
	use crate::language::SupportLang;

	fn assert_supported_sample(language: &str, source: &str) {
		let tree = build_chunk_tree(source, language)
			.unwrap_or_else(|err| panic!("expected {language} sample to parse: {err}"));
		assert!(!tree.fallback, "{language} unexpectedly fell back to blank-line chunking");
		assert_eq!(tree.parse_errors, 0, "{language} sample should parse cleanly");
		assert!(
			!tree.root_children.is_empty(),
			"{language} should expose at least one structural chunk"
		);
	}

	#[test]
	fn resolves_every_supported_canonical_language() {
		for language in SupportLang::all_langs() {
			assert_eq!(
				resolve_chunk_lang(language.canonical_name()),
				Some(*language),
				"missing canonical alias for {}",
				language.canonical_name()
			);
		}
	}

	#[test]
	fn resolves_handlebars_and_tlaplus_aliases() {
		assert_eq!(resolve_chunk_lang("handlebars"), Some(SupportLang::Handlebars));
		assert_eq!(resolve_chunk_lang("hbs"), Some(SupportLang::Handlebars));
		assert_eq!(resolve_chunk_lang("hsb"), Some(SupportLang::Handlebars));
		assert_eq!(resolve_chunk_lang("tla"), Some(SupportLang::Tlaplus));
		assert_eq!(resolve_chunk_lang("pluscal"), Some(SupportLang::Tlaplus));
	}

	#[test]
	fn builds_structural_tree_for_each_supported_language() {
		let cases = [
			("bash", "build() { echo ok; }\n"),
			("c", "#include <stdio.h>\nint main(void) { return 0; }\n"),
			("cpp", "#include <vector>\nclass App {};\nint main() { return 0; }\n"),
			("csharp", "using System;\nclass App { void Run() {} }\n"),
			("clojure", "(ns demo.core)\n(defn greet [x] x)\n"),
			("css", "@import \"a.css\";\n.app { color: red; }\n"),
			("diff", "@@ -1,1 +1,1 @@\n-a\n+b\n"),
			("elixir", "defmodule App do\n  def run(x) do\n    x\n  end\nend\n"),
			("go", "package main\nimport \"fmt\"\nfunc main() { fmt.Println(\"ok\") }\n"),
			("handlebars", "{{#if ready}}<div class=\"ok\">{{name}}</div>{{/if}}\n"),
			("haskell", "module App where\nimport Data.List\nmain = putStrLn \"ok\"\n"),
			("hcl", "locals { foo = 1 }\n"),
			("html", "<div><span>ok</span></div>\n"),
			("java", "import java.util.*;\nclass App { void run() {} }\n"),
			("javascript", "import x from \"x\";\nexport function run() {}\n"),
			("json", "{\"name\":\"app\",\"scripts\":{\"start\":\"bun\"}}\n"),
			("julia", "module App\nfunction run(x)\n  x\nend\nend\n"),
			("kotlin", "package app\nclass App { fun run() {} }\n"),
			("lua", "local function run(x) return x end\n"),
			("make", "all:\n\t@echo hi\n"),
			("markdown", "# Title\n\n## Child\n\ntext\n"),
			("nix", "{ hello = \"world\"; }\n"),
			(
				"objc",
				"#import <Foundation/Foundation.h>\n@interface App : NSObject\n- (void)run;\n@end\n",
			),
			("odin", "package main\nmain :: proc() {}\n"),
			("php", "<?php\nclass App { function run() {} }\n"),
			("python", "class App:\n    def run(self):\n        return 1\n"),
			("regex", "[a-z]+"),
			("ruby", "module App\n  class User\n    def run\n    end\n  end\nend\n"),
			("rust", "use std::fmt;\nfn main() {}\n"),
			("scala", "package demo\nobject App { def run(): Unit = {} }\n"),
			("solidity", "pragma solidity ^0.8.0;\ncontract App { function run() public {} }\n"),
			("starlark", "def build(ctx):\n    pass\n"),
			("swift", "import Foundation\nclass App { func run() {} }\n"),
			("toml", "[package]\nname = \"app\"\n"),
			(
				"tlaplus",
				"---- MODULE Spec ----\nVARIABLE x\n\n(* --algorithm Demo\nvariables x = 0;\nbegin\n  \
				 Inc:\n    x := x + 1;\nend algorithm; *)\n====\n",
			),
			("tsx", "export function App() { return <div />; }\n"),
			("typescript", "export function run(): void {}\n"),
			("verilog", "module app; endmodule\n"),
			("xml", "<root><item /></root>\n"),
			("yaml", "apiVersion: v1\nmetadata:\n  name: app\n"),
			("zig", "const std = @import(\"std\");\npub fn main() void {}\n"),
		];

		for (language, source) in cases {
			assert_supported_sample(language, source);
		}
	}

	#[test]
	fn tlaplus_keeps_module_and_hides_translation_generated_chunks() {
		let tree = build_chunk_tree(
			"---- MODULE Spec ----\nVARIABLE x\n\nInit == x = 0\n\n(* --algorithm Demo\nvariables x \
			 = 0;\nbegin\n  Inc:\n    x := x + 1;\nend algorithm; *)\n\\* BEGIN \
			 TRANSLATION\nVARIABLES pc\nNext == pc' = pc\n\\* END TRANSLATION\n====\n",
			"tlaplus",
		)
		.expect("tlaplus tree should build");

		assert_eq!(tree.root_children, vec!["mod_Spec"]);

		let module = tree
			.chunks
			.iter()
			.find(|chunk| chunk.path == "mod_Spec")
			.expect("mod_Spec chunk should exist");
		assert!(
			module
				.children
				.iter()
				.any(|child| child == "mod_Spec.operator_Init"),
			"expected Init operator child, got {:?}",
			module.children
		);
		assert!(
			module
				.children
				.iter()
				.any(|child| child == "mod_Spec.translation_12"),
			"expected synthetic translation chunk, got {:?}",
			module.children
		);
		assert!(
			tree
				.chunks
				.iter()
				.all(|chunk| !chunk.path.ends_with("operator_Next")),
			"translation-generated operator should be hidden: {:?}",
			tree
				.chunks
				.iter()
				.map(|chunk| chunk.path.as_str())
				.collect::<Vec<_>>()
		);
	}

	#[test]
	fn json_and_hcl_chunk_names_are_structural() {
		let json = build_chunk_tree("{\"scripts\":{\"start\":\"bun\"}}\n", "json")
			.expect("json tree should build");
		assert!(
			json.root_children.contains(&"key_scripts".to_string()),
			"expected key_scripts, got {:?}",
			json.root_children
		);

		let hcl = build_chunk_tree("locals { foo = 1 }\n", "hcl").expect("hcl tree should build");
		assert!(
			hcl.root_children.contains(&"block_locals".to_string()),
			"expected block_locals, got {:?}",
			hcl.root_children
		);
	}

	#[test]
	fn handlebars_chunks_blocks_and_tags() {
		let tree =
			build_chunk_tree("{{#if ready}}<div class=\"ok\">{{name}}</div>{{/if}}\n", "handlebars")
				.expect("handlebars tree should build");
		assert!(
			tree.root_children.contains(&"block_if".to_string()),
			"expected block_if, got {:?}",
			tree.root_children
		);
		let block = tree
			.chunks
			.iter()
			.find(|chunk| chunk.path == "block_if")
			.expect("block_if chunk should exist");
		assert_eq!(block.kind, "branch");
		assert!(
			block
				.children
				.iter()
				.any(|child| child == "block_if.tag_div"),
			"expected nested div tag, got {:?}",
			block.children
		);
	}

	#[test]
	fn builds_typescript_chunk_tree() {
		let source = format!(
			r#"import a from "a";
import b from "b";

class Bla extends Base {{
	value = 1;

	constructor(config: Config) {{
		this.value = config.value;
	}}

	async onEvent(ev: Event, ctx?: Context): Promise<void> {{
		if (!ev) return;
{body}
	}}
}}

function main(): void {{
	console.log("ok");
}}
"#,
			body = (0..60)
				.map(|index| format!("\t\tthis.value += {index};"))
				.collect::<Vec<_>>()
				.join("\n"),
		);

		let tree = build_chunk_tree(source.as_str(), "typescript").expect("tree should build");
		let child_names = tree
			.root_children
			.iter()
			.map(std::string::String::as_str)
			.collect::<Vec<_>>();
		assert_eq!(child_names, vec!["imports", "class_Bla", "fn_main"]);

		let class_chunk = tree
			.chunks
			.iter()
			.find(|chunk| chunk.path == "class_Bla")
			.expect("class chunk should exist");
		assert_eq!(class_chunk.kind, "branch");
		assert!(
			class_chunk
				.children
				.iter()
				.any(|child| child == "class_Bla.constructor")
		);
		assert!(
			class_chunk
				.children
				.iter()
				.any(|child| child == "class_Bla.fn_onEvent")
		);

		let line_path = line_to_chunk_path(tree.clone(), 15).expect("line should resolve");
		assert!(line_path.starts_with("class_Bla.fn_onEvent"));
	}

	#[test]
	fn surfaces_error_chunks() {
		let source = r"class Broken {
	method() {
		if (
	}

	ok(): void {
		return;
	}
}
";

		let tree = build_chunk_tree(source, "typescript").expect("tree should build");
		assert!(tree.parse_errors > 0);
		assert!(tree.chunks.iter().any(|chunk| chunk.name == "error"));
	}

	#[test]
	fn falls_back_to_blank_line_blocks() {
		let source = "A=1\nB=2\n\nC=3\n";
		let tree = build_chunk_tree(source, "env").expect("fallback tree should build");
		assert!(tree.fallback);
		assert_eq!(tree.root_children, vec!["A", "C"]);
	}

	#[test]
	fn always_recurses_small_class() {
		let source = r"class Tiny {
	foo() { return 1; }
	bar() { return 2; }
}";
		let tree = build_chunk_tree(source, "typescript").expect("tree should build");
		let class_chunk = tree
			.chunks
			.iter()
			.find(|c| c.path == "class_Tiny")
			.expect("class_Tiny");
		assert_eq!(class_chunk.kind, "branch");
		assert!(
			class_chunk
				.children
				.iter()
				.any(|c| c == "class_Tiny.fn_foo")
		);
		assert!(
			class_chunk
				.children
				.iter()
				.any(|c| c == "class_Tiny.fn_bar")
		);
	}

	#[test]
	fn empty_class_is_a_branch() {
		let source = r"class Empty {}";
		let tree = build_chunk_tree(source, "typescript").expect("tree should build");
		let class_chunk = tree
			.chunks
			.iter()
			.find(|c| c.path == "class_Empty")
			.expect("class_Empty");
		assert_eq!(class_chunk.kind, "branch");
	}

	#[test]
	fn promotes_arrow_function_to_fn_chunk() {
		let source = r"const handler = (ev) => {
	console.log(ev);
	return ev;
};";
		let tree = build_chunk_tree(source, "typescript").expect("tree should build");
		assert!(tree.chunks.iter().any(|c| c.path == "fn_handler"), "expected fn_handler chunk");
		assert!(
			!tree.root_children.contains(&"decls".to_string()),
			"arrow fn should not be grouped as decls"
		);
	}

	#[test]
	fn promotes_const_class_expression() {
		let source = r"const Foo = class {
	method() { return 42; }
};";
		let tree = build_chunk_tree(source, "typescript").expect("tree should build");
		assert!(tree.chunks.iter().any(|c| c.path == "class_Foo"), "expected class_Foo chunk");
		assert!(
			!tree.root_children.contains(&"decls".to_string()),
			"class expr should not be grouped as decls"
		);
	}

	#[test]
	fn promotes_exported_arrow_function_and_preserves_wrapper_range() {
		let source = r#"export const handler = () => {
	console.log("handled");
};"#;
		let tree = build_chunk_tree(source, "typescript").expect("tree should build");
		let chunk = tree
			.chunks
			.iter()
			.find(|c| c.path == "fn_handler")
			.expect("fn_handler");
		assert_eq!(chunk.kind, "leaf");
		assert_eq!(chunk.start_line, 1);
		assert_eq!(chunk.end_line, 3);
		assert!(
			!tree.root_children.contains(&"decls".to_string()),
			"exported arrow fn should not fall back to decls"
		);
	}

	#[test]
	fn promotes_exported_const_class_expression() {
		let source = r"export const Foo = class {
	method() { return 42; }
};";
		let tree = build_chunk_tree(source, "typescript").expect("tree should build");
		let chunk = tree
			.chunks
			.iter()
			.find(|c| c.path == "class_Foo")
			.expect("class_Foo");
		assert_eq!(chunk.kind, "branch");
		assert_eq!(chunk.start_line, 1);
		assert_eq!(chunk.end_line, 3);
	}

	#[test]
	fn small_interfaces_collapse() {
		let source = r"interface Config {
	name: string;
	getValue(): number;
}";
		let tree = build_chunk_tree(source, "typescript").expect("tree should build");
		let iface = tree
			.chunks
			.iter()
			.find(|c| c.path == "iface_Config")
			.expect("iface_Config");
		assert_eq!(iface.kind, "leaf");
		assert!(iface.children.is_empty());
	}

	#[test]
	fn unicode_identifiers_preserved() {
		let source = r"class 服务器 {
	启动() { return true; }
}";
		let tree = build_chunk_tree(source, "typescript").expect("tree should build");
		assert!(tree.chunks.iter().any(|c| c.path == "class_服务器"), "expected class_服务器 chunk");
	}

	#[test]
	fn python_chunk_tree() {
		let source = r"import os
import sys

class Server:
    def __init__(self):
        self.running = False

    def start(self):
        self.running = True

def main():
    s = Server()
    s.start()
"
		.to_string();
		let tree = build_chunk_tree(source.as_str(), "python").expect("tree should build");
		let names: Vec<&str> = tree.root_children.iter().map(String::as_str).collect();
		assert!(names.contains(&"imports"), "expected imports, got {names:?}");
		assert!(names.contains(&"class_Server"), "expected class_Server, got {names:?}");
		assert!(names.contains(&"fn_main"), "expected fn_main, got {names:?}");
		let cls = tree
			.chunks
			.iter()
			.find(|c| c.path == "class_Server")
			.expect("class_Server");
		assert_eq!(cls.kind, "branch");
		assert!(
			cls.children.iter().any(|c| c == "class_Server.fn_init"),
			"expected fn_init (__init__ sanitized)"
		);
		assert!(cls.children.iter().any(|c| c == "class_Server.fn_start"), "expected fn_start");
		assert_eq!(cls.signature.as_deref(), Some("class Server"));
	}

	#[test]
	fn python_loops_are_named_loop() {
		let mut body = String::new();
		body.push_str("    total = 0\n");
		body.push_str("    for item in range(3):\n");
		body.push_str("        total += item\n");
		for index in 0..55 {
			let _ = writeln!(body, "    filler_{index} = {index}");
		}
		body.push_str("    return total\n");
		let source = format!("def worker():\n{body}");
		let tree = build_chunk_tree(source.as_str(), "python").expect("tree should build");
		let worker = tree
			.chunks
			.iter()
			.find(|c| c.path == "fn_worker")
			.expect("fn_worker");
		assert_eq!(worker.kind, "branch");
		assert!(tree.chunks.iter().any(|c| c.path == "fn_worker.loop"), "expected loop chunk");
	}

	#[test]
	fn python_class_signature_strips_colon() {
		let source = r"class Foo(Base):
    pass
";
		let tree = build_chunk_tree(source, "python").expect("tree should build");
		let class_chunk = tree
			.chunks
			.iter()
			.find(|c| c.path == "class_Foo")
			.expect("class_Foo");
		assert_eq!(class_chunk.signature.as_deref(), Some("class Foo(Base)"));
		assert_eq!(class_chunk.kind, "leaf");
	}

	#[test]
	fn rust_chunk_tree() {
		let source = r#"use std::io;

struct Config {
    name: String,
}

impl Config {
    fn new(name: String) -> Self {
        Config { name }
    }

    fn name(&self) -> &str {
        &self.name
    }
}

fn main() {
    let c = Config::new("test".into());
    println!("{}", c.name());
}"#;
		let tree = build_chunk_tree(source, "rust").expect("tree should build");
		let names: Vec<&str> = tree.root_children.iter().map(String::as_str).collect();
		assert!(names.contains(&"imports"), "expected imports, got {names:?}");
		assert!(names.contains(&"struct_Config"), "expected struct_Config, got {names:?}");
		assert!(names.contains(&"impl_Config"), "expected impl_Config, got {names:?}");
		assert!(names.contains(&"fn_main"), "expected fn_main, got {names:?}");
		let impl_chunk = tree
			.chunks
			.iter()
			.find(|c| c.path == "impl_Config")
			.expect("impl_Config");
		assert_eq!(impl_chunk.kind, "branch");
		assert!(
			impl_chunk
				.children
				.iter()
				.any(|c| c == "impl_Config.fn_new"),
			"expected fn_new"
		);
		assert!(
			impl_chunk
				.children
				.iter()
				.any(|c| c == "impl_Config.fn_name"),
			"expected fn_name"
		);
	}

	#[test]
	fn rust_trait_impl_naming() {
		let source = r#"use std::fmt;

struct Config {
    name: String,
}

impl fmt::Display for Config {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.name)
    }
}

impl Config {
    fn new(name: String) -> Self {
        Config { name }
    }
}"#;
		let tree = build_chunk_tree(source, "rust").expect("tree should build");
		let names: Vec<&str> = tree.root_children.iter().map(String::as_str).collect();
		assert!(
			names.contains(&"impl_Display_for_Config"),
			"expected impl_Display_for_Config, got {names:?}"
		);
		assert!(names.contains(&"impl_Config"), "expected impl_Config, got {names:?}");
	}

	#[test]
	fn rust_field_naming() {
		let fields: Vec<String> = (0..32).map(|i| format!("    field_{i}: u32,")).collect();
		let source = format!("struct Server {{\n{}\n}}\n", fields.join("\n"));
		let tree = build_chunk_tree(&source, "rust").expect("tree should build");
		let server = tree
			.chunks
			.iter()
			.find(|c| c.path == "struct_Server")
			.expect("struct_Server should exist");
		assert_eq!(server.kind, "branch", "large struct should be a branch");
		assert!(
			server
				.children
				.iter()
				.any(|c| c == "struct_Server.field_field_0"),
			"expected field_field_0 in children: {:?}",
			server.children
		);
	}

	#[test]
	fn go_chunk_tree() {
		let source = r#"package main

	import "fmt"

	type Config struct {
		Name string
	}

	type Reader interface {
		Read(p []byte) (int, error)
	}

	func main() {
		fmt.Println("hello")
	}"#;
		let tree = build_chunk_tree(source, "go").expect("tree should build");
		let names: Vec<&str> = tree.root_children.iter().map(String::as_str).collect();
		assert!(names.contains(&"imports"), "expected imports, got {names:?}");
		assert!(names.contains(&"type_Config"), "expected type_Config, got {names:?}");
		assert!(names.contains(&"type_Reader"), "expected type_Reader, got {names:?}");
		assert!(names.contains(&"fn_main"), "expected fn_main, got {names:?}");
		let config = tree
			.chunks
			.iter()
			.find(|c| c.path == "type_Config")
			.expect("type_Config");
		assert_eq!(config.kind, "branch");
		assert!(
			config
				.children
				.iter()
				.any(|child| child == "type_Config.field_Name"),
			"expected type_Config.field_Name, got {:?}",
			config.children
		);
		let reader = tree
			.chunks
			.iter()
			.find(|c| c.path == "type_Reader")
			.expect("type_Reader");
		assert_eq!(reader.kind, "leaf");
		assert!(reader.children.is_empty(), "single-line interfaces should render inline");
	}

	#[test]
	fn go_receiver_methods_attach_to_receiver_type() {
		let source = r"package main

	type Server struct {
		Addr string
	}

	func (s *Server) Start() {
		println(s.Addr)
	}

	func (s Server) Stop() {}
	";
		let tree = build_chunk_tree(source, "go").expect("tree should build");
		assert!(
			tree
				.root_children
				.iter()
				.any(|child| child == "type_Server"),
			"expected type_Server in root children: {:?}",
			tree.root_children
		);
		assert!(
			!tree
				.root_children
				.iter()
				.any(|child| child == "fn_Start" || child == "fn_Stop"),
			"receiver methods should not remain at root: {:?}",
			tree.root_children
		);
		let server = tree
			.chunks
			.iter()
			.find(|c| c.path == "type_Server")
			.expect("type_Server");
		assert_eq!(server.kind, "branch");
		assert!(
			server
				.children
				.iter()
				.any(|child| child == "type_Server.field_Addr"),
			"expected type_Server.field_Addr in children: {:?}",
			server.children
		);
		assert!(
			server
				.children
				.iter()
				.any(|child| child == "type_Server.fn_Start"),
			"expected type_Server.fn_Start in children: {:?}",
			server.children
		);
		assert!(
			server
				.children
				.iter()
				.any(|child| child == "type_Server.fn_Stop"),
			"expected type_Server.fn_Stop in children: {:?}",
			server.children
		);
		let line_path = line_to_chunk_path(tree.clone(), 7).expect("method line should resolve");
		assert_eq!(line_path, "type_Server.fn_Start");
	}

	#[test]
	fn go_new_constructor_attaches_to_type_and_orders_by_line() {
		let source = r"package main

type Server struct {
	Addr string
}

func NewServer() *Server {
	return &Server{}
}

func (s *Server) GetAddress() string {
	return s.Addr
}
";
		let tree = build_chunk_tree(source, "go").expect("tree should build");
		assert!(
			!tree.root_children.iter().any(|c| c == "fn_NewServer"),
			"constructor should not stay at root: {:?}",
			tree.root_children
		);
		let server = tree
			.chunks
			.iter()
			.find(|c| c.path == "type_Server")
			.expect("type_Server");
		assert!(
			server
				.children
				.iter()
				.any(|c| c == "type_Server.fn_NewServer"),
			"expected type_Server.fn_NewServer in {:?}",
			server.children
		);
		let new_server = tree
			.chunks
			.iter()
			.find(|c| c.path == "type_Server.fn_NewServer")
			.expect("fn_NewServer chunk");
		let get_addr = tree
			.chunks
			.iter()
			.find(|c| c.path == "type_Server.fn_GetAddress")
			.expect("fn_GetAddress chunk");
		assert!(
			new_server.start_line < get_addr.start_line,
			"constructor line should sort before receiver method: new={} get={}",
			new_server.start_line,
			get_addr.start_line
		);
	}

	#[test]
	fn file_preamble_chunk_covers_leading_lines_before_first_item() {
		let source = "// header\n// second\n\nfn main() {}\n";
		let tree = build_chunk_tree(source, "rust").expect("tree should build");
		assert!(
			tree.root_children.iter().any(|c| c == "file_preamble"),
			"expected file_preamble in {:?}",
			tree.root_children
		);
		let preamble = tree
			.chunks
			.iter()
			.find(|c| c.path == "file_preamble")
			.expect("file_preamble");
		assert_eq!(preamble.start_line, 1);
		assert_eq!(preamble.end_line, 3);
		let main_fn = tree
			.chunks
			.iter()
			.find(|c| c.path == "fn_main")
			.expect("fn_main");
		assert!(
			main_fn.start_line > preamble.end_line,
			"first structural chunk should start after preamble"
		);
	}

	#[test]
	fn indent_fields_populated() {
		let source = "class Foo {\n\tbar() {\n\t\treturn 1;\n\t}\n}";
		let tree = build_chunk_tree(source, "typescript").expect("tree should build");
		let method = tree
			.chunks
			.iter()
			.find(|c| c.path == "class_Foo.fn_bar")
			.expect("fn_bar");
		assert_eq!(method.indent, 1, "method should have indent=1");
		assert_eq!(method.indent_char, "\t", "method should use tab indentation");
	}

	#[test]
	fn keeps_trivial_rust_enum_variants_addressable() {
		let source = r"pub enum LogLevel {
	    Debug,
	    Info,
	    Warn,
	    Error,
	}";
		let tree = build_chunk_tree(source, "rust").expect("tree should build");
		let enum_chunk = tree
			.chunks
			.iter()
			.find(|c| c.path == "enum_LogLevel")
			.expect("enum_LogLevel");
		assert_eq!(enum_chunk.kind, "branch");
		assert!(
			enum_chunk
				.children
				.iter()
				.any(|child| child == "enum_LogLevel.variant_Debug")
		);
		assert!(
			enum_chunk
				.children
				.iter()
				.any(|child| child == "enum_LogLevel.variant_Error")
		);
	}

	#[test]
	fn collapses_trivial_rust_trait_children() {
		let source = r"trait Handler {
	    fn handle(&self, method: &str, path: &str) -> OpResult;
	}";
		let tree = build_chunk_tree(source, "rust").expect("tree should build");
		let trait_chunk = tree
			.chunks
			.iter()
			.find(|c| c.path == "trait_Handler")
			.expect("trait_Handler");
		assert_eq!(trait_chunk.kind, "leaf");
		assert!(trait_chunk.children.is_empty(), "single-line trait signatures should render inline");
	}

	#[test]
	fn collapses_trivial_go_interface_children() {
		let source = r"package main

	type Handler interface {
	    Handle(method, path string) Result
	}";
		let tree = build_chunk_tree(source, "go").expect("tree should build");
		let iface = tree
			.chunks
			.iter()
			.find(|c| c.path == "type_Handler")
			.expect("type_Handler");
		assert_eq!(iface.kind, "leaf");
		assert!(iface.children.is_empty(), "single-line interface methods should render inline");
	}

	#[test]
	fn keeps_trivial_typescript_enum_variants_addressable() {
		let source = r#"enum Status {
		Idle = "idle",
		Busy = "busy",
	}"#;
		let tree = build_chunk_tree(source, "typescript").expect("tree should build");
		let enum_chunk = tree
			.chunks
			.iter()
			.find(|c| c.path == "enum_Status")
			.expect("enum_Status");
		assert_eq!(enum_chunk.kind, "branch");
		assert!(
			enum_chunk
				.children
				.iter()
				.any(|child| child == "enum_Status.variant_Idle")
		);
		assert!(
			enum_chunk
				.children
				.iter()
				.any(|child| child == "enum_Status.variant_Busy")
		);
	}

	#[test]
	fn rust_attribute_absorbed_into_struct_chunk() {
		let source = r"#[derive(Debug, Clone)]
struct Record {
    name: String,
}
";
		let tree = build_chunk_tree(source, "rust").expect("tree should build");
		let struct_chunk = tree
			.chunks
			.iter()
			.find(|c| c.path == "struct_Record")
			.expect("struct_Record");
		assert_eq!(struct_chunk.start_line, 1, "struct chunk should start at attribute line");
	}

	#[test]
	fn rust_multi_attribute_absorbed_into_struct_chunk() {
		let source = r#"#[derive(Debug)]
#[serde(rename_all = "camelCase")]
struct Config {
    name: String,
}
"#;
		let tree = build_chunk_tree(source, "rust").expect("tree should build");
		let struct_chunk = tree
			.chunks
			.iter()
			.find(|c| c.path == "struct_Config")
			.expect("struct_Config");
		assert_eq!(struct_chunk.start_line, 1, "struct chunk should start at first attribute line");
	}

	#[test]
	fn rust_struct_checksum_ignores_leading_attributes_absorbed_into_display_range() {
		let one_attr = r"#[derive(Debug)]
struct Config {
    name: String,
}
";
		let two_attrs = r"#[derive(Debug, Clone)]
struct Config {
    name: String,
}
";
		let ta = build_chunk_tree(one_attr, "rust").expect("tree");
		let tb = build_chunk_tree(two_attrs, "rust").expect("tree");
		let ca = ta
			.chunks
			.iter()
			.find(|c| c.path == "struct_Config")
			.expect("struct_Config");
		let cb = tb
			.chunks
			.iter()
			.find(|c| c.path == "struct_Config")
			.expect("struct_Config");
		assert_eq!(
			ca.checksum, cb.checksum,
			"checksum hashes from the struct item, not absorbed outer attributes"
		);
	}

	#[test]
	fn rust_enum_variant_naming() {
		let source = r"enum Message {
    Ok,
    Error {
        code: u32,
        message: String,
    },
}
";
		let tree = build_chunk_tree(source, "rust").expect("tree should build");
		let enum_chunk = tree
			.chunks
			.iter()
			.find(|c| c.path == "enum_Message")
			.expect("enum_Message");
		assert!(!enum_chunk.children.is_empty(), "non-trivial enum should have children");
		assert!(
			tree
				.chunks
				.iter()
				.any(|c| c.path == "enum_Message.variant_Ok"),
			"expected variant_Ok, got children: {:?}",
			enum_chunk.children
		);
		assert!(
			tree
				.chunks
				.iter()
				.any(|c| c.path == "enum_Message.variant_Error"),
			"expected variant_Error, got children: {:?}",
			enum_chunk.children
		);
	}

	#[test]
	fn ruby_class_methods_chunked() {
		let source = r#"module PaymentProcessing
  class Money
    include Comparable

    attr_reader :amount, :currency

    def initialize(amount, currency = :usd)
      @amount = amount
      @currency = currency
    end

    def self.zero(currency = :usd)
      new(0, currency)
    end

    def to_s
      "$#{amount}"
    end

    private

    def validate!
      raise "Invalid" if amount < 0
    end
  end
end
"#;
		let tree = build_chunk_tree(source, "ruby").expect("tree should build");
		assert_eq!(tree.root_children, vec!["mod_PaymentProcessing"]);
		let module = tree
			.chunks
			.iter()
			.find(|c| c.path == "mod_PaymentProcessing")
			.expect("mod_PaymentProcessing");
		assert_eq!(module.kind, "branch");
		assert!(
			module
				.children
				.iter()
				.any(|c| c == "mod_PaymentProcessing.class_Money"),
			"expected class_Money inside module, got {:?}",
			module.children
		);
		let class = tree
			.chunks
			.iter()
			.find(|c| c.path == "mod_PaymentProcessing.class_Money")
			.expect("class_Money");
		assert_eq!(class.kind, "branch");
		assert!(
			class
				.children
				.iter()
				.any(|c| c == "mod_PaymentProcessing.class_Money.constructor"),
			"expected constructor in class children: {:?}",
			class.children
		);
		assert!(
			class
				.children
				.iter()
				.any(|c| c == "mod_PaymentProcessing.class_Money.fn_zero"),
			"expected fn_zero in class children: {:?}",
			class.children
		);
		assert!(
			class
				.children
				.iter()
				.any(|c| c == "mod_PaymentProcessing.class_Money.fn_to_s"),
			"expected fn_to_s in class children: {:?}",
			class.children
		);
		assert!(
			class
				.children
				.iter()
				.any(|c| c == "mod_PaymentProcessing.class_Money.fn_validate"),
			"expected fn_validate in class children: {:?}",
			class.children
		);
	}

	#[test]
	fn keeps_mixed_enum_children_addressable() {
		let source = r"enum Message {
	    Ok,
	    Error {
	        code: u32,
	    },
	}";
		let tree = build_chunk_tree(source, "rust").expect("tree should build");
		let enum_chunk = tree
			.chunks
			.iter()
			.find(|c| c.path == "enum_Message")
			.expect("enum_Message");
		assert_eq!(enum_chunk.kind, "branch");
		assert!(!enum_chunk.children.is_empty(), "mixed-size variants should stay addressable");
	}
}
