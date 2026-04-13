use std::collections::{HashMap, HashSet};

use crate::{
	chunk::{
		indent::{detect_file_indent_char, detect_file_indent_step, normalize_to_tabs},
		state::{ChunkStateInner, mask_chunk_display_source},
		types::{
			ChunkAnchorStyle, ChunkFocusMode, ChunkNode, ChunkTree, RenderParams, VisibleLineRange,
		},
	},
	env_uint,
};

type ChunkLookup<'a> = HashMap<&'a str, &'a ChunkNode>;

#[derive(Clone)]
pub struct InlineHunkLine {
	/// Fully indented line text ready to push as a meta line.
	pub text:   String,
	/// Optional gutter marker (`*`, `-`, etc.) for the rendered meta line.
	pub marker: Option<char>,
}

/// A pre-formatted diff hunk ready for inline display inside a chunk block.
pub struct InlineHunk {
	/// Fully indented lines (header + diff lines) ready to push as meta lines.
	pub lines: Vec<InlineHunkLine>,
}

env_uint! {
	 // Configured full display threshold.
	 static FULL_DISPLAY_THRESHOLD: usize = "PI_CHUNK_FULL_DISPLAY_THRESHOLD" or 80 => [1, usize::MAX];
	 // Configured preview head lines.
	 static PREVIEW_HEAD_LINES: usize = "PI_CHUNK_PREVIEW_HEAD_LINES" or 12 => [1, usize::MAX];
	 // Configured preview tail lines.
	 static PREVIEW_TAIL_LINES: usize = "PI_CHUNK_PREVIEW_TAIL_LINES" or 4 => [1, usize::MAX];
}

const CLIPPED_TAIL_CONTEXT_LINES: u32 = 3;

fn normalize_rendered_line(
	line: &str,
	normalize_indent: Option<(char, usize)>,
	tab_replacement: &str,
) -> String {
	match normalize_indent {
		Some((indent_char, indent_step)) => normalize_to_tabs(line, indent_char, indent_step),
		None => line.replace('\t', tab_replacement),
	}
}

/// Detect a `CommonMark` fence marker (three backticks or three tildes) at the
/// start of trimmed text. Returns the marker character and marker length when
/// at least 3 consecutive markers begin the line.
fn fence_marker(trimmed: &str) -> Option<(char, usize)> {
	let first = trimmed.as_bytes().first().copied()?;
	if first != b'`' && first != b'~' {
		return None;
	}
	let len = trimmed.bytes().take_while(|&b| b == first).count();
	(len >= 3).then_some((first as char, len))
}

/// Returns 1-indexed line numbers that fall strictly inside a fenced code
/// block in a markdown / handlebars file. Opening and closing fence lines
/// are excluded (only opaque content lines are returned).
/// For non-prose languages the set is always empty.
fn compute_fenced_code_lines(source_lines: &[&str], language: &str) -> HashSet<u32> {
	if !matches!(language, "markdown" | "handlebars") {
		return HashSet::new();
	}
	let mut fenced = HashSet::new();
	let mut open_fence: Option<(u8, usize)> = None;
	for (idx, line) in source_lines.iter().enumerate() {
		let line_no = idx as u32 + 1;
		let trimmed = line.trim_start();
		match open_fence {
			None => {
				if let Some((marker, len)) = fence_marker(trimmed) {
					open_fence = Some((marker as u8, len));
				}
			},
			Some((marker, min_len)) => {
				// Closing fence: same char, length >= opening, only whitespace after.
				if let Some((m, len)) = fence_marker(trimmed)
					&& m as u8 == marker
					&& len >= min_len
					&& trimmed[len..].trim().is_empty()
				{
					open_fence = None;
				} else {
					fenced.insert(line_no);
				}
			},
		}
	}
	fenced
}

pub fn render_state(state: &ChunkStateInner, params: &RenderParams) -> String {
	render_state_impl(state, params, HashMap::new(), HashSet::new(), false, false)
}

pub fn render_state_with_hunks(
	state: &ChunkStateInner,
	params: &RenderParams,
	inline_hunks: HashMap<String, Vec<InlineHunk>>,
	changed_anchor_paths: HashSet<String>,
) -> String {
	render_state_impl(state, params, inline_hunks, changed_anchor_paths, true, true)
}

fn render_state_impl(
	state: &ChunkStateInner,
	params: &RenderParams,
	inline_hunks: HashMap<String, Vec<InlineHunk>>,
	changed_anchor_paths: HashSet<String>,
	compact_meta: bool,
	omit_anchor_line_counts: bool,
) -> String {
	let tree = state.tree();
	let lookup = build_lookup(tree);
	let chunk_path = params
		.chunk_path
		.as_deref()
		.unwrap_or(tree.root_path.as_str());
	let Some(chunk) = get_chunk(&lookup, chunk_path) else {
		return String::new();
	};
	let masked_source = mask_chunk_display_source(state.source(), state.language());
	let source_lines = masked_source.split('\n').collect::<Vec<_>>();
	let full_display_threshold = *FULL_DISPLAY_THRESHOLD;
	let preview_head_lines = *PREVIEW_HEAD_LINES;
	let preview_tail_lines = *PREVIEW_TAIL_LINES;
	let tab_replacement = params.tab_replacement.as_deref().unwrap_or("    ");
	let normalize_indent = params.normalize_indent.unwrap_or(false).then(|| {
		(
			detect_file_indent_char(state.source(), tree),
			detect_file_indent_step(state.source(), tree) as usize,
		)
	});

	let fenced_lines = compute_fenced_code_lines(&source_lines, &tree.language);

	let anchor_style = params.anchor_style.unwrap_or_default();
	let focus: Option<HashMap<&str, ChunkFocusMode>> = params
		.focused_paths
		.as_ref()
		.map(|paths| paths.iter().map(|fp| (fp.path.as_str(), fp.mode)).collect());
	let num_width = compute_num_width(
		tree,
		chunk,
		&lookup,
		params.visible_range.as_ref(),
		params.render_children_only,
		params.show_leaf_preview,
		&masked_source,
		&source_lines,
		tab_replacement,
		normalize_indent,
		&fenced_lines,
		full_display_threshold,
		preview_head_lines,
		preview_tail_lines,
	);
	let rendered_line_count = compute_rendered_line_count(
		tree,
		chunk,
		&lookup,
		params.visible_range.as_ref(),
		params.render_children_only,
		params.show_leaf_preview,
		&masked_source,
		&source_lines,
		tab_replacement,
		normalize_indent,
		&fenced_lines,
		full_display_threshold,
		preview_head_lines,
		preview_tail_lines,
	);

	let mut ctx = RenderCtx {
		out: String::new(),
		tree,
		lookup: &lookup,
		source: &masked_source,
		source_lines: &source_lines,
		num_width,
		visible_range: params.visible_range.as_ref(),
		omit_checksum: params.omit_checksum,
		anchor_style,
		show_leaf_preview: params.show_leaf_preview,
		last_was_blank_meta: false,
		full_display_threshold,
		preview_head_lines,
		preview_tail_lines,
		tab_replacement,
		normalize_indent,
		fenced_lines,
		focus,
		inline_hunks,
		compact_meta,
		omit_anchor_line_counts,
		changed_anchor_paths,
	};

	push_meta(
		&mut ctx,
		format_header_meta(
			params.title.as_str(),
			rendered_line_count,
			params.language_tag.as_deref(),
			chunk.checksum.as_str(),
			params.omit_checksum,
		),
	);
	push_blank_meta(&mut ctx);

	if params.render_children_only {
		let focus_ref = ctx.focus.as_ref();
		let children =
			visible_children_for_chunk(tree, chunk, &lookup, params.visible_range.as_ref(), focus_ref);
		for (index, child) in children.iter().enumerate() {
			emit_chunk_subtree(&mut ctx, child, 0, ChunkSubtreeOptions {
				is_first_top_level:            index == 0,
				between_top_level_definitions: true,
			});
		}
		emit_inline_hunks_for(&mut ctx, "");
		return ctx.out;
	}

	if chunk.children.is_empty() && ctx.focus.is_none() {
		if params.show_leaf_preview
			&& intersect_visible_span(chunk, params.visible_range.as_ref()).is_some()
		{
			emit_chunk_subtree(&mut ctx, chunk, 0, ChunkSubtreeOptions {
				is_first_top_level:            true,
				between_top_level_definitions: false,
			});
		}
		return ctx.out;
	}

	emit_chunk_subtree(&mut ctx, chunk, 0, ChunkSubtreeOptions {
		is_first_top_level:            true,
		between_top_level_definitions: false,
	});
	ctx.out
}

fn build_lookup(tree: &ChunkTree) -> ChunkLookup<'_> {
	tree
		.chunks
		.iter()
		.map(|chunk| (chunk.path.as_str(), chunk))
		.collect()
}

fn get_chunk<'a>(lookup: &ChunkLookup<'a>, chunk_path: &str) -> Option<&'a ChunkNode> {
	lookup.get(chunk_path).copied()
}

fn line_to_chunk_path_leaf(tree: &ChunkTree, line: u32) -> Option<&ChunkNode> {
	if line == 0 {
		return None;
	}

	tree
		.chunks
		.iter()
		.filter(|chunk| {
			chunk.leaf
				&& chunk.virtual_content.is_none()
				&& chunk.start_line <= line
				&& line <= chunk.end_line
				&& !chunk.path.is_empty()
		})
		.min_by_key(|chunk| chunk.line_count)
}

fn smallest_containing_chunk(tree: &ChunkTree, line: u32) -> Option<&ChunkNode> {
	let mut best: Option<&ChunkNode> = None;
	for chunk in &tree.chunks {
		if chunk.path.is_empty()
			|| chunk.virtual_content.is_some()
			|| chunk.start_line > line
			|| line > chunk.end_line
		{
			continue;
		}
		if best.is_none_or(|current| chunk.line_count < current.line_count) {
			best = Some(chunk);
		}
	}
	best
}

fn line_to_containing_chunk(tree: &ChunkTree, line: u32) -> Option<&ChunkNode> {
	if let Some(chunk) = line_to_chunk_path_leaf(tree, line) {
		return Some(chunk);
	}
	smallest_containing_chunk(tree, line)
}

const fn chunk_intersects_line_range(chunk: &ChunkNode, visible_range: &VisibleLineRange) -> bool {
	chunk.start_line <= visible_range.end_line && visible_range.start_line <= chunk.end_line
}

fn chunk_or_descendant_intersects_line_range(
	tree: &ChunkTree,
	chunk: &ChunkNode,
	lookup: &ChunkLookup<'_>,
	visible_range: &VisibleLineRange,
) -> bool {
	if chunk_intersects_line_range(chunk, visible_range) {
		return true;
	}
	for child_path in &chunk.children {
		if let Some(child) = get_chunk(lookup, child_path.as_str())
			&& chunk_or_descendant_intersects_line_range(tree, child, lookup, visible_range)
		{
			return true;
		}
	}
	let _ = tree;
	false
}

fn visible_children_for_chunk<'a>(
	tree: &'a ChunkTree,
	chunk: &'a ChunkNode,
	lookup: &ChunkLookup<'a>,
	visible_range: Option<&VisibleLineRange>,
	focus: Option<&HashMap<&str, ChunkFocusMode>>,
) -> Vec<&'a ChunkNode> {
	let mut children = chunk
		.children
		.iter()
		.filter_map(|child_path| get_chunk(lookup, child_path.as_str()))
		.filter(|child| {
			visible_range.is_none_or(|range| {
				chunk_or_descendant_intersects_line_range(tree, child, lookup, range)
			})
		})
		.filter(|child| focus.is_none_or(|map| map.contains_key(child.path.as_str())))
		.collect::<Vec<_>>();
	children.sort_by(|left, right| {
		left
			.start_line
			.cmp(&right.start_line)
			.then_with(|| left.start_byte.cmp(&right.start_byte))
			.then_with(|| left.path.cmp(&right.path))
	});
	children
}

fn leading_whitespace(line: &str) -> &str {
	let count = line
		.chars()
		.take_while(|ch| *ch == ' ' || *ch == '\t')
		.map(char::len_utf8)
		.sum::<usize>();
	&line[..count]
}

fn chunk_body_anchor_indent(
	source_lines: &[&str],
	chunk: &ChunkNode,
	tab_replacement: &str,
	normalize_indent: Option<(char, usize)>,
) -> String {
	source_lines
		.get(chunk.start_line.saturating_sub(1) as usize)
		.map_or(String::new(), |line| {
			leading_whitespace(&normalize_rendered_line(line, normalize_indent, tab_replacement))
				.to_owned()
		})
}

fn chunk_anchor_label(chunk: &ChunkNode, style: ChunkAnchorStyle) -> String {
	match style {
		ChunkAnchorStyle::Full | ChunkAnchorStyle::FullOmit => chunk.path.clone(),
		ChunkAnchorStyle::Kind
		| ChunkAnchorStyle::KindOmit
		| ChunkAnchorStyle::Bare
		| ChunkAnchorStyle::None => chunk.kind.path_segment(chunk.identifier.as_deref()),
	}
}

/// Compute head and body line counts for a chunk.
/// Head = lines covered by the prologue region (signature through opening
/// delimiter). Body = remaining lines (interior through closing delimiter).
/// When the chunk has no region boundaries, head = total, body = 0.
fn chunk_head_body_lines(source: &str, chunk: &ChunkNode) -> (u32, u32) {
	let total = chunk.line_count;
	if total == 0 {
		return (0, 0);
	}
	let Some(pro_end) = chunk.prologue_end_byte else {
		return (total, 0);
	};
	let start = chunk.start_byte as usize;
	let end = chunk.end_byte as usize;
	let pro_end = (pro_end as usize).clamp(start, end);
	if pro_end <= start {
		return (0, total);
	}
	let bytes = source.as_bytes();
	// Count newlines strictly within [start, pro_end).
	#[expect(clippy::naive_bytecount, reason = "small head region, memchr dep not wired in")]
	let head_newlines = bytes[start..pro_end]
		.iter()
		.filter(|&&b| b == b'\n')
		.count() as u32;
	// When the prologue ends exactly on a newline, the newline terminates the
	// last head line, so head_lines == head_newlines. Otherwise the prologue
	// ends mid-line and we're on the line following the last newline.
	let head_ends_at_newline = bytes.get(pro_end - 1).copied() == Some(b'\n');
	let raw_head_lines = if head_ends_at_newline {
		head_newlines.max(1)
	} else {
		head_newlines + 1
	};
	let head_lines = raw_head_lines.min(total);
	let body_lines = total.saturating_sub(head_lines);
	(head_lines, body_lines)
}

#[derive(Clone, Copy)]
struct VisibleSpan {
	start: u32,
	end:   u32,
}

#[derive(Clone, Copy)]
struct LineSegment {
	start: u32,
	end:   u32,
}

fn intersect_visible_span(
	chunk: &ChunkNode,
	visible_range: Option<&VisibleLineRange>,
) -> Option<VisibleSpan> {
	let low = chunk.start_line;
	let high = chunk.end_line;
	match visible_range {
		None => Some(VisibleSpan { start: low, end: high }),
		Some(range) => {
			let start = low.max(range.start_line);
			let end = high.min(range.end_line);
			(start <= end).then_some(VisibleSpan { start, end })
		},
	}
}

fn line_in_file_scope(line: u32, visible_range: Option<&VisibleLineRange>) -> bool {
	visible_range.is_none_or(|range| line >= range.start_line && line <= range.end_line)
}

#[derive(Clone)]
enum LeafEntry {
	Line { abs_line: u32, text: String },
	Ellipsis { start_abs: u32, end_abs: u32 },
}

fn clipped_head_context_line_count(
	source: &str,
	chunk: &ChunkNode,
	preview_head_lines: usize,
) -> u32 {
	let (head_lines, body_lines) = chunk_head_body_lines(source, chunk);
	let fallback = preview_head_lines.max(1) as u32;
	if head_lines == 0 {
		return fallback;
	}
	if body_lines == 0 {
		return head_lines.min(fallback);
	}
	head_lines
}

fn push_segment(segments: &mut Vec<LineSegment>, start: u32, end: u32) {
	if start > end {
		return;
	}
	if let Some(last) = segments.last_mut()
		&& start <= last.end.saturating_add(1)
	{
		last.end = last.end.max(end);
		return;
	}
	segments.push(LineSegment { start, end });
}

fn clipped_leaf_segments(
	source: &str,
	chunk: &ChunkNode,
	span: VisibleSpan,
	preview_head_lines: usize,
) -> Vec<LineSegment> {
	let mut segments = Vec::new();
	if span.start > chunk.start_line {
		let head_context_lines = clipped_head_context_line_count(source, chunk, preview_head_lines);
		let preview_end = chunk
			.start_line
			.saturating_add(head_context_lines.saturating_sub(1))
			.min(chunk.end_line)
			.min(span.start.saturating_sub(1));
		push_segment(&mut segments, chunk.start_line, preview_end);
	}
	push_segment(&mut segments, span.start, span.end);
	if span.end < chunk.end_line {
		let preview_start = chunk
			.end_line
			.saturating_add(1)
			.saturating_sub(CLIPPED_TAIL_CONTEXT_LINES)
			.max(chunk.start_line)
			.max(span.end.saturating_add(1));
		push_segment(&mut segments, preview_start, chunk.end_line);
	}
	segments
}

fn build_leaf_entries(
	source_lines: &[&str],
	source: &str,
	chunk: &ChunkNode,
	span: VisibleSpan,
	tab_replacement: &str,
	normalize_indent: Option<(char, usize)>,
	fenced_lines: &HashSet<u32>,
	full_display_threshold: usize,
	preview_head_lines: usize,
	preview_tail_lines: usize,
) -> Vec<LeafEntry> {
	let low = span.start;
	let high = span.end;
	let visible_line_count = (high - low + 1) as usize;
	let make_line = |line: u32| {
		let normalize = if fenced_lines.contains(&line) {
			None
		} else {
			normalize_indent
		};
		LeafEntry::Line {
			abs_line: line,
			text:     source_lines
				.get(line.saturating_sub(1) as usize)
				.map_or(String::new(), |text| {
					normalize_rendered_line(text, normalize, tab_replacement)
				}),
		}
	};

	if span.start > chunk.start_line || span.end < chunk.end_line {
		let segments = clipped_leaf_segments(source, chunk, span, preview_head_lines);
		let mut entries = Vec::new();
		let mut last_end: Option<u32> = None;
		for segment in segments {
			if let Some(previous_end) = last_end {
				let gap_start = previous_end.saturating_add(1);
				let gap_end = segment.start.saturating_sub(1);
				if gap_start <= gap_end {
					entries.push(LeafEntry::Ellipsis { start_abs: gap_start, end_abs: gap_end });
				}
			}
			for line in segment.start..=segment.end {
				entries.push(make_line(line));
			}
			last_end = Some(segment.end);
		}
		return entries;
	}

	let raw = (low..=high).map(make_line).collect::<Vec<_>>();

	if visible_line_count <= full_display_threshold {
		return raw;
	}

	let head = raw
		.iter()
		.take(preview_head_lines)
		.cloned()
		.collect::<Vec<_>>();
	let tail = raw
		.iter()
		.rev()
		.take(preview_tail_lines)
		.cloned()
		.collect::<Vec<_>>()
		.into_iter()
		.rev()
		.collect::<Vec<_>>();
	let _omitted = visible_line_count.saturating_sub(head.len() + tail.len());
	let first_omitted = low + head.len() as u32;
	let last_omitted = high.saturating_sub(tail.len() as u32);
	let mut entries = Vec::with_capacity(head.len() + tail.len() + 1);
	entries.extend(head);
	entries.push(LeafEntry::Ellipsis { start_abs: first_omitted, end_abs: last_omitted });
	entries.extend(tail);
	entries
}

fn format_header_meta(
	title: &str,
	line_count: usize,
	language_tag: Option<&str>,
	checksum: &str,
	omit_checksum: bool,
) -> String {
	let language = language_tag.unwrap_or("text");
	let checksum_part = if omit_checksum {
		String::new()
	} else {
		format!("·#{checksum}")
	};
	format!("{title}·{line_count}L·{language}{checksum_part}")
}

fn should_render_gap_line(
	tree: &ChunkTree,
	chunk: &ChunkNode,
	lookup: &ChunkLookup<'_>,
	line: u32,
) -> bool {
	if chunk.path.is_empty() {
		return true;
	}
	let children = visible_children_for_chunk(tree, chunk, lookup, None, None);
	let has_out_of_span_child = children
		.iter()
		.any(|child| child.start_line < chunk.start_line || child.end_line > chunk.end_line);
	if !has_out_of_span_child {
		return true;
	}
	let Some(owner) = line_to_containing_chunk(tree, line) else {
		return true;
	};
	owner.path == chunk.path || owner.path.starts_with(&format!("{}.", chunk.path))
}

fn for_each_rendered_source_line(
	tree: &ChunkTree,
	chunk: &ChunkNode,
	lookup: &ChunkLookup<'_>,
	visible_range: Option<&VisibleLineRange>,
	show_leaf_preview: bool,
	source: &str,
	source_lines: &[&str],
	tab_replacement: &str,
	normalize_indent: Option<(char, usize)>,
	fenced_lines: &HashSet<u32>,
	full_display_threshold: usize,
	preview_head_lines: usize,
	preview_tail_lines: usize,
	visit: &mut impl FnMut(u32),
) {
	let children = visible_children_for_chunk(tree, chunk, lookup, visible_range, None);
	let span = intersect_visible_span(chunk, visible_range);
	let has_kids = !children.is_empty();

	if !chunk.path.is_empty() && span.is_none() && !has_kids {
		return;
	}

	if !has_kids {
		if !show_leaf_preview {
			return;
		}
		if let Some(span) = span {
			for entry in build_leaf_entries(
				source_lines,
				source,
				chunk,
				span,
				tab_replacement,
				normalize_indent,
				fenced_lines,
				full_display_threshold,
				preview_head_lines,
				preview_tail_lines,
			) {
				if let LeafEntry::Line { abs_line, .. } = entry {
					visit(abs_line);
				}
			}
		}
		return;
	}

	if let Some(span) = span {
		if span.start > chunk.start_line {
			let head_context_lines =
				clipped_head_context_line_count(source, chunk, preview_head_lines);
			let first_child_start = children
				.first()
				.map_or_else(|| chunk.end_line.saturating_add(1), |child| child.start_line);
			let preview_end = chunk
				.start_line
				.saturating_add(head_context_lines.saturating_sub(1))
				.min(chunk.end_line)
				.min(first_child_start.saturating_sub(1))
				.min(span.start.saturating_sub(1));
			for line in chunk.start_line..=preview_end {
				if should_render_gap_line(tree, chunk, lookup, line) {
					visit(line);
				}
			}
		}
		let mut cursor = chunk.start_line;
		for child in &children {
			let gap_end = child.start_line.saturating_sub(1);
			if gap_end >= cursor {
				for line in cursor..=gap_end {
					if line_in_file_scope(line, visible_range)
						&& should_render_gap_line(tree, chunk, lookup, line)
					{
						visit(line);
					}
				}
			}
			for_each_rendered_source_line(
				tree,
				child,
				lookup,
				visible_range,
				show_leaf_preview,
				source,
				source_lines,
				tab_replacement,
				normalize_indent,
				fenced_lines,
				full_display_threshold,
				preview_head_lines,
				preview_tail_lines,
				visit,
			);
			cursor = cursor.max(child.end_line.saturating_add(1));
		}
		if cursor <= span.end {
			for line in cursor..=span.end {
				if line_in_file_scope(line, visible_range) {
					visit(line);
				}
			}
		}
		if span.end < chunk.end_line {
			let last_child_end = children.last().map_or(0, |child| child.end_line);
			let preview_start = chunk
				.end_line
				.saturating_add(1)
				.saturating_sub(CLIPPED_TAIL_CONTEXT_LINES)
				.max(chunk.start_line)
				.max(last_child_end.saturating_add(1))
				.max(span.end.saturating_add(1));
			for line in preview_start..=chunk.end_line {
				if should_render_gap_line(tree, chunk, lookup, line) {
					visit(line);
				}
			}
		}
		return;
	}

	for child in children {
		for_each_rendered_source_line(
			tree,
			child,
			lookup,
			visible_range,
			show_leaf_preview,
			source,
			source_lines,
			tab_replacement,
			normalize_indent,
			fenced_lines,
			full_display_threshold,
			preview_head_lines,
			preview_tail_lines,
			visit,
		);
	}
}

fn compute_rendered_line_count(
	tree: &ChunkTree,
	chunk: &ChunkNode,
	lookup: &ChunkLookup<'_>,
	visible_range: Option<&VisibleLineRange>,
	render_children_only: bool,
	show_leaf_preview: bool,
	source: &str,
	source_lines: &[&str],
	tab_replacement: &str,
	normalize_indent: Option<(char, usize)>,
	fenced_lines: &HashSet<u32>,
	full_display_threshold: usize,
	preview_head_lines: usize,
	preview_tail_lines: usize,
) -> usize {
	if visible_range.is_none() {
		if render_children_only {
			// Root reads render child chunks only, but the header should still report the
			// file's true total line count.
			return if chunk.path.is_empty() {
				tree.line_count as usize
			} else {
				chunk.line_count as usize
			};
		}
		let children = visible_children_for_chunk(tree, chunk, lookup, visible_range, None);
		let has_out_of_span_child = children
			.iter()
			.any(|child| child.start_line < chunk.start_line || child.end_line > chunk.end_line);
		if !has_out_of_span_child {
			return chunk.line_count as usize;
		}
	}
	let mut rendered_lines = std::collections::BTreeSet::new();
	for_each_rendered_source_line(
		tree,
		chunk,
		lookup,
		visible_range,
		show_leaf_preview,
		source,
		source_lines,
		tab_replacement,
		normalize_indent,
		fenced_lines,
		full_display_threshold,
		preview_head_lines,
		preview_tail_lines,
		&mut |line| {
			rendered_lines.insert(line);
		},
	);
	rendered_lines.len().max(1)
}

struct RenderCtx<'a> {
	out:                     String,
	tree:                    &'a ChunkTree,
	lookup:                  &'a ChunkLookup<'a>,
	source:                  &'a str,
	source_lines:            &'a [&'a str],
	num_width:               usize,
	visible_range:           Option<&'a VisibleLineRange>,
	omit_checksum:           bool,
	anchor_style:            ChunkAnchorStyle,
	show_leaf_preview:       bool,
	last_was_blank_meta:     bool,
	full_display_threshold:  usize,
	preview_head_lines:      usize,
	preview_tail_lines:      usize,
	tab_replacement:         &'a str,
	normalize_indent:        Option<(char, usize)>,
	fenced_lines:            HashSet<u32>,
	focus:                   Option<HashMap<&'a str, ChunkFocusMode>>,
	inline_hunks:            HashMap<String, Vec<InlineHunk>>,
	compact_meta:            bool,
	omit_anchor_line_counts: bool,
	changed_anchor_paths:    HashSet<String>,
}

fn push_line(out: &mut String, line: String) {
	if !out.is_empty() {
		out.push('\n');
	}
	out.push_str(&line);
}

fn push_blank_meta(ctx: &mut RenderCtx<'_>) {
	if ctx.last_was_blank_meta {
		return;
	}
	push_line(&mut ctx.out, format!("{}|", " ".repeat(ctx.num_width)));
	ctx.last_was_blank_meta = true;
}

fn push_meta_marked(ctx: &mut RenderCtx<'_>, body: String, marker: Option<char>) {
	ctx.last_was_blank_meta = false;
	let gutter = match marker {
		Some(marker) => format!("{marker}{}", " ".repeat(ctx.num_width.saturating_sub(1))),
		None => " ".repeat(ctx.num_width),
	};
	let separator = if ctx.compact_meta { "|" } else { "| " };
	push_line(&mut ctx.out, format!("{gutter}{separator}{body}"));
}

fn push_meta(ctx: &mut RenderCtx<'_>, body: String) {
	push_meta_marked(ctx, body, None);
}

fn push_code(ctx: &mut RenderCtx<'_>, abs_line: u32, source_text: &str) {
	ctx.last_was_blank_meta = false;
	push_line(
		&mut ctx.out,
		format!("{}|{}", abs_line.to_string().pad_start(ctx.num_width, ' '), source_text),
	);
}

trait PadStart {
	fn pad_start(&self, width: usize, ch: char) -> String;
}

impl PadStart for String {
	fn pad_start(&self, width: usize, ch: char) -> String {
		if self.len() >= width {
			return self.clone();
		}
		format!("{}{}", ch.to_string().repeat(width - self.len()), self)
	}
}

fn emit_line_gap(ctx: &mut RenderCtx<'_>, from: u32, to: u32) {
	for line in from..=to {
		if !line_in_file_scope(line, ctx.visible_range) {
			continue;
		}
		let normalize = if ctx.fenced_lines.contains(&line) {
			None
		} else {
			ctx.normalize_indent
		};
		let text = ctx
			.source_lines
			.get(line.saturating_sub(1) as usize)
			.map_or(String::new(), |text| {
				normalize_rendered_line(text, normalize, ctx.tab_replacement)
			});
		push_code(ctx, line, &text);
	}
}

fn push_truncation_marker(ctx: &mut RenderCtx<'_>, chunk: &ChunkNode, start: u32, end: u32) {
	if start > end {
		return;
	}
	let indent =
		chunk_body_anchor_indent(ctx.source_lines, chunk, ctx.tab_replacement, ctx.normalize_indent);
	push_meta(ctx, format!("{indent}[truncated\u{2026} sel=L{start}-L{end} to expand]"));
}

fn emit_explicit_gap_lines(ctx: &mut RenderCtx<'_>, chunk: &ChunkNode, from: u32, to: u32) {
	if from > to {
		return;
	}
	for line in from..=to {
		if !should_render_gap_line(ctx.tree, chunk, ctx.lookup, line) {
			continue;
		}
		let normalize = if ctx.fenced_lines.contains(&line) {
			None
		} else {
			ctx.normalize_indent
		};
		let text = ctx
			.source_lines
			.get(line.saturating_sub(1) as usize)
			.map_or(String::new(), |source_text| {
				normalize_rendered_line(source_text, normalize, ctx.tab_replacement)
			});
		push_code(ctx, line, &text);
	}
}

fn emit_container_clip_above(
	ctx: &mut RenderCtx<'_>,
	chunk: &ChunkNode,
	span: &VisibleSpan,
	children: &[&ChunkNode],
) {
	if ctx.visible_range.is_none() || span.start <= chunk.start_line {
		return;
	}
	let head_context_lines =
		clipped_head_context_line_count(ctx.source, chunk, ctx.preview_head_lines);
	let first_child_start = children
		.first()
		.map_or_else(|| chunk.end_line.saturating_add(1), |child| child.start_line);
	let preview_end = chunk
		.start_line
		.saturating_add(head_context_lines.saturating_sub(1))
		.min(chunk.end_line)
		.min(first_child_start.saturating_sub(1))
		.min(span.start.saturating_sub(1));
	if preview_end >= chunk.start_line {
		emit_explicit_gap_lines(ctx, chunk, chunk.start_line, preview_end);
	}
	push_truncation_marker(ctx, chunk, preview_end.saturating_add(1), span.start.saturating_sub(1));
}

fn emit_container_clip_below(
	ctx: &mut RenderCtx<'_>,
	chunk: &ChunkNode,
	span: &VisibleSpan,
	children: &[&ChunkNode],
) {
	if ctx.visible_range.is_none() || span.end >= chunk.end_line {
		return;
	}
	let last_child_end = children.last().map_or(0, |child| child.end_line);
	let preview_start = chunk
		.end_line
		.saturating_add(1)
		.saturating_sub(CLIPPED_TAIL_CONTEXT_LINES)
		.max(chunk.start_line)
		.max(last_child_end.saturating_add(1))
		.max(span.end.saturating_add(1));
	push_truncation_marker(ctx, chunk, span.end.saturating_add(1), preview_start.saturating_sub(1));
	if preview_start <= chunk.end_line {
		emit_explicit_gap_lines(ctx, chunk, preview_start, chunk.end_line);
	}
}

fn virtual_render_lines(
	content: &str,
	tab_replacement: &str,
	normalize_indent: Option<(char, usize)>,
) -> Vec<String> {
	if content.is_empty() {
		return Vec::new();
	}
	let content = content.strip_suffix('\n').unwrap_or(content);
	content
		.split('\n')
		.map(|line| normalize_rendered_line(line, normalize_indent, tab_replacement))
		.collect()
}

fn emit_leaf_body(ctx: &mut RenderCtx<'_>, chunk: &ChunkNode, span: VisibleSpan) {
	if let Some(content) = chunk.virtual_content.as_deref() {
		for line in virtual_render_lines(content, ctx.tab_replacement, ctx.normalize_indent) {
			push_meta(ctx, line);
		}
		return;
	}

	for entry in build_leaf_entries(
		ctx.source_lines,
		ctx.source,
		chunk,
		span,
		ctx.tab_replacement,
		ctx.normalize_indent,
		&ctx.fenced_lines,
		ctx.full_display_threshold,
		ctx.preview_head_lines,
		ctx.preview_tail_lines,
	) {
		match entry {
			LeafEntry::Line { abs_line, text } => push_code(ctx, abs_line, &text),
			LeafEntry::Ellipsis { start_abs, end_abs, .. } => {
				push_truncation_marker(ctx, chunk, start_abs, end_abs);
			},
		}
	}
}

fn render_open_anchor_line(ctx: &RenderCtx<'_>, chunk: &ChunkNode) -> String {
	let anchor_indent =
		chunk_body_anchor_indent(ctx.source_lines, chunk, ctx.tab_replacement, ctx.normalize_indent);
	let (head_lines, body_lines) = chunk_head_body_lines(ctx.source, chunk);
	let style = ctx.anchor_style.with_omit_checksum(ctx.omit_checksum);
	let anchor_label = chunk_anchor_label(chunk, style);
	if ctx.omit_anchor_line_counts {
		style.render_without_counts(&anchor_indent, anchor_label.as_str(), chunk.checksum.as_str())
	} else {
		style.render(
			&anchor_indent,
			anchor_label.as_str(),
			chunk.checksum.as_str(),
			head_lines,
			body_lines,
		)
	}
}

fn emit_inline_hunks_for(ctx: &mut RenderCtx<'_>, chunk_path: &str) {
	let lines = match ctx.inline_hunks.get(chunk_path) {
		Some(hunks) => hunks
			.iter()
			.flat_map(|hunk| hunk.lines.iter().cloned())
			.collect::<Vec<_>>(),
		None => return,
	};
	for line in lines {
		push_meta_marked(ctx, line.text, line.marker);
	}
}

struct ChunkSubtreeOptions {
	is_first_top_level:            bool,
	between_top_level_definitions: bool,
}

fn emit_chunk_subtree(
	ctx: &mut RenderCtx<'_>,
	chunk: &ChunkNode,
	depth: usize,
	options: ChunkSubtreeOptions,
) {
	// Focus mode gate: skip unfocused chunks, collapse siblings, pass through
	// containers and expanded.
	if let Some(focus_map) = ctx.focus.as_ref()
		&& !chunk.path.is_empty()
	{
		match focus_map.get(chunk.path.as_str()) {
			None => return,
			Some(ChunkFocusMode::Collapsed) => {
				if options.between_top_level_definitions && depth == 0 && !options.is_first_top_level {
					push_blank_meta(ctx);
				}
				push_meta_marked(
					ctx,
					render_open_anchor_line(ctx, chunk),
					ctx.changed_anchor_paths
						.contains(chunk.path.as_str())
						.then_some('*'),
				);
				return;
			},
			Some(ChunkFocusMode::Container | ChunkFocusMode::Expanded) => {
				// fall through to normal rendering
			},
		}
	}

	let focus_ref = ctx.focus.as_ref();
	let children =
		visible_children_for_chunk(ctx.tree, chunk, ctx.lookup, ctx.visible_range, focus_ref);
	let span = intersect_visible_span(chunk, ctx.visible_range);
	let has_kids = !children.is_empty();

	if !chunk.path.is_empty() && span.is_none() && !has_kids {
		return;
	}
	if options.between_top_level_definitions && depth == 0 && !options.is_first_top_level {
		push_blank_meta(ctx);
	}
	if !chunk.path.is_empty() {
		push_meta_marked(
			ctx,
			render_open_anchor_line(ctx, chunk),
			ctx.changed_anchor_paths
				.contains(chunk.path.as_str())
				.then_some('*'),
		);
	}

	if !has_kids {
		if !chunk.path.is_empty() && ctx.inline_hunks.contains_key(chunk.path.as_str()) {
			emit_inline_hunks_for(ctx, &chunk.path);
			return;
		}
		if ctx.show_leaf_preview
			&& let Some(span) = span
		{
			emit_leaf_body(ctx, chunk, span);
		}
		return;
	}

	let is_container = ctx
		.focus
		.as_ref()
		.and_then(|f| f.get(chunk.path.as_str()))
		.copied()
		== Some(ChunkFocusMode::Container);

	if let Some(span) = span {
		emit_container_clip_above(ctx, chunk, &span, &children);
		let mut cursor = chunk.start_line;
		for child in &children {
			let gap_end = child.start_line.saturating_sub(1);
			if gap_end >= cursor && !is_container {
				for line in cursor..=gap_end {
					if line_in_file_scope(line, ctx.visible_range)
						&& should_render_gap_line(ctx.tree, chunk, ctx.lookup, line)
					{
						emit_line_gap(ctx, line, line);
					}
				}
			}
			emit_chunk_subtree(ctx, child, depth + 1, ChunkSubtreeOptions {
				is_first_top_level:            false,
				between_top_level_definitions: false,
			});
			cursor = cursor.max(child.end_line.saturating_add(1));
		}
		if cursor <= span.end && !is_container {
			emit_line_gap(ctx, cursor, span.end);
		}
		emit_container_clip_below(ctx, chunk, &span, &children);
		if !chunk.path.is_empty() {
			emit_inline_hunks_for(ctx, &chunk.path);
		}
		// Closing tag for chunks with children
		if !chunk.path.is_empty() && !*crate::chunk::common::HIDE_CLOSING_TAGS {
			let anchor_indent = chunk_body_anchor_indent(
				ctx.source_lines,
				chunk,
				ctx.tab_replacement,
				ctx.normalize_indent,
			);
			let style = ctx.anchor_style.with_omit_checksum(ctx.omit_checksum);
			let anchor_label = chunk_anchor_label(chunk, style);
			push_meta(
				ctx,
				style.render_close(&anchor_indent, anchor_label.as_str(), chunk.checksum.as_str()),
			);
		}
		return;
	}
	for (index, child) in children.iter().enumerate() {
		emit_chunk_subtree(ctx, child, depth + 1, ChunkSubtreeOptions {
			is_first_top_level:            index == 0,
			between_top_level_definitions: true,
		});
	}
}

fn compute_num_width(
	tree: &ChunkTree,
	chunk: &ChunkNode,
	lookup: &ChunkLookup<'_>,
	visible_range: Option<&VisibleLineRange>,
	render_children_only: bool,
	show_leaf_preview: bool,
	source: &str,
	source_lines: &[&str],
	tab_replacement: &str,
	normalize_indent: Option<(char, usize)>,
	fenced_lines: &HashSet<u32>,
	full_display_threshold: usize,
	preview_head_lines: usize,
	preview_tail_lines: usize,
) -> usize {
	if visible_range.is_none() {
		if render_children_only {
			return tree.line_count.to_string().len().max(1);
		}
		let children = visible_children_for_chunk(tree, chunk, lookup, visible_range, None);
		let has_out_of_span_child = children
			.iter()
			.any(|child| child.start_line < chunk.start_line || child.end_line > chunk.end_line);
		if !has_out_of_span_child {
			return chunk.end_line.to_string().len().max(1);
		}
	}
	let mut max_line = 1usize;
	for_each_rendered_source_line(
		tree,
		chunk,
		lookup,
		visible_range,
		show_leaf_preview,
		source,
		source_lines,
		tab_replacement,
		normalize_indent,
		fenced_lines,
		full_display_threshold,
		preview_head_lines,
		preview_tail_lines,
		&mut |line| {
			max_line = max_line.max(line as usize);
		},
	);
	max_line.to_string().len().max(1)
}

/// Find the deepest visible chunk that should own a diff hunk for inline
/// display.
pub fn find_hunk_owner_chunk<'a>(
	tree: &'a ChunkTree,
	_lookup: &ChunkLookup<'a>,
	line: u32,
) -> Option<&'a str> {
	line_to_containing_chunk(tree, line).map(|chunk| chunk.path.as_str())
}

pub fn hunk_indent_for_chunk(
	lookup: &ChunkLookup<'_>,
	chunk_path: &str,
	source: &str,
	tab_replacement: &str,
	normalize_indent: Option<(char, usize)>,
) -> String {
	let source_lines: Vec<&str> = source.split('\n').collect();
	let Some(chunk) = lookup.get(chunk_path) else {
		return String::new();
	};
	let base = chunk_body_anchor_indent(&source_lines, chunk, tab_replacement, normalize_indent);
	match normalize_indent {
		Some(_) => format!("{base}\t"),
		None => format!("{base}{tab_replacement}"),
	}
}
