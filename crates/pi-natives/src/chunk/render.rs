use std::collections::HashMap;

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

/// A pre-formatted diff hunk ready for inline display inside a chunk block.
pub struct InlineHunk {
	/// Fully indented lines (header + diff lines) ready to push as meta lines.
	pub lines: Vec<String>,
}

env_uint! {
	 // Configured full display threshold.
	 static FULL_DISPLAY_THRESHOLD: usize = "PI_CHUNK_FULL_DISPLAY_THRESHOLD" or 80 => [1, usize::MAX];
	 // Configured preview head lines.
	 static PREVIEW_HEAD_LINES: usize = "PI_CHUNK_PREVIEW_HEAD_LINES" or 12 => [1, usize::MAX];
	 // Configured preview tail lines.
	 static PREVIEW_TAIL_LINES: usize = "PI_CHUNK_PREVIEW_TAIL_LINES" or 4 => [1, usize::MAX];
}

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

pub fn render_state(state: &ChunkStateInner, params: &RenderParams) -> String {
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
		&source_lines,
		tab_replacement,
		normalize_indent,
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
		&source_lines,
		tab_replacement,
		normalize_indent,
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
		focus,
		inline_hunks: HashMap::new(),
	};

	push_line(
		&mut ctx.out,
		format!(
			"{}| {}",
			" ".repeat(num_width),
			format_header_meta(
				params.title.as_str(),
				rendered_line_count,
				params.language_tag.as_deref(),
				chunk.checksum.as_str(),
				params.omit_checksum,
			)
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

fn build_leaf_entries(
	source_lines: &[&str],
	span: VisibleSpan,
	tab_replacement: &str,
	normalize_indent: Option<(char, usize)>,
	full_display_threshold: usize,
	preview_head_lines: usize,
	preview_tail_lines: usize,
) -> Vec<LeafEntry> {
	let low = span.start;
	let high = span.end;
	let visible_line_count = (high - low + 1) as usize;
	let raw = (low..=high)
		.map(|line| LeafEntry::Line {
			abs_line: line,
			text:     source_lines
				.get(line.saturating_sub(1) as usize)
				.map_or(String::new(), |text| {
					normalize_rendered_line(text, normalize_indent, tab_replacement)
				}),
		})
		.collect::<Vec<_>>();

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
	source_lines: &[&str],
	tab_replacement: &str,
	normalize_indent: Option<(char, usize)>,
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
				span,
				tab_replacement,
				normalize_indent,
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
		let mut cursor = chunk.start_line;
		for child in children {
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
				source_lines,
				tab_replacement,
				normalize_indent,
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
		return;
	}

	for child in children {
		for_each_rendered_source_line(
			tree,
			child,
			lookup,
			visible_range,
			show_leaf_preview,
			source_lines,
			tab_replacement,
			normalize_indent,
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
	source_lines: &[&str],
	tab_replacement: &str,
	normalize_indent: Option<(char, usize)>,
	full_display_threshold: usize,
	preview_head_lines: usize,
	preview_tail_lines: usize,
) -> usize {
	if let Some(range) = visible_range {
		return (range.end_line - range.start_line + 1) as usize;
	}
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
	let mut rendered_lines = std::collections::BTreeSet::new();
	for_each_rendered_source_line(
		tree,
		chunk,
		lookup,
		visible_range,
		show_leaf_preview,
		source_lines,
		tab_replacement,
		normalize_indent,
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
	out:                    String,
	tree:                   &'a ChunkTree,
	lookup:                 &'a ChunkLookup<'a>,
	source:                 &'a str,
	source_lines:           &'a [&'a str],
	num_width:              usize,
	visible_range:          Option<&'a VisibleLineRange>,
	omit_checksum:          bool,
	anchor_style:           ChunkAnchorStyle,
	show_leaf_preview:      bool,
	last_was_blank_meta:    bool,
	full_display_threshold: usize,
	preview_head_lines:     usize,
	preview_tail_lines:     usize,
	tab_replacement:        &'a str,
	normalize_indent:       Option<(char, usize)>,
	focus:                  Option<HashMap<&'a str, ChunkFocusMode>>,
	inline_hunks:           HashMap<String, Vec<InlineHunk>>,
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

fn push_meta(ctx: &mut RenderCtx<'_>, body: String) {
	ctx.last_was_blank_meta = false;
	push_line(&mut ctx.out, format!("{}| {}", " ".repeat(ctx.num_width), body));
}

fn push_code(ctx: &mut RenderCtx<'_>, abs_line: u32, source_text: &str) {
	ctx.last_was_blank_meta = false;
	push_line(
		&mut ctx.out,
		format!("{}| {}", abs_line.to_string().pad_start(ctx.num_width, ' '), source_text),
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
		let text = ctx
			.source_lines
			.get(line.saturating_sub(1) as usize)
			.map_or(String::new(), |text| {
				normalize_rendered_line(text, ctx.normalize_indent, ctx.tab_replacement)
			});
		push_code(ctx, line, &text);
	}
}

/// Emit a truncation marker when `visible_range` clips a chunk.
/// `above` = true for top clip, false for bottom clip.
fn emit_range_clip_marker(
	ctx: &mut RenderCtx<'_>,
	chunk: &ChunkNode,
	span: &VisibleSpan,
	above: bool,
) {
	if ctx.visible_range.is_none() {
		return;
	}
	let (hidden, direction, start, end) = if above {
		let n = span.start.saturating_sub(chunk.start_line);
		(n, "above", chunk.start_line, span.start.saturating_sub(1))
	} else {
		let n = chunk.end_line.saturating_sub(span.end);
		(n, "below", span.end + 1, chunk.end_line)
	};
	if hidden == 0 {
		return;
	}
	let indent =
		chunk_body_anchor_indent(ctx.source_lines, chunk, ctx.tab_replacement, ctx.normalize_indent);
	push_meta(ctx, format!("{indent}[truncated\u{2026} sel=L{start}-L{end} to expand {direction}]"));
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
		span,
		ctx.tab_replacement,
		ctx.normalize_indent,
		ctx.full_display_threshold,
		ctx.preview_head_lines,
		ctx.preview_tail_lines,
	) {
		match entry {
			LeafEntry::Line { abs_line, text } => push_code(ctx, abs_line, &text),
			LeafEntry::Ellipsis { start_abs, end_abs, .. } => {
				push_meta(ctx, format!("[truncated\u{2026} sel=L{start_abs}-L{end_abs} to expand]"));
			},
		}
	}
}

/// Emit any inline diff hunks mapped to the given chunk path.
fn emit_inline_hunks_for(ctx: &mut RenderCtx<'_>, chunk_path: &str) {
	let lines: Vec<String> = match ctx.inline_hunks.get(chunk_path) {
		Some(hunks) => hunks.iter().flat_map(|h| h.lines.iter().cloned()).collect(),
		None => return,
	};
	for line in lines {
		push_meta(ctx, line);
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
				let anchor_indent = chunk_body_anchor_indent(
					ctx.source_lines,
					chunk,
					ctx.tab_replacement,
					ctx.normalize_indent,
				);
				let (head_lines, body_lines) = chunk_head_body_lines(ctx.source, chunk);
				let style = ctx.anchor_style.with_omit_checksum(ctx.omit_checksum);
				let anchor_label = chunk_anchor_label(chunk, style);
				push_meta(
					ctx,
					style.render(
						&anchor_indent,
						anchor_label.as_str(),
						chunk.checksum.as_str(),
						head_lines,
						body_lines,
					),
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
		let anchor_indent = chunk_body_anchor_indent(
			ctx.source_lines,
			chunk,
			ctx.tab_replacement,
			ctx.normalize_indent,
		);
		let (head_lines, body_lines) = chunk_head_body_lines(ctx.source, chunk);
		let style = ctx.anchor_style.with_omit_checksum(ctx.omit_checksum);
		let anchor_label = chunk_anchor_label(chunk, style);
		push_meta(
			ctx,
			style.render(
				&anchor_indent,
				anchor_label.as_str(),
				chunk.checksum.as_str(),
				head_lines,
				body_lines,
			),
		);
	}

	if !has_kids {
		if ctx.show_leaf_preview
			&& let Some(span) = span
		{
			emit_range_clip_marker(ctx, chunk, &span, true);
			emit_leaf_body(ctx, chunk, span);
			emit_range_clip_marker(ctx, chunk, &span, false);
		}
		// Emit inline diff hunks even when children are filtered out by
		// focus (the chunk is "effectively leaf" but may own hunks).
		if !chunk.path.is_empty() {
			emit_inline_hunks_for(ctx, &chunk.path);
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
		// Top clip marker for container chunks
		emit_range_clip_marker(ctx, chunk, &span, true);
		let mut cursor = chunk.start_line;
		for child in children {
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
		// Bottom clip marker for container chunks
		emit_range_clip_marker(ctx, chunk, &span, false);
		// Emit inline diff hunks before the closing tag.
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
	source_lines: &[&str],
	tab_replacement: &str,
	normalize_indent: Option<(char, usize)>,
	full_display_threshold: usize,
	preview_head_lines: usize,
	preview_tail_lines: usize,
) -> usize {
	if let Some(range) = visible_range {
		return range.end_line.to_string().len().max(1);
	}
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
	let mut max_line = 1usize;
	for_each_rendered_source_line(
		tree,
		chunk,
		lookup,
		visible_range,
		show_leaf_preview,
		source_lines,
		tab_replacement,
		normalize_indent,
		full_display_threshold,
		preview_head_lines,
		preview_tail_lines,
		&mut |line| {
			max_line = max_line.max(line as usize);
		},
	);
	max_line.to_string().len().max(1)
}

/// Find the chunk that should own a diff hunk for inline display.
///
/// Walks from the deepest chunk containing `line` upward until it finds a
/// chunk with children (which will have a closing tag in the tree output).
/// Returns the chunk path, or `None` for file-root orphans.
pub fn find_hunk_owner_chunk<'a>(
	tree: &'a ChunkTree,
	lookup: &ChunkLookup<'a>,
	line: u32,
) -> Option<&'a str> {
	let deepest = line_to_containing_chunk(tree, line)?;
	// If the deepest chunk has children, it gets a closing tag — use it.
	if !deepest.children.is_empty() {
		return Some(&deepest.path);
	}
	// Leaf: promote to parent (which has children and a closing tag).
	if let Some(parent_path) = deepest.parent_path.as_deref()
		&& let Some(parent) = lookup.get(parent_path)
		&& !parent.path.is_empty()
	{
		return Some(&parent.path);
	}
	// Root-level leaf — no parent with a closing tag.
	None
}

/// Compute the indentation string for inline hunks placed inside a chunk.
///
/// Uses the chunk's own body anchor indent plus one additional level, which
/// aligns hunks at the same depth as the chunk's child anchors.
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

/// Render a chunk tree with diff hunks inlined into their owning chunk blocks.
pub fn render_state_with_hunks(
	state: &ChunkStateInner,
	params: &RenderParams,
	inline_hunks: HashMap<String, Vec<InlineHunk>>,
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
		&source_lines,
		tab_replacement,
		normalize_indent,
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
		&source_lines,
		tab_replacement,
		normalize_indent,
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
		focus,
		inline_hunks,
	};

	push_line(
		&mut ctx.out,
		format!(
			"{}| {}",
			" ".repeat(num_width),
			format_header_meta(
				params.title.as_str(),
				rendered_line_count,
				params.language_tag.as_deref(),
				chunk.checksum.as_str(),
				params.omit_checksum,
			)
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
		// Emit any hunks mapped to the root (empty path).
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
