use std::collections::HashMap;

use crate::{
	chunk::types::{ChunkNode, ChunkTree, RenderChunkTreeParams, VisibleLineRange},
	env_uint,
};

type ChunkLookup<'a> = HashMap<&'a str, &'a ChunkNode>;

env_uint! {
	 // Configured full display threshold.
	 static FULL_DISPLAY_THRESHOLD: usize = "PI_CHUNK_FULL_DISPLAY_THRESHOLD" or 40 => [1, usize::MAX];
	 // Configured preview head lines.
	 static PREVIEW_HEAD_LINES: usize = "PI_CHUNK_PREVIEW_HEAD_LINES" or 10 => [1, usize::MAX];
	 // Configured preview tail lines.
	 static PREVIEW_TAIL_LINES: usize = "PI_CHUNK_PREVIEW_TAIL_LINES" or 5 => [1, usize::MAX];
}

pub fn line_to_containing_chunk_path(tree: &ChunkTree, line: u32) -> Option<String> {
	line_to_containing_chunk(tree, line).map(|chunk| chunk.path.clone())
}

pub fn render_chunk_tree(params: &RenderChunkTreeParams) -> String {
	let lookup = build_lookup(&params.tree);
	let Some(chunk) = get_chunk(&lookup, params.chunk_path.as_deref().unwrap_or("")) else {
		return String::new();
	};
	let source_lines: Vec<&str> = params.source.split('\n').collect();
	let full_display_threshold = *FULL_DISPLAY_THRESHOLD;
	let preview_head_lines = *PREVIEW_HEAD_LINES;
	let preview_tail_lines = *PREVIEW_TAIL_LINES;
	let tab_replacement = params.tab_replacement.as_deref().unwrap_or("    ");
	let num_width = compute_num_width(
		&params.tree,
		chunk,
		&lookup,
		params.visible_range.as_ref(),
		params.render_children_only,
		params.show_leaf_preview,
		&source_lines,
		tab_replacement,
		full_display_threshold,
		preview_head_lines,
		preview_tail_lines,
	);
	let rendered_line_count = compute_rendered_line_count(
		&params.tree,
		chunk,
		&lookup,
		params.visible_range.as_ref(),
		params.render_children_only,
		params.show_leaf_preview,
		&source_lines,
		tab_replacement,
		full_display_threshold,
		preview_head_lines,
		preview_tail_lines,
	);

	let mut ctx = RenderCtx {
		out: String::new(),
		tree: &params.tree,
		lookup: &lookup,
		source_lines: &source_lines,
		num_width,
		visible_range: params.visible_range.as_ref(),
		omit_checksum: params.omit_checksum,
		show_leaf_preview: params.show_leaf_preview,
		last_was_blank_meta: false,
		full_display_threshold,
		preview_head_lines,
		preview_tail_lines,
		tab_replacement,
	};

	push_line(
		&mut ctx.out,
		format!(
			"{} │ {}",
			" ".repeat(num_width),
			format_header_meta(
				params.title.as_str(),
				rendered_line_count,
				params.language_tag.as_deref(),
				params.checksum.as_str(),
				params.omit_checksum,
			)
		),
	);
	push_blank_meta(&mut ctx);

	if params.render_children_only {
		let children =
			visible_children_for_chunk(&params.tree, chunk, &lookup, params.visible_range.as_ref());
		for (index, child) in children.iter().enumerate() {
			emit_chunk_subtree(&mut ctx, child, 0, ChunkSubtreeOptions {
				is_first_top_level:            index == 0,
				between_top_level_definitions: true,
			});
		}
		return ctx.out;
	}

	if chunk.children.is_empty() {
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
			chunk.kind == "leaf"
				&& chunk.start_line <= line
				&& line <= chunk.end_line
				&& !chunk.path.is_empty()
		})
		.min_by_key(|chunk| chunk.line_count)
}

fn smallest_containing_chunk(tree: &ChunkTree, line: u32) -> Option<&ChunkNode> {
	let mut best: Option<&ChunkNode> = None;
	for chunk in &tree.chunks {
		if chunk.path.is_empty() || chunk.start_line > line || line > chunk.end_line {
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
		.collect::<Vec<_>>();
	children.sort_unstable_by_key(|child| child.start_line);
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

fn chunk_body_anchor_indent<'a>(source_lines: &'a [&str], chunk: &ChunkNode) -> &'a str {
	source_lines
		.get(chunk.start_line.saturating_sub(1) as usize)
		.map_or("", |line| leading_whitespace(line))
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
	Ellipsis { count: usize, start_abs: u32, end_abs: u32 },
}

fn build_leaf_entries(
	source_lines: &[&str],
	span: VisibleSpan,
	tab_replacement: &str,
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
				.map_or(String::new(), |text| text.replace('\t', tab_replacement)),
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
	let omitted = visible_line_count.saturating_sub(head.len() + tail.len());
	let first_omitted = low + head.len() as u32;
	let last_omitted = high.saturating_sub(tail.len() as u32);
	let mut entries = Vec::with_capacity(head.len() + tail.len() + 1);
	entries.extend(head);
	entries.push(LeafEntry::Ellipsis {
		count:     omitted,
		start_abs: first_omitted,
		end_abs:   last_omitted,
	});
	entries.extend(tail);
	entries
}

fn format_anchor_tag(chunk: &ChunkNode, depth: usize, omit_checksum: bool) -> String {
	let prefix = if depth == 0 { ':' } else { '.' };
	let checksum = if omit_checksum {
		String::new()
	} else {
		format!("#{}", chunk.checksum)
	};
	format!("<{}{}{}>", prefix, chunk.name, checksum)
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
		format!("  ·  #{checksum}")
	};
	format!("{title}  ·  {line_count}ln  ·  {language}{checksum_part}")
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
	let children = visible_children_for_chunk(tree, chunk, lookup, None);
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
	full_display_threshold: usize,
	preview_head_lines: usize,
	preview_tail_lines: usize,
	visit: &mut impl FnMut(u32),
) {
	let children = visible_children_for_chunk(tree, chunk, lookup, visible_range);
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
	let children = visible_children_for_chunk(tree, chunk, lookup, visible_range);
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
	source_lines:           &'a [&'a str],
	num_width:              usize,
	visible_range:          Option<&'a VisibleLineRange>,
	omit_checksum:          bool,
	show_leaf_preview:      bool,
	last_was_blank_meta:    bool,
	full_display_threshold: usize,
	preview_head_lines:     usize,
	preview_tail_lines:     usize,
	tab_replacement:        &'a str,
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
	push_line(&mut ctx.out, format!("{} │", " ".repeat(ctx.num_width)));
	ctx.last_was_blank_meta = true;
}

fn push_meta(ctx: &mut RenderCtx<'_>, body: String) {
	ctx.last_was_blank_meta = false;
	push_line(&mut ctx.out, format!("{} │ {}", " ".repeat(ctx.num_width), body));
}

fn push_code(ctx: &mut RenderCtx<'_>, abs_line: u32, source_text: &str) {
	ctx.last_was_blank_meta = false;
	push_line(
		&mut ctx.out,
		format!("{} │ {}", abs_line.to_string().pad_start(ctx.num_width, ' '), source_text),
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
			.map_or(String::new(), |text| text.replace('\t', ctx.tab_replacement));
		push_code(ctx, line, &text);
	}
}

fn emit_leaf_body(ctx: &mut RenderCtx<'_>, _chunk: &ChunkNode, span: VisibleSpan) {
	for entry in build_leaf_entries(
		ctx.source_lines,
		span,
		ctx.tab_replacement,
		ctx.full_display_threshold,
		ctx.preview_head_lines,
		ctx.preview_tail_lines,
	) {
		match entry {
			LeafEntry::Line { abs_line, text } => push_code(ctx, abs_line, &text),
			LeafEntry::Ellipsis { count, start_abs, end_abs } => {
				push_meta(ctx, format!("sel=L{start_abs}-L{end_abs} to expand ({count} lines)"));
			},
		}
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
	let children = visible_children_for_chunk(ctx.tree, chunk, ctx.lookup, ctx.visible_range);
	let span = intersect_visible_span(chunk, ctx.visible_range);
	let has_kids = !children.is_empty();

	if !chunk.path.is_empty() && span.is_none() && !has_kids {
		return;
	}
	if options.between_top_level_definitions && depth == 0 && !options.is_first_top_level {
		push_blank_meta(ctx);
	}
	if !chunk.path.is_empty() {
		let anchor_indent = chunk_body_anchor_indent(ctx.source_lines, chunk);
		push_meta(
			ctx,
			format!("{}{}", anchor_indent, format_anchor_tag(chunk, depth, ctx.omit_checksum)),
		);
	}
	if !has_kids {
		if ctx.show_leaf_preview
			&& let Some(span) = span
		{
			emit_leaf_body(ctx, chunk, span);
		}
		return;
	}
	if let Some(span) = span {
		let mut cursor = chunk.start_line;
		for child in children {
			let gap_end = child.start_line.saturating_sub(1);
			if gap_end >= cursor {
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
		if cursor <= span.end {
			emit_line_gap(ctx, cursor, span.end);
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
	let children = visible_children_for_chunk(tree, chunk, lookup, visible_range);
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
		full_display_threshold,
		preview_head_lines,
		preview_tail_lines,
		&mut |line| {
			max_line = max_line.max(line as usize);
		},
	);
	max_line.to_string().len().max(1)
}
