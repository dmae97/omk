use std::{cmp::Ordering, path::Path};

use crate::chunk::{
	indent::{
		detect_common_indent, detect_file_indent_char, detect_file_indent_step,
		normalize_leading_whitespace_char, reindent_inserted_block, strip_content_prefixes,
	},
	resolve::{
		resolve_chunk_selector, resolve_chunk_with_crc, sanitize_chunk_selector, sanitize_crc,
	},
	state::{ChunkState, ChunkStateInner},
	types::{
		ChunkAnchorStyle, ChunkEditOp, ChunkNode, EditOperation, EditParams, EditResult, RenderParams,
	},
};

#[derive(Clone)]
struct ScheduledEditOperation {
	operation:          EditOperation,
	original_index:     usize,
	requested_selector: Option<String>,
	initial_chunk:      Option<ChunkNode>,
}

#[derive(Clone, Copy)]
enum InsertPosition {
	Before,
	After,
	FirstChild,
	LastChild,
}

#[derive(Clone, Copy)]
struct InsertSpacing {
	blank_line_before: bool,
	blank_line_after:  bool,
}

#[derive(Clone)]
struct InsertionPoint {
	offset: usize,
	indent: String,
}

pub fn apply_edits(state: &ChunkState, params: &EditParams) -> Result<EditResult, String> {
	let original_text = normalize_chunk_source(state.inner().source());
	let mut state =
		rebuild_chunk_state(original_text.clone(), state.inner().language().to_string())?;
	let file_indent_step = detect_file_indent_step(&state.tree) as usize;
	let file_indent_char = detect_file_indent_char(&state.source, &state.tree);
	let initial_parse_errors = state.tree.parse_errors;
	let mut touched_paths = Vec::new();
	let mut warnings = Vec::new();
	let mut last_scheduled: Option<ScheduledEditOperation> = None;
	let initial_default_selector = params.default_selector.clone();
	let initial_default_crc = params.default_crc.clone();

	let mut scheduled_ops = Vec::with_capacity(params.operations.len());
	for (original_index, operation) in params.operations.iter().cloned().enumerate() {
		let selector = operation
			.sel
			.as_deref()
			.or(initial_default_selector.as_deref());
		let requested_selector = sanitize_chunk_selector(selector);
		let initial_chunk = resolve_chunk_selector(&state, selector, &mut warnings)
			.ok()
			.cloned();
		scheduled_ops.push(ScheduledEditOperation {
			operation,
			original_index,
			requested_selector,
			initial_chunk,
		});
	}

	for scheduled in &scheduled_ops {
		if !is_line_scoped(&scheduled.operation) {
			continue;
		}
		let anchor = scheduled.initial_chunk.as_ref().ok_or_else(|| {
			format!("Chunk tree is missing an anchor for {}", describe_scheduled_operation(scheduled))
		})?;
		let line = scheduled
			.operation
			.line
			.ok_or_else(|| "line-scoped replace is missing line".to_owned())?;
		let abs_end = scheduled.operation.end_line.unwrap_or(line);
		validate_line_range(anchor, line, abs_end)?;
	}

	let mut execution_ops = Vec::with_capacity(scheduled_ops.len());
	let mut index = 0usize;
	while index < scheduled_ops.len() {
		let scheduled = scheduled_ops[index].clone();
		if !is_line_scoped(&scheduled.operation) {
			execution_ops.push(scheduled);
			index += 1;
			continue;
		}

		let mut block = vec![scheduled];
		index += 1;
		while index < scheduled_ops.len() && is_line_scoped(&scheduled_ops[index].operation) {
			block.push(scheduled_ops[index].clone());
			index += 1;
		}

		block.sort_by(|left, right| {
			let left_key = line_scoped_sort_key(left);
			let right_key = line_scoped_sort_key(right);
			right_key
				.cmp(&left_key)
				.then_with(|| left.original_index.cmp(&right.original_index))
		});
		execution_ops.extend(block);
	}

	let current_default_selector = initial_default_selector.clone();
	let mut current_default_crc = initial_default_crc;
	let total_ops = params.operations.len();

	for scheduled in execution_ops {
		last_scheduled = Some(scheduled.clone());
		let operation = normalize_operation_literals(&scheduled.operation);
		let result = match operation.op {
			ChunkEditOp::Replace => apply_replace(
				&mut state,
				&operation,
				&scheduled,
				current_default_selector.as_deref(),
				current_default_crc.as_deref(),
				file_indent_step,
				file_indent_char,
				&mut touched_paths,
				&mut warnings,
			),
			ChunkEditOp::Delete => apply_delete(
				&mut state,
				&operation,
				&scheduled,
				current_default_selector.as_deref(),
				current_default_crc.as_deref(),
				&mut touched_paths,
				&mut warnings,
			),
			ChunkEditOp::AppendChild
			| ChunkEditOp::PrependChild
			| ChunkEditOp::AppendSibling
			| ChunkEditOp::PrependSibling => apply_insert(
				&mut state,
				&operation,
				&scheduled,
				current_default_selector.as_deref(),
				current_default_crc.as_deref(),
				file_indent_step,
				file_indent_char,
				&mut touched_paths,
				&mut warnings,
			),
		};

		if let Err(err) = result {
			return Err(format!(
				"Edit operation {}/{} failed ({}): {}\nNo changes were saved. Fix the failing \
				 operation and retry the entire batch.",
				scheduled.original_index + 1,
				total_ops,
				describe_scheduled_operation(&scheduled),
				err,
			));
		}

		state = rebuild_chunk_state(state.source.clone(), state.language.clone())?;
		if operation.sel.is_none() {
			current_default_crc = None;
		}
	}

	let parse_valid = state.tree.parse_errors <= initial_parse_errors;
	if !parse_valid && initial_parse_errors == 0 {
		let error_summaries = format_parse_error_summaries(&state);
		let fallback_summary = if error_summaries.is_empty() {
			if let Some(last) = last_scheduled
				.as_ref()
				.and_then(|scheduled| scheduled.initial_chunk.as_ref())
			{
				vec![format!(
					"L{}:C1 parse error introduced while editing {}",
					last.start_line, last.path
				)]
			} else {
				Vec::new()
			}
		} else {
			error_summaries
		};
		let details = if fallback_summary.is_empty() {
			String::new()
		} else {
			format!(
				"\nParse errors:\n{}",
				fallback_summary
					.into_iter()
					.map(|summary| format!("- {summary}"))
					.collect::<Vec<_>>()
					.join("\n")
			)
		};
		return Err(format!(
			"Edit rejected: introduced {} parse error(s). The file was valid before the edit but is \
			 not after. Fix the content and retry.{}",
			state.tree.parse_errors, details
		));
	}
	if !parse_valid {
		warnings.push(format!(
			"Edit introduced {} new parse error(s).",
			state.tree.parse_errors.saturating_sub(initial_parse_errors)
		));
	}

	let display_path = display_path_for_file(&params.file_path, &params.cwd);
	let changed = original_text != state.source;
	let diff_before = original_text;
	let diff_after = state.source.clone();
	let response_text = if changed {
		render_changed_hunks(&state, &display_path, &diff_before, &diff_after, params.anchor_style)
	} else {
		render_unchanged_response(&state, &display_path, params.anchor_style)
	};

	Ok(EditResult {
		state: ChunkState::from_inner(state),
		diff_before,
		diff_after,
		response_text,
		changed,
		parse_valid,
		touched_paths,
		warnings,
	})
}

fn apply_replace(
	state: &mut ChunkStateInner,
	operation: &EditOperation,
	scheduled: &ScheduledEditOperation,
	default_selector: Option<&str>,
	default_crc: Option<&str>,
	file_indent_step: usize,
	file_indent_char: char,
	touched_paths: &mut Vec<String>,
	warnings: &mut Vec<String>,
) -> Result<(), String> {
	let anchor_selector = operation.sel.as_deref().or(default_selector);
	let crc = operation.crc.as_deref().or_else(|| {
		if operation.sel.is_none() {
			default_crc
		} else {
			None
		}
	});
	let requires_checksum = operation.sel.is_some() || default_crc.is_some();
	let batch_auto_accepted = ensure_batch_operation_target_current(scheduled, crc, touched_paths);
	let resolved = resolve_chunk_with_crc(state, anchor_selector, crc, warnings)?;
	if !batch_auto_accepted {
		validate_batch_crc(resolved.chunk, resolved.crc.as_deref(), requires_checksum)?;
	}
	let anchor = resolved.chunk.clone();

	if let Some(line) = operation.line {
		let abs_end = operation.end_line.unwrap_or(line);
		validate_line_range(&anchor, line, abs_end)?;
		let offsets = line_offsets(&state.source);
		let abs_beg = line;
		let range_start = line_start_offset(&offsets, abs_beg, &state.source);
		let range_end = line_end_offset(&offsets, abs_end, &state.source);
		let replaced_range = state.source[range_start..range_end].to_owned();
		let target_indent = if is_zero_width_insert(abs_beg, abs_end) {
			let ind_a = detect_common_indent(
				&state.source[line_start_offset(&offsets, abs_end, &state.source)
					..line_end_offset(&offsets, abs_end, &state.source)],
			)
			.prefix;
			let b_line = abs_beg.min(state.tree.line_count);
			let ind_b = detect_common_indent(
				&state.source[line_start_offset(&offsets, b_line, &state.source)
					..line_end_offset(&offsets, b_line, &state.source)],
			)
			.prefix;
			if ind_a.len() >= ind_b.len() {
				ind_a
			} else {
				ind_b
			}
		} else {
			detect_common_indent(&replaced_range).prefix
		};
		let content = operation.content.as_deref().unwrap_or_default();
		let mut replacement = normalize_inserted_content(
			content,
			&target_indent,
			Some(file_indent_step),
			file_indent_char,
		);
		if !replacement.is_empty() && !replacement.ends_with('\n') && abs_end < state.tree.line_count
		{
			replacement.push('\n');
		}
		state.source = replace_range_by_lines(&state.source, abs_beg, abs_end, &replacement);
		if replacement.is_empty() {
			state.source = cleanup_blank_line_artifacts_at_offset(&state.source, range_start);
		}
		touched_paths.push(anchor.path);
		return Ok(());
	}

	let target_indent = anchor.indent_char.repeat(anchor.indent as usize);
	let content = operation.content.as_deref().unwrap_or_default();
	let mut replacement =
		normalize_inserted_content(content, &target_indent, Some(file_indent_step), file_indent_char);
	if !replacement.is_empty()
		&& !replacement.ends_with('\n')
		&& anchor.end_line < state.tree.line_count
	{
		replacement.push('\n');
	}
	let offsets = line_offsets(&state.source);
	let range_start = line_start_offset(&offsets, anchor.start_line, &state.source);
	state.source =
		replace_range_by_lines(&state.source, anchor.start_line, anchor.end_line, &replacement);
	if replacement.is_empty() {
		state.source = cleanup_blank_line_artifacts_at_offset(&state.source, range_start);
	}
	touched_paths.push(anchor.path);
	Ok(())
}

fn apply_delete(
	state: &mut ChunkStateInner,
	operation: &EditOperation,
	scheduled: &ScheduledEditOperation,
	default_selector: Option<&str>,
	default_crc: Option<&str>,
	touched_paths: &mut Vec<String>,
	warnings: &mut Vec<String>,
) -> Result<(), String> {
	let anchor_selector = operation.sel.as_deref().or(default_selector);
	let crc = operation.crc.as_deref().or_else(|| {
		if operation.sel.is_none() {
			default_crc
		} else {
			None
		}
	});
	let requires_checksum = operation.sel.is_some() || default_crc.is_some();
	let batch_auto_accepted = ensure_batch_operation_target_current(scheduled, crc, touched_paths);
	let resolved = resolve_chunk_with_crc(state, anchor_selector, crc, warnings)?;
	if !batch_auto_accepted {
		validate_batch_crc(resolved.chunk, resolved.crc.as_deref(), requires_checksum)?;
	}
	let anchor = resolved.chunk.clone();

	let offsets = line_offsets(&state.source);
	let range_start = line_start_offset(&offsets, anchor.start_line, &state.source);
	state.source = replace_range_by_lines(&state.source, anchor.start_line, anchor.end_line, "");
	state.source = cleanup_blank_line_artifacts_at_offset(&state.source, range_start);
	touched_paths.push(anchor.path);
	Ok(())
}

fn apply_insert(
	state: &mut ChunkStateInner,
	operation: &EditOperation,
	scheduled: &ScheduledEditOperation,
	default_selector: Option<&str>,
	default_crc: Option<&str>,
	file_indent_step: usize,
	file_indent_char: char,
	touched_paths: &mut Vec<String>,
	warnings: &mut Vec<String>,
) -> Result<(), String> {
	let anchor_selector = operation.sel.as_deref().or(default_selector);
	let crc = operation.crc.as_deref().or_else(|| {
		if operation.sel.is_none() {
			default_crc
		} else {
			None
		}
	});
	let batch_auto_accepted = ensure_batch_operation_target_current(scheduled, crc, touched_paths);
	let resolved = resolve_chunk_with_crc(state, anchor_selector, crc, warnings)?;
	if !batch_auto_accepted {
		validate_batch_crc(resolved.chunk, resolved.crc.as_deref(), resolved.crc.is_some())?;
	}
	let anchor = resolved.chunk.clone();

	let pos = match operation.op {
		ChunkEditOp::AppendChild => InsertPosition::LastChild,
		ChunkEditOp::PrependChild => InsertPosition::FirstChild,
		ChunkEditOp::AppendSibling => InsertPosition::After,
		ChunkEditOp::PrependSibling => InsertPosition::Before,
		ChunkEditOp::Replace | ChunkEditOp::Delete => {
			return Err("Internal error: insert position requested for non-insert op".to_owned());
		},
	};
	let insertion = get_insertion_point_for_position(
		state,
		&anchor,
		pos,
		if matches!(pos, InsertPosition::FirstChild | InsertPosition::LastChild) {
			operation.content.as_deref()
		} else {
			None
		},
	)?;
	let spacing = compute_insert_spacing(state, &anchor, pos);
	let content = operation.content.as_deref().unwrap_or_default();
	let mut replacement = normalize_inserted_content(
		content,
		&insertion.indent,
		Some(file_indent_step),
		file_indent_char,
	);
	replacement =
		normalize_insertion_boundary_content(state, insertion.offset, &replacement, spacing);

	if operation.op == ChunkEditOp::PrependChild {
		let body = replacement.trim_matches('\n');
		let comment_only = !body.is_empty()
			&& body.lines().all(|line| {
				let trimmed = line.trim();
				trimmed.is_empty()
					|| trimmed.starts_with("//")
					|| trimmed.starts_with("///")
					|| trimmed.starts_with('#')
					|| trimmed.starts_with("/*")
			});
		if comment_only
			&& anchor.path.is_empty()
			&& anchor.children.iter().any(|child| child == "preamble")
		{
			return Err(
				"Comment-only prepend_child on root is not allowed when the file has a preamble \
				 chunk. Use replace on the preamble chunk instead."
					.to_owned(),
			);
		}
		if comment_only && !anchor.children.is_empty() {
			warnings.push(
				"Comment-only prepend_child can merge into the following chunk's first line; it is \
				 not a separate named chunk."
					.to_owned(),
			);
		}
	}

	state.source = insert_at_offset(&state.source, insertion.offset, &replacement);
	touched_paths.push(anchor.path);
	Ok(())
}

fn normalize_operation_literals(operation: &EditOperation) -> EditOperation {
	let mut operation = operation.clone();
	if matches!(operation.sel.as_deref(), Some("null" | "undefined")) {
		operation.sel = None;
	}
	if matches!(operation.crc.as_deref(), Some("null" | "undefined")) {
		operation.crc = None;
	}
	operation
}

fn normalize_chunk_source(text: &str) -> String {
	text
		.strip_prefix('\u{feff}')
		.unwrap_or(text)
		.replace("\r\n", "\n")
		.replace('\r', "\n")
}

fn rebuild_chunk_state(source: String, language: String) -> Result<ChunkStateInner, String> {
	let tree = crate::chunk::build_chunk_tree(source.as_str(), language.as_str())
		.map_err(|err| err.to_string())?;
	Ok(ChunkStateInner::new(source, language, tree))
}

fn validate_batch_crc(chunk: &ChunkNode, crc: Option<&str>, required: bool) -> Result<(), String> {
	if !required {
		return Ok(());
	}
	validate_crc(chunk, crc)
}

fn validate_crc(chunk: &ChunkNode, crc: Option<&str>) -> Result<(), String> {
	let cleaned = sanitize_crc(crc).ok_or_else(|| {
		format!(
			"Checksum required for {}. Re-read the chunk to get the current checksum, then pass crc: \
			 \"XXXX\" in your edit operation. Hint: use crc: \"{}\" with sel: \"{}\".",
			chunk_path_opt(chunk),
			chunk.checksum,
			chunk.path
		)
	})?;
	if chunk.checksum != cleaned {
		return Err(format!(
			"Checksum mismatch for {}: expected \"{}\", got \"{}\". The chunk content has changed \
			 since you last read it. Re-read the file to get updated checksums, then retry with the \
			 new crc value.",
			chunk_path_opt(chunk),
			chunk.checksum,
			cleaned
		));
	}
	Ok(())
}

const fn chunk_path_opt(chunk: &ChunkNode) -> &str {
	if chunk.path.is_empty() {
		"root"
	} else {
		chunk.path.as_str()
	}
}

fn validate_line_range(anchor: &ChunkNode, line: u32, end_line: u32) -> Result<(), String> {
	let c_start = anchor.start_line;
	let c_end = anchor.end_line;
	let chunk_name = chunk_path_opt(anchor);
	if line < 1 {
		return Err(format!(
			"Line {line} is invalid for {chunk_name}; line and end_line are absolute file line \
			 numbers (1-indexed). This chunk spans file lines {c_start}-{c_end}."
		));
	}
	if line > end_line.saturating_add(1) {
		return Err(format!(
			"Invalid line range L{line}-L{end_line} for {chunk_name}: use line ≤ end_line to replace \
			 lines, or line = end_line + 1 for zero-width insertion."
		));
	}
	if line <= end_line {
		if line < c_start || end_line > c_end {
			return Err(format!(
				"Line range L{line}-L{end_line} is outside {chunk_name} (chunk spans file lines \
				 {c_start}-{c_end}). Use absolute line numbers from read output."
			));
		}
		return Ok(());
	}

	let before_chunk = end_line == c_start.saturating_sub(1) && line == c_start;
	let inside_gap = c_start <= end_line && end_line < c_end && line == end_line + 1;
	let after_chunk = end_line == c_end && line == c_end + 1;
	if before_chunk || inside_gap || after_chunk {
		return Ok(());
	}

	Err(format!(
		"Invalid zero-width insert L{line}-L{end_line} for {chunk_name} (chunk spans file lines \
		 {c_start}-{c_end}). Use end_line = {}, line = {c_start} to insert before the first chunk \
		 line; end_line = k, line = k + 1 with {c_start} ≤ k < {c_end} between interior lines; \
		 end_line = {c_end}, line = {} to insert after the last chunk line.",
		c_start.saturating_sub(1),
		c_end + 1
	))
}

const fn is_zero_width_insert(line: u32, end_line: u32) -> bool {
	line == end_line + 1
}

const fn zero_width_insert_sort_key(anchor: &ChunkNode, end_line: u32, line: u32) -> u32 {
	let c_start = anchor.start_line;
	if end_line == c_start.saturating_sub(1) && line == c_start {
		c_start
	} else {
		end_line
	}
}

fn line_scoped_sort_key(scheduled: &ScheduledEditOperation) -> u32 {
	let operation = &scheduled.operation;
	let Some(line) = operation.line else {
		return 0;
	};
	let Some(anchor) = scheduled.initial_chunk.as_ref() else {
		return 0;
	};
	let abs_end = operation.end_line.unwrap_or(line);
	if is_zero_width_insert(line, abs_end) {
		zero_width_insert_sort_key(anchor, abs_end, line)
	} else {
		line
	}
}

fn is_line_scoped(operation: &EditOperation) -> bool {
	operation.op == ChunkEditOp::Replace && operation.line.is_some()
}

fn touches_chunk_path(touched_paths: &[String], selector: &str) -> bool {
	touched_paths.iter().any(|touched| {
		touched == selector
			|| touched.starts_with(&format!("{selector}."))
			|| selector.starts_with(&format!("{touched}."))
	})
}

/// Returns `true` when the CRC was auto-accepted (chunk was touched by an
/// earlier batch op and the model supplied the pre-batch CRC). The caller
/// should skip CRC validation in that case.
fn ensure_batch_operation_target_current(
	scheduled: &ScheduledEditOperation,
	crc: Option<&str>,
	touched_paths: &[String],
) -> bool {
	let Some(selector) = scheduled.requested_selector.as_deref() else {
		return false;
	};
	let Some(initial_chunk) = scheduled.initial_chunk.as_ref() else {
		return false;
	};
	let Some(cleaned_crc) = sanitize_crc(crc) else {
		return false;
	};
	if !touches_chunk_path(touched_paths, selector) || cleaned_crc != initial_chunk.checksum {
		return false;
	}
	// The chunk was touched by an earlier operation in this batch, and the model
	// supplied the pre-batch CRC (which is all it could know). Auto-accept.
	true
}

fn describe_scheduled_operation(scheduled: &ScheduledEditOperation) -> String {
	let op = scheduled.operation.op.as_str();
	if let Some(selector) = scheduled.requested_selector.as_deref() {
		format!("{op} on \"{selector}\"")
	} else {
		op.to_owned()
	}
}

fn normalize_inserted_content(
	content: &str,
	target_indent: &str,
	file_indent_step: Option<usize>,
	file_indent_char: char,
) -> String {
	let mut normalized = normalize_chunk_source(content);
	normalized = strip_content_prefixes(&normalized);
	if target_indent.is_empty() {
		// Even at indent level 0, normalize the content's indent character
		// to match the file's convention (e.g. LLM sends spaces for a tab file).
		normalized =
			normalize_leading_whitespace_char(&normalized, file_indent_char, file_indent_step);
	} else {
		normalized = reindent_inserted_block(&normalized, target_indent, file_indent_step);
	}
	normalized
}

fn line_offsets(text: &str) -> Vec<usize> {
	let mut offsets = vec![0usize];
	for (index, ch) in text.char_indices() {
		if ch == '\n' {
			offsets.push(index + 1);
		}
	}
	offsets
}

fn line_start_offset(offsets: &[usize], line: u32, text: &str) -> usize {
	if line <= 1 {
		0
	} else {
		offsets
			.get((line - 1) as usize)
			.copied()
			.unwrap_or(text.len())
	}
}

fn line_end_offset(offsets: &[usize], line: u32, text: &str) -> usize {
	offsets.get(line as usize).copied().unwrap_or(text.len())
}

fn replace_range_by_lines(text: &str, start_line: u32, end_line: u32, replacement: &str) -> String {
	let offsets = line_offsets(text);
	let start_offset = line_start_offset(&offsets, start_line, text);
	let end_offset = line_end_offset(&offsets, end_line, text);
	format!("{}{}{}", &text[..start_offset], replacement, &text[end_offset..])
}

fn insert_at_offset(text: &str, offset: usize, content: &str) -> String {
	format!("{}{}{}", &text[..offset], content, &text[offset..])
}

fn cleanup_blank_line_artifacts_at_offset(text: &str, offset: usize) -> String {
	let mut run_start = offset.min(text.len());
	while run_start > 0 && text.as_bytes()[run_start - 1] == b'\n' {
		run_start -= 1;
	}

	let mut run_end = offset.min(text.len());
	while run_end < text.len() && text.as_bytes()[run_end] == b'\n' {
		run_end += 1;
	}

	let newline_run = &text[run_start..run_end];
	if !newline_run.contains("\n\n") {
		return text.to_owned();
	}

	let after_run = &text[run_end..];
	let before_run = &text[..run_start];
	let trailing_line = before_run.rsplit('\n').next().unwrap_or("");
	let after_starts_with_close = after_run
		.trim_start_matches([' ', '\t'])
		.chars()
		.next()
		.is_some_and(|ch| matches!(ch, '}' | ']' | ')'));
	let trailing_trimmed = trailing_line.trim_matches([' ', '\t']);
	let trailing_is_only_close = trailing_trimmed.chars().count() == 1
		&& trailing_trimmed
			.chars()
			.next()
			.is_some_and(|ch| matches!(ch, '}' | ']' | ')'));
	let between_adjacent_closing = trailing_is_only_close && after_starts_with_close;

	if after_starts_with_close {
		if newline_run.contains("\n\n\n") {
			return format!("{}{}{}", before_run, collapse_newline_runs(newline_run, 2), after_run);
		}
		if between_adjacent_closing {
			return text.to_owned();
		}
		return format!("{before_run}\n{after_run}");
	}
	if !newline_run.contains("\n\n\n") {
		return text.to_owned();
	}
	format!("{}{}{}", before_run, collapse_newline_runs(newline_run, 2), after_run)
}

fn collapse_newline_runs(run: &str, max_newlines: usize) -> String {
	let mut out = String::with_capacity(run.len());
	let mut newline_count = 0usize;
	for ch in run.chars() {
		if ch == '\n' {
			newline_count += 1;
			if newline_count <= max_newlines {
				out.push(ch);
			}
		} else {
			newline_count = 0;
			out.push(ch);
		}
	}
	out
}

fn chunk_slice(text: &str, chunk: &ChunkNode) -> String {
	if chunk.line_count == 0 {
		return String::new();
	}
	text
		.split('\n')
		.skip(chunk.start_line.saturating_sub(1) as usize)
		.take((chunk.end_line - chunk.start_line + 1) as usize)
		.collect::<Vec<_>>()
		.join("\n")
}

fn is_container_like_chunk(chunk: &ChunkNode) -> bool {
	!chunk.leaf
		|| ["class_", "type_", "interface_", "enum_", "struct_", "impl_", "trait_", "mod_"]
			.iter()
			.any(|prefix| chunk.name.starts_with(prefix))
}

fn find_container_delimiter_offset(
	state: &ChunkStateInner,
	anchor: &ChunkNode,
	placement: Ordering,
) -> Option<usize> {
	let slice = &state.source[anchor.start_byte as usize..anchor.end_byte as usize];
	let open_brace = slice.find('{');
	let close_brace = slice.rfind('}');
	match (open_brace, close_brace) {
		(Some(open), Some(close)) if close >= open => Some(match placement {
			Ordering::Less => anchor.start_byte as usize + open + 1,
			_ => anchor.start_byte as usize + close,
		}),
		_ => None,
	}
}

fn compute_insert_indent(state: &ChunkStateInner, anchor: &ChunkNode, inside: bool) -> String {
	if !inside || anchor.path.is_empty() {
		return String::new();
	}
	if let Some(first_child_path) = anchor.children.first()
		&& let Some(first_child) = state
			.tree
			.chunks
			.iter()
			.find(|chunk| &chunk.path == first_child_path)
	{
		let indent_char = if first_child.indent_char.is_empty() {
			if anchor.indent_char.is_empty() {
				"\t"
			} else {
				anchor.indent_char.as_str()
			}
		} else {
			first_child.indent_char.as_str()
		};
		return indent_char.repeat(first_child.indent as usize);
	}

	for line in chunk_slice(&state.source, anchor).split('\n').skip(1) {
		if line.trim().is_empty() {
			continue;
		}
		let prefix_len = line.len() - line.trim_start_matches([' ', '\t']).len();
		if prefix_len > 0 {
			return line[..prefix_len].to_owned();
		}
		break;
	}

	let indent_char = if anchor.indent_char.is_empty() {
		"\t"
	} else {
		anchor.indent_char.as_str()
	};
	indent_char.repeat(anchor.indent as usize + 1)
}

fn go_type_append_child_insertion_point(
	state: &ChunkStateInner,
	anchor: &ChunkNode,
	insertion_content: Option<&str>,
) -> Option<(usize, String)> {
	if state.language != "go"
		|| !anchor.path.starts_with("type_")
		|| !is_container_like_chunk(anchor)
	{
		return None;
	}

	let offsets = line_offsets(&state.source);
	let mut child_chunks = anchor
		.children
		.iter()
		.filter_map(|path| state.tree.chunks.iter().find(|chunk| &chunk.path == path))
		.cloned()
		.collect::<Vec<_>>();
	let probe = insertion_content
		.map(normalize_chunk_source)
		.unwrap_or_default();
	let looks_like_file_scope_func = probe
		.lines()
		.any(|line| line.trim_start().starts_with("func"));

	if child_chunks.is_empty() {
		if !looks_like_file_scope_func {
			return None;
		}
		return Some((line_end_offset(&offsets, anchor.end_line, &state.source), String::new()));
	}

	child_chunks.sort_by_key(|chunk| chunk.start_line);
	if let Some(last_fn) = child_chunks
		.iter()
		.filter(|chunk| chunk.name.starts_with("fn_"))
		.max_by_key(|chunk| chunk.end_line)
	{
		return Some((line_end_offset(&offsets, last_fn.end_line, &state.source), String::new()));
	}
	if looks_like_file_scope_func {
		return Some((line_end_offset(&offsets, anchor.end_line, &state.source), String::new()));
	}
	None
}

fn get_insertion_point(
	state: &ChunkStateInner,
	anchor: &ChunkNode,
	placement: Ordering,
	insertion_content: Option<&str>,
) -> InsertionPoint {
	let offsets = line_offsets(&state.source);
	let is_container = is_container_like_chunk(anchor);

	if placement == Ordering::Less {
		if anchor.path.is_empty() {
			return InsertionPoint { offset: 0, indent: String::new() };
		}
		if is_container {
			let indent = compute_insert_indent(state, anchor, true);
			if let Some(first_child_path) = anchor.children.first()
				&& let Some(first_child) = state
					.tree
					.chunks
					.iter()
					.find(|chunk| &chunk.path == first_child_path)
			{
				return InsertionPoint {
					offset: line_start_offset(&offsets, first_child.start_line, &state.source),
					indent,
				};
			}
			if let Some(delimiter_offset) =
				find_container_delimiter_offset(state, anchor, Ordering::Less)
			{
				return InsertionPoint { offset: delimiter_offset, indent };
			}
			let fallback = line_end_offset(&offsets, anchor.start_line, &state.source);
			return InsertionPoint { offset: fallback, indent };
		}
		return InsertionPoint {
			offset: line_start_offset(&offsets, anchor.start_line, &state.source),
			indent: anchor.indent_char.repeat(anchor.indent as usize),
		};
	}

	if anchor.path.is_empty() {
		return InsertionPoint { offset: state.source.len(), indent: String::new() };
	}
	if is_container {
		if let Some((offset, indent)) =
			go_type_append_child_insertion_point(state, anchor, insertion_content)
		{
			return InsertionPoint { offset, indent };
		}
		if let Some(last_child_path) = anchor.children.last()
			&& let Some(last_child) = state
				.tree
				.chunks
				.iter()
				.find(|chunk| &chunk.path == last_child_path)
		{
			let indent_char = if last_child.indent_char.is_empty() {
				if anchor.indent_char.is_empty() {
					"\t"
				} else {
					anchor.indent_char.as_str()
				}
			} else {
				last_child.indent_char.as_str()
			};
			return InsertionPoint {
				offset: line_end_offset(&offsets, last_child.end_line, &state.source),
				indent: indent_char.repeat(last_child.indent as usize),
			};
		}
		let indent = compute_insert_indent(state, anchor, true);
		if let Some(delimiter_offset) =
			find_container_delimiter_offset(state, anchor, Ordering::Greater)
		{
			return InsertionPoint { offset: delimiter_offset, indent };
		}
		return InsertionPoint {
			offset: line_start_offset(&offsets, anchor.end_line, &state.source),
			indent,
		};
	}
	InsertionPoint {
		offset: line_end_offset(&offsets, anchor.end_line, &state.source),
		indent: anchor.indent_char.repeat(anchor.indent as usize),
	}
}

fn get_insertion_point_for_position(
	state: &ChunkStateInner,
	anchor: &ChunkNode,
	pos: InsertPosition,
	insertion_content: Option<&str>,
) -> Result<InsertionPoint, String> {
	let offsets = line_offsets(&state.source);
	match pos {
		InsertPosition::Before => {
			if anchor.path.is_empty() {
				return Ok(InsertionPoint { offset: 0, indent: String::new() });
			}
			Ok(InsertionPoint {
				offset: line_start_offset(&offsets, anchor.start_line, &state.source),
				indent: anchor.indent_char.repeat(anchor.indent as usize),
			})
		},
		InsertPosition::After => {
			if anchor.path.is_empty() {
				return Ok(InsertionPoint { offset: state.source.len(), indent: String::new() });
			}
			Ok(InsertionPoint {
				offset: line_end_offset(&offsets, anchor.end_line, &state.source),
				indent: anchor.indent_char.repeat(anchor.indent as usize),
			})
		},
		InsertPosition::FirstChild => {
			if !anchor.path.is_empty() && anchor.leaf && !is_container_like_chunk(anchor) {
				return Err(format!("Cannot use prepend_child on leaf chunk {}", anchor.path));
			}
			Ok(get_insertion_point(state, anchor, Ordering::Less, insertion_content))
		},
		InsertPosition::LastChild => {
			if !anchor.path.is_empty() && anchor.leaf && !is_container_like_chunk(anchor) {
				return Err(format!("Cannot use append_child on leaf chunk {}", anchor.path));
			}
			Ok(get_insertion_point(state, anchor, Ordering::Greater, insertion_content))
		},
	}
}

fn sibling_index(state: &ChunkStateInner, anchor: &ChunkNode) -> Option<(usize, usize)> {
	let parent_path = anchor.parent_path.as_deref().unwrap_or("");
	let parent = state
		.tree
		.chunks
		.iter()
		.find(|chunk| chunk.path == parent_path)?;
	let index = parent
		.children
		.iter()
		.position(|child| child == &anchor.path)?;
	Some((index, parent.children.len()))
}

fn has_sibling_before(state: &ChunkStateInner, anchor: &ChunkNode) -> bool {
	sibling_index(state, anchor).is_some_and(|(index, _)| index > 0)
}

fn has_sibling_after(state: &ChunkStateInner, anchor: &ChunkNode) -> bool {
	sibling_index(state, anchor).is_some_and(|(index, total)| index + 1 < total)
}

fn container_has_interior_content(state: &ChunkStateInner, anchor: &ChunkNode) -> bool {
	if !is_container_like_chunk(anchor) {
		return false;
	}
	chunk_slice(&state.source, anchor)
		.split('\n')
		.skip(1)
		.collect::<Vec<_>>()
		.into_iter()
		.rev()
		.skip(1)
		.any(|line| !line.trim().is_empty())
}

fn compute_insert_spacing(
	state: &ChunkStateInner,
	anchor: &ChunkNode,
	pos: InsertPosition,
) -> InsertSpacing {
	let has_interior_content = container_has_interior_content(state, anchor);
	match pos {
		InsertPosition::FirstChild => InsertSpacing {
			blank_line_before: false,
			blank_line_after:  !anchor.children.is_empty() || has_interior_content,
		},
		InsertPosition::LastChild => InsertSpacing {
			blank_line_before: !anchor.children.is_empty() || has_interior_content,
			blank_line_after:  false,
		},
		InsertPosition::Before => InsertSpacing {
			blank_line_before: has_sibling_before(state, anchor),
			blank_line_after:  true,
		},
		InsertPosition::After => InsertSpacing {
			blank_line_before: true,
			blank_line_after:  has_sibling_after(state, anchor),
		},
	}
}

fn count_trailing_newlines_before_offset(text: &str, offset: usize) -> usize {
	let mut count = 0usize;
	let bytes = text.as_bytes();
	let mut index = offset;
	while index > 0 && bytes[index - 1] == b'\n' {
		count += 1;
		index -= 1;
	}
	count
}

fn count_leading_newlines_after_offset(text: &str, offset: usize) -> usize {
	let mut count = 0usize;
	let bytes = text.as_bytes();
	let mut index = offset;
	while index < bytes.len() && bytes[index] == b'\n' {
		count += 1;
		index += 1;
	}
	count
}

fn normalize_insertion_boundary_content(
	state: &ChunkStateInner,
	offset: usize,
	content: &str,
	spacing: InsertSpacing,
) -> String {
	let trimmed = content.trim_matches('\n');
	if trimmed.is_empty() {
		return content.to_owned();
	}

	let prev_char = if offset > 0 {
		state
			.source
			.as_bytes()
			.get(offset - 1)
			.copied()
			.map(char::from)
	} else {
		None
	};
	let next_char = state.source.as_bytes().get(offset).copied().map(char::from);
	let prefix_newlines = if spacing.blank_line_before {
		2usize.saturating_sub(count_trailing_newlines_before_offset(&state.source, offset))
	} else {
		usize::from(prev_char.is_some() && prev_char != Some('\n'))
	};
	let suffix_newlines = if spacing.blank_line_after {
		2usize.saturating_sub(count_leading_newlines_after_offset(&state.source, offset))
	} else {
		usize::from(next_char.is_some() && next_char != Some('\n'))
	};

	format!("{}{}{}", "\n".repeat(prefix_newlines), trimmed, "\n".repeat(suffix_newlines))
}

fn line_column_at_offset(text: &str, offset: usize) -> (usize, usize) {
	let offsets = line_offsets(text);
	let mut low = 0usize;
	let mut high = offsets.len().saturating_sub(1);
	while low <= high {
		let mid = usize::midpoint(low, high);
		let start = offsets[mid];
		let next = offsets.get(mid + 1).copied().unwrap_or(text.len() + 1);
		if offset < start {
			if mid == 0 {
				break;
			}
			high = mid - 1;
			continue;
		}
		if offset >= next {
			low = mid + 1;
			continue;
		}
		return (mid + 1, offset - start + 1);
	}
	(offsets.len(), 1)
}

fn format_parse_error_summaries(state: &ChunkStateInner) -> Vec<String> {
	state
		.tree
		.chunks
		.iter()
		.filter(|chunk| chunk.error)
		.take(3)
		.map(|chunk| {
			let (line, column) = line_column_at_offset(&state.source, chunk.start_byte as usize);
			match chunk
				.signature
				.as_deref()
				.map(str::trim)
				.filter(|value| !value.is_empty())
			{
				Some(snippet) => format!("L{line}:C{column} unexpected syntax near {snippet:?}"),
				None => format!("L{line}:C{column} unexpected syntax"),
			}
		})
		.collect()
}

fn display_path_for_file(file_path: &str, cwd: &str) -> String {
	let file = Path::new(file_path);
	let cwd = Path::new(cwd);
	match file.strip_prefix(cwd) {
		Ok(relative) => relative.to_string_lossy().replace('\\', "/"),
		Err(_) => file.to_string_lossy().replace('\\', "/"),
	}
}

/// A parsed unified diff hunk.
struct DiffHunk {
	header: String,
	lines:  Vec<String>,
}

/// Generate unified diff hunks between two texts using the `similar` crate.
fn generate_diff_hunks(before: &str, after: &str, context: usize) -> Vec<DiffHunk> {
	use similar::{ChangeTag, TextDiff};

	let diff = TextDiff::from_lines(before, after);
	let mut hunks = Vec::new();

	for group in diff.grouped_ops(context) {
		let mut hunk_lines = Vec::new();

		let first = &group[0];
		let last = &group[group.len() - 1];
		let old_start = first.old_range().start + 1;
		let old_len = last.old_range().end - first.old_range().start;
		let new_start = first.new_range().start + 1;
		let new_len = last.new_range().end - first.new_range().start;

		let header = format!("@@ -{old_start},{old_len} +{new_start},{new_len} @@");

		for op in &group {
			for change in diff.iter_changes(op) {
				let line = change.value().trim_end_matches('\n');
				match change.tag() {
					ChangeTag::Equal => hunk_lines.push(format!(" {line}")),
					ChangeTag::Delete => hunk_lines.push(format!("-{line}")),
					ChangeTag::Insert => hunk_lines.push(format!("+{line}")),
				}
			}
		}

		hunks.push(DiffHunk { header, lines: hunk_lines });
	}

	hunks
}

/// Render the response text for a changed file, combining the current chunked
/// tree view with a zero-context unified diff hunk summary.
fn render_changed_hunks(
	state: &ChunkStateInner,
	display_path: &str,
	before: &str,
	after: &str,
	anchor_style: Option<ChunkAnchorStyle>,
) -> String {
	let show_leaf_preview = state.language == "tlaplus";
	let tree_text = crate::chunk::render::render_state(state, &RenderParams {
		chunk_path: Some(String::new()),
		title: display_path.to_owned(),
		language_tag: Some(state.language.clone()),
		visible_range: None,
		render_children_only: true,
		omit_checksum: false,
		anchor_style,
		show_leaf_preview,
		tab_replacement: Some("    ".to_owned()),
	});

	let hunks = generate_diff_hunks(before, after, 0);
	if hunks.is_empty() {
		return tree_text;
	}

	let diff_text = hunks
		.into_iter()
		.flat_map(|hunk| {
			let mut lines = Vec::with_capacity(hunk.lines.len() + 1);
			lines.push(hunk.header);
			lines.extend(hunk.lines);
			lines
		})
		.collect::<Vec<_>>()
		.join("\n");

	format!("{tree_text}\n\n{diff_text}")
}

fn render_unchanged_response(
	state: &ChunkStateInner,
	display_path: &str,
	anchor_style: Option<ChunkAnchorStyle>,
) -> String {
	crate::chunk::render::render_state(state, &RenderParams {
		chunk_path: Some(String::new()),
		title: display_path.to_owned(),
		language_tag: Some(state.language.clone()),
		visible_range: None,
		render_children_only: true,
		omit_checksum: false,
		anchor_style,
		show_leaf_preview: true,
		tab_replacement: Some("    ".to_owned()),
	})
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::chunk::build_chunk_tree;

	fn state_for(source: &str, language: &str) -> ChunkState {
		let tree = build_chunk_tree(source, language).expect("tree should build");
		ChunkState::from_inner(ChunkStateInner::new(source.to_owned(), language.to_owned(), tree))
	}

	#[test]
	fn root_level_replace_preserves_space_indentation() {
		let source = "fn main() {\n    println!(\"old\");\n}\n";
		let state = state_for(source, "rust");
		let chunk = state.inner().chunk("fn_main").expect("fn_main");

		let result = apply_edits(&state, &EditParams {
			operations:       vec![EditOperation {
				op:       ChunkEditOp::Replace,
				sel:      Some("fn_main".to_owned()),
				crc:      Some(chunk.checksum.clone()),
				content:  Some("fn main() {\n        println!(\"new\");\n}".to_owned()),
				line:     None,
				end_line: None,
			}],
			default_selector: None,
			default_crc:      None,
			anchor_style:     None,
			cwd:              ".".to_owned(),
			file_path:        "test.rs".to_owned(),
		})
		.expect("edit should apply");

		assert!(
			result.diff_after.contains("println!(\"new\");"),
			"expected updated body text, got {:?}",
			result.diff_after
		);
		assert!(
			!result.diff_after.contains("\n\tprintln!(\"new\");\n"),
			"expected no tab-indented body, got {:?}",
			result.diff_after
		);
	}
}
