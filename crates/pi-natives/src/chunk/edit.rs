use std::path::Path;

use crate::chunk::{
	indent::{
		denormalize_from_tabs, detect_file_indent_char, detect_file_indent_step,
		normalize_leading_whitespace_char, reindent_inserted_block, strip_content_prefixes,
	},
	kind::ChunkKind,
	resolve::{
		ParsedSelector, chunk_region_range, resolve_chunk_selector, resolve_chunk_with_crc,
		sanitize_chunk_selector, sanitize_crc, split_selector_crc_and_region,
	},
	state::{ChunkState, ChunkStateInner},
	types::{
		ChunkAnchorStyle, ChunkEditOp, ChunkFocusMode, ChunkNode, ChunkRegion, EditOperation,
		EditParams, EditResult, FocusedPath, RenderParams,
	},
};

#[derive(Clone)]
struct ScheduledEditOperation {
	operation:          EditOperation,
	original_index:     usize,
	requested_selector: Option<String>,
	initial_chunk:      Option<ChunkNode>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
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

#[derive(Clone)]
struct ResolvedEditTarget {
	chunk:  ChunkNode,
	region: Option<ChunkRegion>,
}

pub fn apply_edits(state: &ChunkState, params: &EditParams) -> Result<EditResult, String> {
	let original_text = normalize_chunk_source(state.inner().source());
	let initial_notebook_ctx = state.inner().notebook.clone();
	let mut state = rebuild_chunk_state(
		original_text.clone(),
		state.inner().language().to_string(),
		initial_notebook_ctx.clone(),
	)?;
	let file_indent_step = detect_file_indent_step(&state.tree) as usize;
	let file_indent_char = detect_file_indent_char(&state.source, &state.tree);
	let initial_parse_errors = state.tree.parse_errors;
	let initial_chunk_paths: std::collections::HashSet<String> =
		state.tree.chunks.iter().map(|c| c.path.clone()).collect();
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

	let execution_ops = scheduled_ops;
	let current_default_selector = initial_default_selector.as_deref();
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
				current_default_selector,
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
				current_default_selector,
				current_default_crc.as_deref(),
				&mut touched_paths,
				&mut warnings,
			),
			ChunkEditOp::Before | ChunkEditOp::After | ChunkEditOp::Prepend | ChunkEditOp::Append => {
				apply_insert(
					&mut state,
					&operation,
					&scheduled,
					current_default_selector,
					current_default_crc.as_deref(),
					file_indent_step,
					file_indent_char,
					&mut touched_paths,
					&mut warnings,
				)
			},
		};

		if let Err(err) = result {
			let display_path = display_path_for_file(&params.file_path, &params.cwd);
			let sel = operation.sel.as_deref().or(current_default_selector);
			let context = render_error_context(&state, sel, &display_path, params.anchor_style);
			return Err(format!(
				"Edit operation {}/{} failed ({}): {}\nNo changes were saved. Fix the failing \
				 operation and retry the entire batch.{context}",
				scheduled.original_index + 1,
				total_ops,
				describe_scheduled_operation(&scheduled),
				err,
			));
		}

		state =
			rebuild_chunk_state(state.source.clone(), state.language.clone(), state.notebook.clone())?;
		if operation.sel.is_none() {
			current_default_crc = None;
		}
	}

	let parse_valid = state.tree.parse_errors <= initial_parse_errors;
	if !parse_valid && initial_parse_errors == 0 {
		let error_summaries = format_parse_error_summaries(&state);
		let fallback_summary = if error_summaries.is_empty() {
			if let Some(scheduled) = last_scheduled.as_ref() {
				let chunk_label = scheduled
					.initial_chunk
					.as_ref()
					.map(|c| c.path.as_str())
					.or(scheduled.requested_selector.as_deref())
					.unwrap_or("<unknown chunk>");
				if let Some(chunk) = scheduled.initial_chunk.as_ref() {
					vec![format!(
						"L{}-L{} parse error introduced while editing {} (chunk spans file lines {}-{})",
						chunk.start_line, chunk.end_line, chunk_label, chunk.start_line, chunk.end_line
					)]
				} else {
					vec![format!("Parse error introduced while editing {chunk_label}")]
				}
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
		let display_path = display_path_for_file(&params.file_path, &params.cwd);
		let sel = last_scheduled
			.as_ref()
			.and_then(|s| s.operation.sel.as_deref())
			.or(initial_default_selector.as_deref());
		let context = render_error_context(&state, sel, &display_path, params.anchor_style);
		return Err(format!(
			"Edit rejected: introduced {} parse error(s). The file was valid before the edit but is \
			 not after. Fix the content and retry.{details}{context}",
			state.tree.parse_errors,
		));
	}
	if !parse_valid {
		warnings.push(format!(
			"Edit introduced {} new parse error(s).",
			state.tree.parse_errors.saturating_sub(initial_parse_errors)
		));
	}

	let display_path = display_path_for_file(&params.file_path, &params.cwd);
	let changed_virtual = original_text != state.source;

	// For notebooks, translate the virtual source back to JSON so the
	// caller sees the actual ipynb file content in `diff_before`/`diff_after`.
	// `initial_notebook_ctx` is the context captured at the very start of
	// this call; it holds the pre-edit cell metadata. We use it to stamp
	// the original JSON for `diff_before` and to produce the new JSON from
	// the mutated virtual source for `diff_after`.
	let (diff_before, diff_after) = if let Some(initial_ctx) = initial_notebook_ctx.as_ref() {
		let before_json = crate::chunk::ast_ipynb::notebook_to_json(&original_text, initial_ctx)
			.map_err(|err| format!("Failed to reconstruct pre-edit notebook JSON: {err}"))?;
		let after_json = crate::chunk::ast_ipynb::notebook_to_json(&state.source, initial_ctx)
			.map_err(|err| format!("Failed to serialize edited notebook JSON: {err}"))?;
		(before_json, after_json)
	} else {
		(original_text, state.source.clone())
	};
	let changed = diff_before != diff_after || changed_virtual;
	// Newly-created chunks (e.g. inserted siblings that landed outside the anchor's
	// parent subtree) are not reflected in `touched_paths` yet. Detect any chunk
	// that did not exist in the pre-edit tree and include it so the scoped
	// response tree actually shows the inserted content.
	for chunk in &state.tree.chunks {
		if !initial_chunk_paths.contains(&chunk.path) && !touched_paths.contains(&chunk.path) {
			touched_paths.push(chunk.path.clone());
		}
	}

	let response_text = if changed {
		render_changed_hunks(
			&state,
			&display_path,
			&diff_before,
			&diff_after,
			params.anchor_style,
			&touched_paths,
		)
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

fn resolve_edit_target(
	state: &ChunkStateInner,
	operation: &EditOperation,
	scheduled: &ScheduledEditOperation,
	default_selector: Option<&str>,
	default_crc: Option<&str>,
	requires_checksum: bool,
	touched_paths: &[String],
	warnings: &mut Vec<String>,
) -> Result<ResolvedEditTarget, String> {
	let selector = operation.sel.as_deref().or(default_selector);
	let crc = operation.crc.as_deref().or_else(|| {
		if operation.sel.is_none() {
			default_crc
		} else {
			None
		}
	});
	let ParsedSelector { selector: cleaned_selector, crc: cleaned_crc, region: parsed_region } =
		split_selector_crc_and_region(selector, crc, operation.region)?;
	let batch_auto_accepted =
		ensure_batch_operation_target_current(scheduled, cleaned_crc.as_deref(), touched_paths);
	let resolve_crc = if batch_auto_accepted {
		None
	} else {
		cleaned_crc.as_deref()
	};
	let resolved =
		resolve_chunk_with_crc(state, cleaned_selector.as_deref(), resolve_crc, warnings)?;
	let mut region = operation.region.or(parsed_region);
	if !batch_auto_accepted {
		validate_batch_crc(resolved.chunk, resolved.crc.as_deref(), requires_checksum)?;
	}
	let chunk = resolved.chunk.clone();
	if chunk.prologue_end_byte.is_none() || chunk.epilogue_start_byte.is_none() {
		// @decl only depends on checksum_start_byte, not prologue/epilogue.
		if region != Some(ChunkRegion::Decl) {
			region = None;
		}
	}

	Ok(ResolvedEditTarget { chunk, region })
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
	let target = resolve_edit_target(
		state,
		operation,
		scheduled,
		default_selector,
		default_crc,
		true,
		touched_paths.as_slice(),
		warnings,
	)?;
	let anchor = target.chunk;
	let (region_start, region_end) = match target.region {
		None => (anchor.start_byte as usize, anchor.end_byte as usize),
		Some(r) => chunk_region_range(&anchor, r),
	};

	// Scoped find/replace: locate a literal substring inside the chunk and replace
	// it.
	if let Some(find) = operation.find.as_deref() {
		if find.is_empty() {
			return Err(format!(
				"find/replace on {}: 'find' cannot be empty. Omit 'find' for whole-chunk replace.",
				describe_scheduled_operation(scheduled)
			));
		}

		let chunk_source = &state.source[region_start..region_end];
		let mut matches = chunk_source.match_indices(find);
		let Some((rel_offset, _)) = matches.next() else {
			return Err(format!(
				"find/replace on {}: 'find' text not found inside chunk. Re-read the file to confirm \
				 current content, or use whole-chunk replace.",
				anchor.path
			));
		};
		if matches.next().is_some() {
			let total = 2 + chunk_source.match_indices(find).skip(2).count();
			return Err(format!(
				"find/replace on {}: 'find' is ambiguous ({} matches in chunk). Extend 'find' with \
				 surrounding context so exactly one match remains, or use whole-chunk replace.",
				anchor.path, total
			));
		}

		let replacement = operation.content.as_deref().unwrap_or_default();
		let abs_start = region_start + rel_offset;
		let abs_end = abs_start + find.len();
		let mut new_source =
			String::with_capacity(state.source.len() - find.len() + replacement.len());
		new_source.push_str(&state.source[..abs_start]);
		new_source.push_str(replacement);
		new_source.push_str(&state.source[abs_end..]);
		state.source = new_source;
		touched_paths.push(anchor.path);
		return Ok(());
	}

	let target_indent =
		target_indent_for_region(state, &anchor, target.region, file_indent_char, file_indent_step);
	let content = operation.content.as_deref().unwrap_or_default();
	let mut replacement =
		normalize_inserted_content(content, &target_indent, Some(file_indent_step), file_indent_char);
	if target.region.is_none() {
		if !replacement.is_empty()
			&& !replacement.ends_with('\n')
			&& anchor.end_line < state.tree.line_count
		{
			replacement.push('\n');
		}
		// If the chunk's range included a trailing blank line (common in
		// markdown lists/paragraphs), preserve it so the replacement doesn't
		// collapse into the next structural element.
		let offsets = line_offsets(&state.source);
		let last_line_text = state
			.source
			.split('\n')
			.nth(anchor.end_line.saturating_sub(1) as usize)
			.unwrap_or("");
		if last_line_text.trim().is_empty()
			&& !replacement.is_empty()
			&& !replacement.ends_with("\n\n")
		{
			if !replacement.ends_with('\n') {
				replacement.push('\n');
			}
			replacement.push('\n');
		}
		let range_start = line_start_offset(&offsets, anchor.start_line, &state.source);
		state.source =
			replace_range_by_lines(&state.source, anchor.start_line, anchor.end_line, &replacement);
		if replacement.is_empty() {
			state.source = cleanup_blank_line_artifacts_at_offset(&state.source, range_start);
		}
	} else {
		// For prologue/epilogue replacements, ensure the replacement preserves
		// the newline boundary so the body content isn't joined onto the same
		// line as the replacement.
		if matches!(target.region, Some(ChunkRegion::Head | ChunkRegion::Tail | ChunkRegion::Decl))
			&& !replacement.is_empty()
			&& !replacement.ends_with('\n')
			&& state.source.as_bytes().get(region_end.saturating_sub(1)) == Some(&b'\n')
		{
			replacement.push('\n');
		}
		state.source = replace_byte_range(&state.source, region_start, region_end, &replacement);
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
	let target = resolve_edit_target(
		state,
		operation,
		scheduled,
		default_selector,
		default_crc,
		true,
		touched_paths.as_slice(),
		warnings,
	)?;
	let anchor = target.chunk;

	if let Some(r) = target.region {
		let (range_start, range_end) = chunk_region_range(&anchor, r);
		state.source = replace_byte_range(&state.source, range_start, range_end, "");
	} else {
		let offsets = line_offsets(&state.source);
		let range_start = line_start_offset(&offsets, anchor.start_line, &state.source);
		state.source = replace_range_by_lines(&state.source, anchor.start_line, anchor.end_line, "");
		state.source = cleanup_blank_line_artifacts_at_offset(&state.source, range_start);
	}
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
	let target = resolve_edit_target(
		state,
		operation,
		scheduled,
		default_selector,
		default_crc,
		false,
		touched_paths.as_slice(),
		warnings,
	)?;
	let anchor = target.chunk;
	let (insertion, pos) = resolve_insertion_point(
		state,
		&anchor,
		target.region,
		operation.op,
		operation.content.as_deref(),
		file_indent_char,
		file_indent_step,
	)?;
	let suppress_chunk_adjacency =
		matches!(operation.op, ChunkEditOp::Prepend | ChunkEditOp::Append)
			&& !(matches!(operation.op, ChunkEditOp::Append)
				&& pos == InsertPosition::After
				&& owned_container_end_line(state, &anchor) > anchor.end_line);
	let spacing = compute_insert_spacing(state, &anchor, pos, suppress_chunk_adjacency);
	let content = operation.content.as_deref().unwrap_or_default();
	let mut replacement = normalize_inserted_content(
		content,
		&insertion.indent,
		Some(file_indent_step),
		file_indent_char,
	);
	replacement =
		normalize_insertion_boundary_content(state, insertion.offset, &replacement, spacing);

	if pos == InsertPosition::FirstChild {
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
				"Comment-only @body.prepend on root is not allowed when the file has a preamble \
				 chunk. Use replace on the preamble chunk instead."
					.to_owned(),
			);
		}
		if comment_only && !anchor.children.is_empty() {
			warnings.push(
				"Comment-only @body.prepend can merge into the following chunk's first line; it is \
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

fn rebuild_chunk_state(
	source: String,
	language: String,
	notebook: Option<crate::chunk::ast_ipynb::SharedNotebookContext>,
) -> Result<ChunkStateInner, String> {
	let tree = if let Some(ctx) = &notebook {
		crate::chunk::ast_ipynb::build_notebook_tree_from_virtual(
			source.as_str(),
			ctx.kernel_language.as_str(),
		)?
	} else {
		crate::chunk::build_chunk_tree(source.as_str(), language.as_str())
			.map_err(|err| err.to_string())?
	};
	let mut inner = ChunkStateInner::new(source, language, tree);
	inner.notebook = notebook;
	Ok(inner)
}

fn validate_batch_crc(chunk: &ChunkNode, crc: Option<&str>, required: bool) -> Result<(), String> {
	if !required {
		return Ok(());
	}
	validate_crc(chunk, crc)
}

fn validate_crc(chunk: &ChunkNode, crc: Option<&str>) -> Result<(), String> {
	let cleaned = sanitize_crc(crc).ok_or_else(|| {
		let selector = if chunk.path.is_empty() {
			format!("#{}", chunk.checksum)
		} else {
			format!("{}#{}", chunk.path, chunk.checksum)
		};
		format!(
			"Checksum required for {}. Re-read the chunk to get the current checksum, then include \
			 it in the selector. Hint: use target \"{}\" for container replacement, or append \
			 another region such as @body.",
			chunk_path_opt(chunk),
			selector
		)
	})?;
	if chunk.checksum != cleaned {
		return Err(format!(
			"Checksum mismatch for {}: expected \"{}\", got \"{}\". The chunk content has changed \
			 since you last read it. Use the fresh checksum from the context below to retry.",
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

fn replace_byte_range(source: &str, start: usize, end: usize, replacement: &str) -> String {
	let mut new_source = String::with_capacity(
		source
			.len()
			.saturating_sub(end.saturating_sub(start))
			.saturating_add(replacement.len()),
	);
	new_source.push_str(&source[..start]);
	new_source.push_str(replacement);
	new_source.push_str(&source[end..]);
	new_source
}

fn target_indent_for_region(
	state: &ChunkStateInner,
	anchor: &ChunkNode,
	region: Option<ChunkRegion>,
	file_indent_char: char,
	file_indent_step: usize,
) -> String {
	match region {
		None | Some(ChunkRegion::Head | ChunkRegion::Tail | ChunkRegion::Decl) => {
			anchor.indent_char.repeat(anchor.indent as usize)
		},
		Some(ChunkRegion::Body) => {
			compute_insert_indent(state, anchor, true, file_indent_char, file_indent_step)
		},
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
	normalized = normalized
		.split('\n')
		.map(|line| denormalize_from_tabs(line, file_indent_char, file_indent_step.unwrap_or(1)))
		.collect::<Vec<_>>()
		.join("\n");
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

const fn is_container_like_chunk(chunk: &ChunkNode) -> bool {
	let traits = chunk.kind.traits();
	!chunk.leaf
		|| traits.container
		|| traits.has_addressable_members
		|| traits.always_preserve_children
}

fn go_receiver_belongs_to_type(source: &str, chunk: &ChunkNode, type_name: &str) -> bool {
	let header = source[chunk.start_byte as usize..chunk.end_byte as usize]
		.lines()
		.next()
		.unwrap_or_default()
		.trim_start();
	header.starts_with("func ")
		&& (header.contains(&format!(" {type_name})")) || header.contains(&format!("*{type_name})")))
}

fn owned_container_end_line(state: &ChunkStateInner, anchor: &ChunkNode) -> u32 {
	if state.language != "go" || anchor.kind != ChunkKind::Type {
		return anchor.end_line;
	}

	let type_name = anchor
		.identifier
		.as_deref()
		.unwrap_or_else(|| anchor.kind.prefix());
	let mut owned_end_line = anchor.end_line;
	let mut top_level_chunks = state
		.tree
		.chunks
		.iter()
		.filter(|chunk| chunk.parent_path.as_deref() == Some(""))
		.collect::<Vec<_>>();
	top_level_chunks.sort_by_key(|chunk| chunk.start_line);

	let Some(start_index) = top_level_chunks
		.iter()
		.position(|chunk| chunk.path == anchor.path)
	else {
		return anchor.end_line;
	};

	for chunk in top_level_chunks.into_iter().skip(start_index + 1) {
		if chunk.start_line < owned_end_line {
			continue;
		}
		if chunk.kind == ChunkKind::Function
			&& go_receiver_belongs_to_type(&state.source, chunk, type_name)
		{
			owned_end_line = chunk.end_line;
			continue;
		}
		break;
	}

	owned_end_line
}

fn before_chunk_insertion_point(state: &ChunkStateInner, anchor: &ChunkNode) -> InsertionPoint {
	if anchor.path.is_empty() {
		return InsertionPoint { offset: 0, indent: String::new() };
	}
	let offsets = line_offsets(&state.source);
	InsertionPoint {
		offset: line_start_offset(&offsets, anchor.start_line, &state.source),
		indent: anchor.indent_char.repeat(anchor.indent as usize),
	}
}

fn after_chunk_insertion_point(state: &ChunkStateInner, anchor: &ChunkNode) -> InsertionPoint {
	if anchor.path.is_empty() {
		return InsertionPoint { offset: state.source.len(), indent: String::new() };
	}
	let offsets = line_offsets(&state.source);
	let end_line = owned_container_end_line(state, anchor);
	InsertionPoint {
		offset: line_end_offset(&offsets, end_line, &state.source),
		indent: anchor.indent_char.repeat(anchor.indent as usize),
	}
}

fn body_insertion_point(
	state: &ChunkStateInner,
	anchor: &ChunkNode,
	at_end: bool,
	file_indent_char: char,
	file_indent_step: usize,
) -> InsertionPoint {
	let offsets = line_offsets(&state.source);
	let indent = compute_insert_indent(state, anchor, true, file_indent_char, file_indent_step);
	if at_end {
		if let Some(last_child_path) = anchor.children.last()
			&& let Some(last_child) = state
				.tree
				.chunks
				.iter()
				.find(|chunk| &chunk.path == last_child_path)
		{
			let child_indent = if last_child.indent_char.is_empty() {
				indent
			} else {
				last_child.indent_char.repeat(last_child.indent as usize)
			};
			return InsertionPoint {
				offset: line_end_offset(&offsets, last_child.end_line, &state.source),
				indent: child_indent,
			};
		}
		let (_, body_end) = chunk_region_range(anchor, ChunkRegion::Body);
		return InsertionPoint { offset: body_end, indent };
	}

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
	let (body_start, _) = chunk_region_range(anchor, ChunkRegion::Body);
	InsertionPoint { offset: body_start, indent }
}

fn resolve_insertion_point(
	state: &ChunkStateInner,
	anchor: &ChunkNode,
	region: Option<ChunkRegion>,
	op: ChunkEditOp,
	_file_content: Option<&str>,
	file_indent_char: char,
	file_indent_step: usize,
) -> Result<(InsertionPoint, InsertPosition), String> {
	match (region, op) {
		// Before chunk boundary
		(
			None | Some(ChunkRegion::Head | ChunkRegion::Decl),
			ChunkEditOp::Before | ChunkEditOp::Prepend,
		) => Ok((before_chunk_insertion_point(state, anchor), InsertPosition::Before)),
		// After chunk boundary
		(
			None | Some(ChunkRegion::Tail | ChunkRegion::Decl),
			ChunkEditOp::After | ChunkEditOp::Append,
		) => Ok((after_chunk_insertion_point(state, anchor), InsertPosition::After)),
		// Inner first-child position
		(Some(ChunkRegion::Body), ChunkEditOp::Before | ChunkEditOp::Prepend)
		| (Some(ChunkRegion::Head), ChunkEditOp::After | ChunkEditOp::Append) => Ok((
			body_insertion_point(state, anchor, false, file_indent_char, file_indent_step),
			InsertPosition::FirstChild,
		)),
		// Inner last-child position
		(Some(ChunkRegion::Body), ChunkEditOp::After | ChunkEditOp::Append)
		| (Some(ChunkRegion::Tail), ChunkEditOp::Before | ChunkEditOp::Prepend) => Ok((
			body_insertion_point(state, anchor, true, file_indent_char, file_indent_step),
			InsertPosition::LastChild,
		)),
		(_, ChunkEditOp::Replace | ChunkEditOp::Delete) => {
			Err("Internal error: insertion point requested for non-insert op".to_owned())
		},
	}
}

fn indent_prefix_for_level(
	anchor: &ChunkNode,
	file_indent_char: char,
	file_indent_step: usize,
	extra_levels: usize,
) -> String {
	let step = file_indent_step.max(1);
	let indent_char = if matches!(file_indent_char, ' ' | '\t') {
		file_indent_char
	} else {
		anchor.indent_char.chars().next().unwrap_or(' ')
	};
	if indent_char == '\t' {
		return "\t".repeat(anchor.indent as usize + extra_levels);
	}
	let indent_levels = (anchor.indent as usize / step).saturating_add(extra_levels);
	" ".repeat(step * indent_levels)
}

fn compute_insert_indent(
	state: &ChunkStateInner,
	anchor: &ChunkNode,
	inside: bool,
	file_indent_char: char,
	file_indent_step: usize,
) -> String {
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
		file_indent_char.to_string()
	} else {
		anchor.indent_char.clone()
	};
	if indent_char == "\t" {
		"\t".repeat(anchor.indent as usize + 1)
	} else {
		indent_prefix_for_level(anchor, file_indent_char, file_indent_step, 1)
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

fn visible_child_chunks<'a>(
	state: &'a ChunkStateInner,
	anchor: &'a ChunkNode,
) -> Vec<&'a ChunkNode> {
	anchor
		.children
		.iter()
		.filter_map(|child_path| {
			state
				.tree
				.chunks
				.iter()
				.find(|chunk| chunk.path == *child_path)
		})
		.filter(|child| child.kind != ChunkKind::Chunk)
		.collect()
}

fn sibling_gap_has_blank_line(
	state: &ChunkStateInner,
	left: &ChunkNode,
	right: &ChunkNode,
) -> bool {
	right.start_line > owned_container_end_line(state, left) + 1
}

/// Returns true if a container's children should be separated by blank lines.
/// Root-level children (functions, classes) and containers with non-leaf
/// children (methods) want blank line spacing. Containers whose children are
/// all packed declarations (struct fields, enum variants) are tightly packed.
fn children_want_blank_line_spacing(state: &ChunkStateInner, anchor: &ChunkNode) -> bool {
	if anchor.path.is_empty() {
		let root_children = visible_child_chunks(state, anchor);
		if root_children.len() >= 2 {
			return root_children
				.windows(2)
				.any(|pair| sibling_gap_has_blank_line(state, pair[0], pair[1]));
		}
		return true;
	}
	if anchor.children.is_empty() {
		return true;
	}

	let visible_children = visible_child_chunks(state, anchor);
	if visible_children.is_empty() {
		return true;
	}
	if visible_children.len() >= 2 {
		return visible_children
			.windows(2)
			.any(|pair| sibling_gap_has_blank_line(state, pair[0], pair[1]));
	}

	let all_packed = visible_children
		.iter()
		.all(|child| child.kind.traits().packed);
	!all_packed
}

/// Returns true if sibling insertions around `anchor` should have blank line
/// spacing. Checks whether the anchor's parent container uses spaced or packed
/// layout.
fn is_spaced_sibling(state: &ChunkStateInner, anchor: &ChunkNode) -> bool {
	let parent_path = anchor.parent_path.as_deref().unwrap_or("");
	if let Some(parent) = state.tree.chunks.iter().find(|c| c.path == parent_path) {
		children_want_blank_line_spacing(state, parent)
	} else {
		true // Default to spaced if parent not found
	}
}

fn compute_insert_spacing(
	state: &ChunkStateInner,
	anchor: &ChunkNode,
	pos: InsertPosition,
	is_prepend_or_append: bool,
) -> InsertSpacing {
	let has_interior_content = container_has_interior_content(state, anchor);
	let markdown_block_spacing = state.language == "markdown";
	match pos {
		InsertPosition::FirstChild => {
			let spaced = markdown_block_spacing || children_want_blank_line_spacing(state, anchor);
			InsertSpacing {
				blank_line_before: false,
				blank_line_after:  spaced && (!anchor.children.is_empty() || has_interior_content),
			}
		},
		InsertPosition::LastChild => {
			let spaced = markdown_block_spacing || children_want_blank_line_spacing(state, anchor);
			InsertSpacing {
				blank_line_before: spaced && (!anchor.children.is_empty() || has_interior_content),
				blank_line_after:  markdown_block_spacing && has_sibling_after(state, anchor),
			}
		},
		InsertPosition::Before => {
			let spaced = markdown_block_spacing || is_spaced_sibling(state, anchor);
			InsertSpacing {
				blank_line_before: has_sibling_before(state, anchor) && spaced,
				// When the op is `prepend` (container.prepend), omit the trailing
				// blank line so the content stays adjacent to the chunk and gets
				// absorbed as leading trivia on tree rebuild.
				blank_line_after:  !is_prepend_or_append && spaced,
			}
		},
		InsertPosition::After => {
			let spaced = markdown_block_spacing || is_spaced_sibling(state, anchor);
			InsertSpacing {
				// When the op is `append` (container.append), omit the leading
				// blank line so the content stays adjacent to the chunk.
				blank_line_before: !is_prepend_or_append && spaced,
				blank_line_after:  has_sibling_after(state, anchor) && spaced,
			}
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
	header:    String,
	lines:     Vec<String>,
	new_start: u32,
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

		hunks.push(DiffHunk { header, lines: hunk_lines, new_start: new_start as u32 });
	}

	hunks
}

/// Render the response text for a changed file, combining the current chunked
/// tree view with inline diff hunks placed inside the owning chunk blocks.
fn render_changed_hunks(
	state: &ChunkStateInner,
	display_path: &str,
	before: &str,
	after: &str,
	anchor_style: Option<ChunkAnchorStyle>,
	touched_paths: &[String],
) -> String {
	use std::collections::HashMap;

	let show_leaf_preview = state.language == "tlaplus";
	let focused_paths = compute_focus(state.tree(), touched_paths);
	let hunks = generate_diff_hunks(before, after, 0);

	// Map each hunk to the chunk that should display it.
	// Walk from the deepest containing chunk upward until we find one that
	// has children (and therefore a closing tag in the tree output).
	let tree = state.tree();
	let tab_replacement = "    ";
	let file_indent_char = detect_file_indent_char(state.source(), tree);
	let file_indent_step = detect_file_indent_step(tree) as usize;
	let lookup: HashMap<&str, &ChunkNode> =
		tree.chunks.iter().map(|c| (c.path.as_str(), c)).collect();

	let mut inline_hunks: HashMap<String, Vec<crate::chunk::render::InlineHunk>> = HashMap::new();
	let mut orphan_hunks: Vec<&DiffHunk> = Vec::new();

	for hunk in &hunks {
		// Find the deepest chunk containing this hunk's new-file start line.
		let owner = crate::chunk::render::find_hunk_owner_chunk(tree, &lookup, hunk.new_start);
		match owner {
			Some(chunk_path) => {
				let indent = crate::chunk::render::hunk_indent_for_chunk(
					&lookup,
					chunk_path,
					state.source(),
					tab_replacement,
					Some((file_indent_char, file_indent_step)),
				);
				let mut lines = Vec::with_capacity(hunk.lines.len() + 1);
				lines.push(format!("{indent}{}", hunk.header));
				for line in &hunk.lines {
					lines.push(format!("{indent}{line}"));
				}
				inline_hunks
					.entry(chunk_path.to_owned())
					.or_default()
					.push(crate::chunk::render::InlineHunk { lines });
			},
			None => orphan_hunks.push(hunk),
		}
	}

	let tree_text = crate::chunk::render::render_state_with_hunks(
		state,
		&RenderParams {
			chunk_path: Some(String::new()),
			title: display_path.to_owned(),
			language_tag: Some(state.language.clone()),
			visible_range: None,
			render_children_only: true,
			omit_checksum: false,
			anchor_style,
			show_leaf_preview,
			tab_replacement: Some(tab_replacement.to_owned()),
			normalize_indent: Some(true),
			focused_paths,
		},
		inline_hunks,
	);

	if orphan_hunks.is_empty() {
		return tree_text;
	}

	// Append orphan hunks (not belonging to any named chunk) at the end.
	let orphan_text = orphan_hunks
		.iter()
		.flat_map(|hunk| {
			let mut lines = Vec::with_capacity(hunk.lines.len() + 1);
			lines.push(hunk.header.clone());
			lines.extend(hunk.lines.iter().cloned());
			lines
		})
		.collect::<Vec<_>>()
		.join("\n");

	format!("{tree_text}\n\n{orphan_text}")
}

/// Build a focus list that includes touched chunks as Expanded, their
/// immediate siblings as Collapsed, and all ancestors as Container.
/// Falls back to no focus (full render) when more than 20 chunks were touched.
fn compute_focus(
	tree: &crate::chunk::types::ChunkTree,
	touched: &[String],
) -> Option<Vec<FocusedPath>> {
	use std::collections::HashMap;

	if touched.is_empty() || touched.len() > 20 {
		return None;
	}

	let lookup: HashMap<&str, &ChunkNode> =
		tree.chunks.iter().map(|c| (c.path.as_str(), c)).collect();
	let mut focus: HashMap<String, ChunkFocusMode> = HashMap::new();

	for path in touched {
		let Some(chunk) = lookup.get(path.as_str()) else {
			continue;
		};
		focus.insert(path.clone(), ChunkFocusMode::Expanded);

		// Ancestors -> Container (don't downgrade Expanded).
		let mut current = chunk.parent_path.as_deref();
		while let Some(parent_path) = current {
			focus
				.entry(parent_path.to_string())
				.or_insert(ChunkFocusMode::Container);
			current = lookup
				.get(parent_path)
				.and_then(|p| p.parent_path.as_deref());
		}

		// Immediate prev/next sibling -> Collapsed.
		if let Some(parent_path) = chunk.parent_path.as_deref()
			&& let Some(parent) = lookup.get(parent_path)
			&& let Some(idx) = parent.children.iter().position(|p| p == path)
		{
			if idx > 0 {
				focus
					.entry(parent.children[idx - 1].clone())
					.or_insert(ChunkFocusMode::Collapsed);
			}
			if idx + 1 < parent.children.len() {
				focus
					.entry(parent.children[idx + 1].clone())
					.or_insert(ChunkFocusMode::Collapsed);
			}
		}
	}

	// Root chunk must always be Container so the walk starts.
	focus
		.entry(String::new())
		.or_insert(ChunkFocusMode::Container);

	Some(
		focus
			.into_iter()
			.map(|(path, mode)| FocusedPath { path, mode })
			.collect(),
	)
}

/// Render a focused chunk view to append to error messages. Resolves the
/// selector ignoring CRC so the agent sees fresh anchors without a re-read.
fn render_error_context(
	state: &ChunkStateInner,
	selector: Option<&str>,
	display_path: &str,
	anchor_style: Option<ChunkAnchorStyle>,
) -> String {
	let Ok(ParsedSelector { selector: clean_path, .. }) =
		split_selector_crc_and_region(selector, None, None)
	else {
		return String::new();
	};
	let mut ignored = Vec::new();
	let Ok(chunk) = resolve_chunk_selector(state, clean_path.as_deref(), &mut ignored) else {
		return String::new();
	};
	let focused_paths = compute_focus(state.tree(), std::slice::from_ref(&chunk.path));
	let rendered = crate::chunk::render::render_state(state, &RenderParams {
		chunk_path: Some(String::new()),
		title: display_path.to_owned(),
		language_tag: Some(state.language.clone()),
		visible_range: None,
		render_children_only: true,
		omit_checksum: false,
		anchor_style,
		show_leaf_preview: true,
		tab_replacement: Some("    ".to_owned()),
		normalize_indent: Some(true),
		focused_paths,
	});
	format!("\n\nFresh content:\n{rendered}")
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
		focused_paths: None,
		show_leaf_preview: true,
		tab_replacement: Some("    ".to_owned()),
		normalize_indent: Some(true),
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

	fn apply_single_edit(
		state: &ChunkState,
		file_path: &str,
		operation: EditOperation,
	) -> EditResult {
		apply_edits(state, &EditParams {
			operations:       vec![operation],
			default_selector: None,
			default_crc:      None,
			anchor_style:     None,
			cwd:              ".".to_owned(),
			file_path:        file_path.to_owned(),
		})
		.expect("edit should apply")
	}

	#[test]
	fn root_level_replace_preserves_space_indentation() {
		let source = "fn main() {\n    println!(\"old\");\n}\n";
		let state = state_for(source, "rust");
		let chunk = state.inner().chunk("fn_main").expect("fn_main");

		let result = apply_edits(&state, &EditParams {
			operations:       vec![EditOperation {
				op:      ChunkEditOp::Replace,
				sel:     Some("fn_main".to_owned()),
				crc:     Some(chunk.checksum.clone()),
				region:  None,
				content: Some("fn main() {\n        println!(\"new\");\n}".to_owned()),
				find:    None,
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

	#[test]
	fn whole_chunk_replace_does_not_duplicate_attributes() {
		let source = "#[napi]\nfn close() {\n    old();\n}\n";
		let state = state_for(source, "rust");
		let chunk = state.inner().chunk("fn_close").expect("fn_close");
		// The chunk range should include the #[napi] attribute.
		assert_eq!(chunk.start_line, 1, "chunk should start at the attribute line");

		let result = apply_single_edit(&state, "test.rs", EditOperation {
			op:      ChunkEditOp::Replace,
			sel:     Some("fn_close".to_owned()),
			crc:     Some(chunk.checksum.clone()),
			region:  None,
			content: Some("/// doc\n#[napi]\nfn close() {\n    new();\n}".to_owned()),
			find:    None,
		});

		let occurrences = result.diff_after.matches("#[napi]").count();
		assert_eq!(
			occurrences, 1,
			"expected exactly one #[napi] attribute, got {occurrences}. Full text:\n{}",
			result.diff_after
		);
		assert!(result.diff_after.contains("new()"), "replacement body should be present");
	}

	#[test]
	fn edit_auto_resolves_unique_chunk_paths() {
		let source = "class Worker {\n\trun(): void {\n\t\tconsole.log(this.name);\n\t}\n}\n";
		let state = state_for(source, "typescript");
		let chunk = state
			.inner()
			.chunk("class_Worker.fn_run")
			.expect("class_Worker.fn_run should exist");

		let result = apply_edits(&state, &EditParams {
			operations:       vec![EditOperation {
				op:      ChunkEditOp::Replace,
				sel:     Some("run".to_owned()),
				crc:     Some(chunk.checksum.clone()),
				region:  None,
				content: Some("run(): void {\n\tconsole.log(\"resolved\");\n}".to_owned()),
				find:    None,
			}],
			default_selector: None,
			default_crc:      None,
			anchor_style:     None,
			cwd:              ".".to_owned(),
			file_path:        "test.ts".to_owned(),
		})
		.expect("edit should resolve a unique fuzzy selector");

		assert!(
			result.diff_after.contains("console.log(\"resolved\");"),
			"expected updated body text, got {:?}",
			result.diff_after
		);
		assert!(
			result.warnings.iter().any(|warning| warning
				.contains("Auto-resolved chunk selector \"run\" to \"class_Worker.fn_run#")),
			"expected auto-resolution warning, got {:?}",
			result.warnings
		);
	}

	#[test]
	fn edit_auto_resolves_prefixed_function_names() {
		let source = "function fuzzyMatch(): void {\n\tconsole.log(\"old\");\n}\n";
		let state = state_for(source, "typescript");
		let chunk = state
			.inner()
			.chunk("fn_fuzzyMatch")
			.expect("fn_fuzzyMatch should exist");

		let result = apply_edits(&state, &EditParams {
			operations:       vec![EditOperation {
				op:      ChunkEditOp::Replace,
				sel:     Some("fuzzyMatch".to_owned()),
				crc:     Some(chunk.checksum.clone()),
				region:  None,
				content: Some(
					"function fuzzyMatch(): void {\n\tconsole.log(\"resolved\");\n}".to_owned(),
				),
				find:    None,
			}],
			default_selector: None,
			default_crc:      None,
			anchor_style:     None,
			cwd:              ".".to_owned(),
			file_path:        "box.ts".to_owned(),
		})
		.expect("edit should resolve a prefixed bare selector");

		assert!(result.diff_after.contains("console.log(\"resolved\");"), "{}", result.diff_after);
		assert!(result.warnings.iter().any(|warning| {
			warning.contains("Auto-resolved chunk selector \"fuzzyMatch\" to \"fn_fuzzyMatch#")
		}));
	}

	#[test]
	fn edit_accepts_file_prefixed_checksum_targets() {
		let source = "function main(): void {\n\tconsole.log(\"old\");\n}\n";
		let state = state_for(source, "typescript");
		let chunk = state
			.inner()
			.chunk("fn_main")
			.expect("fn_main should exist");

		let result = apply_edits(&state, &EditParams {
			operations:       vec![EditOperation {
				op:      ChunkEditOp::Replace,
				sel:     Some("box.ts".to_owned()),
				crc:     Some(chunk.checksum.clone()),
				region:  None,
				content: Some("function main(): void {\n\tconsole.log(\"normalized\");\n}".to_owned()),
				find:    None,
			}],
			default_selector: None,
			default_crc:      None,
			anchor_style:     None,
			cwd:              ".".to_owned(),
			file_path:        "box.ts".to_owned(),
		})
		.expect("edit should resolve file-prefixed checksum target");

		assert!(result.diff_after.contains("console.log(\"normalized\");"), "{}", result.diff_after);
	}

	#[test]
	fn line_number_selector_auto_resolves_to_containing_chunk() {
		let source = "function main(): void {\n\tconsole.log(\"old\");\n}\n";
		let state = state_for(source, "typescript");
		let chunk = state.inner().chunk("fn_main").expect("fn_main");

		// L2 falls inside fn_main — should auto-resolve and apply the edit.
		let result = apply_edits(&state, &EditParams {
			operations:       vec![EditOperation {
				op:      ChunkEditOp::Replace,
				sel:     Some(format!("L2#{}", chunk.checksum)),
				crc:     None,
				region:  None,
				content: Some("function main(): void {\n\tconsole.log(\"new\");\n}".to_owned()),
				find:    None,
			}],
			default_selector: None,
			default_crc:      None,
			anchor_style:     None,
			cwd:              ".".to_owned(),
			file_path:        "box.ts".to_owned(),
		});

		let result = result.expect("line-number selector should auto-resolve");
		assert!(
			result
				.warnings
				.iter()
				.any(|w| w.contains("Auto-resolved line target")),
			"should warn about auto-resolution: {:?}",
			result.warnings
		);
		assert!(
			result.diff_after.contains("\"new\""),
			"edit should have applied: {}",
			result.diff_after
		);
	}

	#[test]
	fn line_number_outside_any_chunk_returns_error() {
		let source = "function main(): void {\n\tconsole.log(\"old\");\n}\n";
		let state = state_for(source, "typescript");

		// L999 is way beyond the file — should fail.
		let result = apply_edits(&state, &EditParams {
			operations:       vec![EditOperation {
				op:      ChunkEditOp::Replace,
				sel:     Some("L999".to_owned()),
				crc:     None,
				region:  None,
				content: Some("// hello".to_owned()),
				find:    None,
			}],
			default_selector: None,
			default_crc:      None,
			anchor_style:     None,
			cwd:              ".".to_owned(),
			file_path:        "box.ts".to_owned(),
		});

		assert!(result.is_err(), "line outside any chunk should fail");
		let err = result.err().unwrap();
		assert!(err.contains("does not fall inside any chunk"), "{err}");
	}

	#[test]
	fn markdown_section_replace_preserves_next_sibling_heading() {
		let source = "# Top\n\n## Building\n\nOld content.\n\n## Code Style\n\n- style one\n";
		let state = state_for(source, "markdown");
		let chunk = state
			.inner()
			.chunk("section_Top.section_Building")
			.expect("section_Building");

		let result = apply_edits(&state, &EditParams {
			operations:       vec![EditOperation {
				op:      ChunkEditOp::Replace,
				sel:     Some("section_Top.section_Building".to_owned()),
				crc:     Some(chunk.checksum.clone()),
				region:  None,
				content: Some("## Building\n\nNew content.\n".to_owned()),
				find:    None,
			}],
			default_selector: None,
			default_crc:      None,
			anchor_style:     None,
			cwd:              ".".to_owned(),
			file_path:        "test.md".to_owned(),
		})
		.expect("replace should succeed");

		assert!(
			result.diff_after.contains("## Code Style"),
			"next sibling heading must survive section replace, got:\n{}",
			result.diff_after,
		);
		assert!(
			result.diff_after.contains("New content."),
			"replacement content must be present, got:\n{}",
			result.diff_after,
		);
	}

	#[test]
	fn find_replace_single_match() {
		let source = "fn main() {\n    println!(\"hello\");\n    println!(\"world\");\n}\n";
		let state = state_for(source, "rust");
		let chunk = state.inner().chunk("fn_main").expect("fn_main");

		let result = apply_edits(&state, &EditParams {
			operations:       vec![EditOperation {
				op:      ChunkEditOp::Replace,
				sel:     Some("fn_main".to_owned()),
				crc:     Some(chunk.checksum.clone()),
				region:  None,
				content: Some("warn!(\"hello\")".to_owned()),
				find:    Some("println!(\"hello\")".to_owned()),
			}],
			default_selector: None,
			default_crc:      None,
			anchor_style:     None,
			cwd:              ".".to_owned(),
			file_path:        "test.rs".to_owned(),
		})
		.expect("edit should apply");

		assert!(
			result.diff_after.contains("warn!(\"hello\")"),
			"expected replacement, got {:?}",
			result.diff_after
		);
		assert!(
			result.diff_after.contains("println!(\"world\")"),
			"non-matched line must survive, got {:?}",
			result.diff_after
		);
	}

	#[test]
	fn find_replace_not_found() {
		let source = "fn main() {\n    println!(\"hello\");\n}\n";
		let state = state_for(source, "rust");
		let chunk = state.inner().chunk("fn_main").expect("fn_main");

		let result = apply_edits(&state, &EditParams {
			operations:       vec![EditOperation {
				op:      ChunkEditOp::Replace,
				sel:     Some("fn_main".to_owned()),
				crc:     Some(chunk.checksum.clone()),
				region:  None,
				content: Some("replacement".to_owned()),
				find:    Some("nonexistent text".to_owned()),
			}],
			default_selector: None,
			default_crc:      None,
			anchor_style:     None,
			cwd:              ".".to_owned(),
			file_path:        "test.rs".to_owned(),
		});

		assert!(result.is_err(), "expected error for not-found find text");
		assert!(
			result
				.err()
				.expect("err")
				.contains("not found inside chunk"),
			"error should mention not found"
		);
	}

	#[test]
	fn find_replace_ambiguous() {
		let source = "fn main() {\n    let a = 1;\n    let b = 1;\n    let c = 1;\n}\n";
		let state = state_for(source, "rust");
		let chunk = state.inner().chunk("fn_main").expect("fn_main");

		let result = apply_edits(&state, &EditParams {
			operations:       vec![EditOperation {
				op:      ChunkEditOp::Replace,
				sel:     Some("fn_main".to_owned()),
				crc:     Some(chunk.checksum.clone()),
				region:  None,
				content: Some("2".to_owned()),
				find:    Some("= 1".to_owned()),
			}],
			default_selector: None,
			default_crc:      None,
			anchor_style:     None,
			cwd:              ".".to_owned(),
			file_path:        "test.rs".to_owned(),
		});

		assert!(result.is_err(), "expected error for ambiguous find text");
		let err = result.err().expect("err");
		assert!(err.contains("ambiguous"), "error should mention ambiguous: {err}");
		assert!(err.contains("3 matches"), "error should report count: {err}");
	}

	#[test]
	fn find_replace_empty_find_rejected() {
		let source = "fn main() {\n    println!(\"hello\");\n}\n";
		let state = state_for(source, "rust");
		let chunk = state.inner().chunk("fn_main").expect("fn_main");

		let result = apply_edits(&state, &EditParams {
			operations:       vec![EditOperation {
				op:      ChunkEditOp::Replace,
				sel:     Some("fn_main".to_owned()),
				crc:     Some(chunk.checksum.clone()),
				region:  None,
				content: Some("replacement".to_owned()),
				find:    Some(String::new()),
			}],
			default_selector: None,
			default_crc:      None,
			anchor_style:     None,
			cwd:              ".".to_owned(),
			file_path:        "test.rs".to_owned(),
		});

		assert!(result.is_err(), "expected error for empty find text");
		assert!(result.err().expect("err").contains("cannot be empty"), "error should mention empty");
	}

	#[test]
	fn find_replace_respects_chunk_bounds() {
		// 'hello' appears in fn_greet but NOT in fn_main. Searching fn_main should
		// fail.
		let source = "fn greet() {\n    println!(\"hello\");\n}\n\nfn main() {\n    greet();\n}\n";
		let state = state_for(source, "rust");
		let chunk = state.inner().chunk("fn_main").expect("fn_main");

		let result = apply_edits(&state, &EditParams {
			operations:       vec![EditOperation {
				op:      ChunkEditOp::Replace,
				sel:     Some("fn_main".to_owned()),
				crc:     Some(chunk.checksum.clone()),
				region:  None,
				content: Some("goodbye".to_owned()),
				find:    Some("hello".to_owned()),
			}],
			default_selector: None,
			default_crc:      None,
			anchor_style:     None,
			cwd:              ".".to_owned(),
			file_path:        "test.rs".to_owned(),
		});

		assert!(result.is_err(), "find outside target chunk should fail");
		assert!(
			result
				.err()
				.expect("err")
				.contains("not found inside chunk")
		);
	}

	#[test]
	fn focus_emits_only_touched_and_siblings() {
		let source = "const a = 1;\n\nconst b = 2;\n\nconst c = 3;\n\nconst d = 4;\n\nconst e = 5;\n";
		let state = state_for(source, "typescript");
		let chunk = state.inner().chunk("var_c").expect("var_c");

		let result = apply_edits(&state, &EditParams {
			operations:       vec![EditOperation {
				op:      ChunkEditOp::Replace,
				sel:     Some("var_c".to_owned()),
				crc:     Some(chunk.checksum.clone()),
				region:  None,
				content: Some("const c = 33;".to_owned()),
				find:    None,
			}],
			default_selector: None,
			default_crc:      None,
			anchor_style:     Some(ChunkAnchorStyle::Full),
			cwd:              ".".to_owned(),
			file_path:        "test.ts".to_owned(),
		})
		.expect("edit should apply");

		// Touched chunk and immediate siblings should appear; distant chunks should
		// not contribute their bodies.
		let response = &result.response_text;
		assert!(response.contains("var_b"), "prev sibling should appear: {response}");
		assert!(response.contains("var_c"), "touched chunk should appear: {response}");
		assert!(response.contains("var_d"), "next sibling should appear: {response}");
		assert!(
			!response.contains("const a"),
			"distant chunk var_a body should not appear: {response}"
		);
		assert!(
			!response.contains("const e"),
			"distant chunk var_e body should not appear: {response}"
		);
	}

	#[test]
	fn append_on_group_chunk_container_inserts_at_end() {
		// A file with only a `stmts` group chunk (e.g. a describe() call in a test
		// file). Appending to it should insert content at the end of the statement
		// list.
		let source = "import { describe } from \"bun:test\";\n\ndescribe(\"suite\", () => \
		              {\n\tit(\"a\", () => {});\n});\n";
		let state = state_for(source, "typescript");
		let stmts = state
			.inner()
			.tree
			.chunks
			.iter()
			.find(|c| {
				c.path
					.rsplit('.')
					.next()
					.is_some_and(|leaf| leaf.starts_with("stmts"))
			})
			.expect("stmts chunk should exist");
		assert!(stmts.group, "stmts chunk should be marked as group");

		let result = apply_single_edit(&state, "test.ts", EditOperation {
			op:      ChunkEditOp::Append,
			sel:     Some(stmts.path.clone()),
			crc:     None,
			region:  None,
			content: Some("\nit(\"b\", () => {});".to_owned()),
			find:    None,
		});

		assert!(
			result.diff_after.contains("it(\"b\""),
			"appended content should appear in output, got: {}",
			result.diff_after
		);
	}

	#[test]
	fn replace_body_preserves_typescript_closing_brace_indentation() {
		let source = "function main() {\n    work();\n}\n";
		let state = state_for(source, "typescript");
		let chunk = state.inner().chunk("fn_main").expect("fn_main");

		let result = apply_single_edit(&state, "test.ts", EditOperation {
			op:      ChunkEditOp::Replace,
			sel:     Some(format!("fn_main#{}@body", chunk.checksum)),
			crc:     None,
			region:  None,
			content: Some("\treturn next();\n".to_owned()),
			find:    None,
		});

		assert_eq!(result.diff_after, "function main() {\n    return next();\n}\n");
	}

	#[test]
	fn replace_body_preserves_rust_closing_brace_indentation() {
		let source = "fn main() {\n    println!(\"old\");\n}\n";
		let state = state_for(source, "rust");
		let chunk = state.inner().chunk("fn_main").expect("fn_main");

		let result = apply_single_edit(&state, "test.rs", EditOperation {
			op:      ChunkEditOp::Replace,
			sel:     Some(format!("fn_main#{}@body", chunk.checksum)),
			crc:     None,
			region:  None,
			content: Some("\tprintln!(\"new\");\n".to_owned()),
			find:    None,
		});

		assert_eq!(result.diff_after, "fn main() {\n    println!(\"new\");\n}\n");
	}

	#[test]
	fn replace_body_preserves_go_closing_brace_indentation() {
		let source = "func main() {\n    work()\n}\n";
		let state = state_for(source, "go");
		let chunk = state.inner().chunk("fn_main").expect("fn_main");

		let result = apply_single_edit(&state, "test.go", EditOperation {
			op:      ChunkEditOp::Replace,
			sel:     Some(format!("fn_main#{}@body", chunk.checksum)),
			crc:     None,
			region:  None,
			content: Some("\treturn\n".to_owned()),
			find:    None,
		});

		assert_eq!(result.diff_after, "func main() {\n    return\n}\n");
	}

	#[test]
	fn three_space_body_replace_denormalizes_tabs_back_to_file_style() {
		let source = "def run():\n   return 1\n";
		let state = state_for(source, "python");
		let chunk = state.inner().chunk("fn_run").expect("fn_run");

		let result = apply_single_edit(&state, "test.py", EditOperation {
			op:      ChunkEditOp::Replace,
			sel:     Some(format!("fn_run#{}@body", chunk.checksum)),
			crc:     None,
			region:  None,
			content: Some("\treturn 2\n".to_owned()),
			find:    None,
		});

		assert_eq!(result.diff_after, "def run():\n   return 2\n");
	}

	#[test]
	fn after_targets_chunk_directly_for_top_level_sibling_insertion() {
		let source = "function alpha(): void {\n\twork();\n}\n";
		let state = state_for(source, "typescript");

		let result = apply_single_edit(&state, "test.ts", EditOperation {
			op:      ChunkEditOp::After,
			sel:     Some("fn_alpha".to_owned()),
			crc:     None,
			region:  None,
			content: Some("function beta(): void {\n\twork();\n}\n".to_owned()),
			find:    None,
		});

		assert!(result.diff_after.contains("function alpha(): void"), "{}", result.diff_after);
		assert!(result.diff_after.contains("function beta(): void"), "{}", result.diff_after);
		assert!(
			result
				.diff_after
				.find("function alpha(): void")
				.expect("alpha")
				< result
					.diff_after
					.find("function beta(): void")
					.expect("beta")
		);
	}

	#[test]
	fn go_body_and_container_append_are_not_interchangeable() {
		let source = "package main\n\ntype Server struct {\n    Addr string\n}\n\nfunc (s *Server) \
		              Start() {\n    work()\n}\n";

		let body_state = state_for(source, "go");
		let body_result = apply_single_edit(&body_state, "test.go", EditOperation {
			op:      ChunkEditOp::Append,
			sel:     Some("type_Server@body".to_owned()),
			crc:     None,
			region:  None,
			content: Some("\tPort int\n".to_owned()),
			find:    None,
		});
		assert!(
			body_result
				.diff_after
				.contains("Addr string\n    Port int\n}"),
			"{}",
			body_result.diff_after
		);
		assert!(
			!body_result.diff_after.contains("func (s *Server) Port"),
			"{}",
			body_result.diff_after
		);

		let container_state = state_for(source, "go");
		let container_result = apply_single_edit(&container_state, "test.go", EditOperation {
			op:      ChunkEditOp::Append,
			sel:     Some("type_Server".to_owned()),
			crc:     None,
			region:  None,
			content: Some("func (s *Server) Stop() {\n\twork()\n}\n".to_owned()),
			find:    None,
		});
		assert!(
			container_result
				.diff_after
				.contains("func (s *Server) Start()"),
			"{}",
			container_result.diff_after
		);
		assert!(
			container_result
				.diff_after
				.contains("func (s *Server) Stop()"),
			"{}",
			container_result.diff_after
		);
		assert!(
			container_result
				.diff_after
				.find("func (s *Server) Start()")
				.expect("start")
				< container_result
					.diff_after
					.find("func (s *Server) Stop()")
					.expect("stop")
		);
	}

	#[test]
	fn go_type_container_append_after_receiver_methods_preserves_sibling_spacing() {
		let source = "package main\n\ntype Server struct {}\n\nfunc (s *Server) Start() {}\nfunc (s \
		              *Server) Stop() {}\n";
		let state = state_for(source, "go");

		let result = apply_single_edit(&state, "test.go", EditOperation {
			op:      ChunkEditOp::Append,
			sel:     Some("type_Server".to_owned()),
			crc:     None,
			region:  None,
			content: Some("func (s *Server) Restart() {}".to_owned()),
			find:    None,
		});

		assert!(
			result
				.diff_after
				.contains("func (s *Server) Stop() {}\n\nfunc (s *Server) Restart() {}"),
			"{}",
			result.diff_after
		);
	}

	#[test]
	fn packed_toml_table_after_inserts_stay_tightly_packed() {
		let source = "[dependencies]\nanyhow.workspace = true\nbytes.workspace = \
		              true\nserde.workspace = true\nsolar-interface.workspace = \
		              true\nparking_lot.workspace = true\nsolar-sema.workspace = \
		              true\ntokio.workspace = true\ntracing.workspace = true\n";
		let state = state_for(source, "toml");

		let result = apply_single_edit(&state, "Cargo.toml", EditOperation {
			op:      ChunkEditOp::After,
			sel:     Some("table_dependencies.key_parking_lot_workspace".to_owned()),
			crc:     None,
			region:  None,
			content: Some("rayon.workspace = true\n".to_owned()),
			find:    None,
		});

		assert!(
			result.diff_after.contains(
				"parking_lot.workspace = true\nrayon.workspace = true\nsolar-sema.workspace = true"
			),
			"{}",
			result.diff_after
		);
		assert!(
			!result
				.diff_after
				.contains("parking_lot.workspace = true\n\nrayon.workspace = true"),
			"{}",
			result.diff_after
		);
		assert!(
			!result
				.diff_after
				.contains("rayon.workspace = true\n\nsolar-sema.workspace = true"),
			"{}",
			result.diff_after
		);
	}

	#[test]
	fn packed_top_level_typescript_variables_stay_tightly_packed() {
		let source = "const a = 1;\nconst b = 2;\nconst c = 3;\n";
		let state = state_for(source, "typescript");

		let result = apply_single_edit(&state, "test.ts", EditOperation {
			op:      ChunkEditOp::After,
			sel:     Some("var_b".to_owned()),
			crc:     None,
			region:  None,
			content: Some("const bb = 22;\n".to_owned()),
			find:    None,
		});

		assert!(
			result
				.diff_after
				.contains("const b = 2;\nconst bb = 22;\nconst c = 3;"),
			"{}",
			result.diff_after
		);
		assert!(
			!result.diff_after.contains("const b = 2;\n\nconst bb = 22;"),
			"{}",
			result.diff_after
		);
		assert!(
			!result.diff_after.contains("const bb = 22;\n\nconst c = 3;"),
			"{}",
			result.diff_after
		);
	}

	#[test]
	fn crc_mismatch_error_includes_fresh_chunk_context() {
		let source = "class Foo {\n    bar() {\n        return 1;\n    }\n}\n";
		let state = state_for(source, "typescript");

		let result = apply_edits(&state, &EditParams {
			operations:       vec![EditOperation {
				op:      ChunkEditOp::Replace,
				sel:     Some("class_Foo.fn_bar#ZZZZ".to_owned()),
				crc:     None,
				region:  None,
				content: Some("baz() { return 2; }".to_owned()),
				find:    None,
			}],
			default_selector: None,
			default_crc:      None,
			anchor_style:     Some(ChunkAnchorStyle::Full),
			cwd:              ".".to_owned(),
			file_path:        "test.ts".to_owned(),
		});
		let err = result.err().expect("should fail with stale CRC");

		assert!(err.contains("Fresh content:"), "error should include fresh content: {err}");
		assert!(err.contains("fn_bar"), "error should show the chunk with fresh anchor: {err}");
		assert!(err.contains("class_Foo"), "error should show ancestor context: {err}");
	}

	#[test]
	fn prologue_replace_preserves_newline_before_body() {
		let source = "/// Old doc.\nfn main() {\n    work();\n}\n";
		let state = state_for(source, "rust");
		let chunk = state.inner().chunk("fn_main").expect("fn_main");

		let result = apply_single_edit(&state, "test.rs", EditOperation {
			op:      ChunkEditOp::Replace,
			sel:     Some(format!("fn_main#{}@head", chunk.checksum)),
			crc:     None,
			region:  None,
			content: Some("/// New doc.\nfn main() {".to_owned()),
			find:    None,
		});

		// The body should NOT be joined onto the prologue line.
		assert!(
			!result.diff_after.contains("{    work"),
			"prologue replace should not join body onto same line: {}",
			result.diff_after
		);
		assert_eq!(result.diff_after, "/// New doc.\nfn main() {\n    work();\n}\n",);
	}

	#[test]
	fn markdown_table_pipes_preserved_in_replace() {
		let new_table = "| Header A | Header B |\n| --- | --- |\n| cell A | cell B |\n";

		// Simulate what normalize_inserted_content does to table content.
		let result = super::normalize_inserted_content(new_table, "", None, ' ');

		assert!(result.contains("| Header A"), "table pipes should not be stripped: {result}");
	}

	#[test]
	fn container_prepend_creates_addressable_chunk() {
		// Prepending without a @region inserts before the chunk. After tree rebuild,
		// the inserted content should be addressable (either absorbed as trivia
		// or as a new preamble/chunk), not orphaned.
		let source = "const a = 1;\n\nstruct Config {\n    host: String,\n}\n";
		let state = state_for(source, "rust");

		let result = apply_single_edit(&state, "test.rs", EditOperation {
			op:      ChunkEditOp::Prepend,
			sel:     Some("struct_Config".to_owned()),
			crc:     None,
			region:  None,
			content: Some("// Config documentation\n".to_owned()),
			find:    None,
		});

		// The comment should exist in the output.
		assert!(
			result.diff_after.contains("// Config documentation"),
			"prepended content should be in the file: {}",
			result.diff_after
		);

		// Re-parse and check that every non-empty line is covered by some chunk.
		let new_state = state_for(&result.diff_after, "rust");
		let tree = new_state.inner().tree();
		let lines: Vec<&str> = result.diff_after.split('\n').collect();
		for (i, line) in lines.iter().enumerate() {
			if line.trim().is_empty() {
				continue;
			}
			let line_num = (i + 1) as u32;
			let covered = tree
				.chunks
				.iter()
				.any(|c| !c.path.is_empty() && c.start_line <= line_num && c.end_line >= line_num);
			assert!(
				covered,
				"line {} ({:?}) should be covered by a chunk, but isn't. Chunks: {:?}",
				line_num,
				line,
				tree
					.chunks
					.iter()
					.filter(|c| !c.path.is_empty())
					.map(|c| format!("{}:L{}-L{}", c.path, c.start_line, c.end_line))
					.collect::<Vec<_>>()
			);
		}
	}

	#[test]
	fn leaf_chunk_supports_body_region_read() {
		// A small method (under LEAF_THRESHOLD) should still have region boundaries
		// if it has a body delimiter.
		let source = "class Foo {\n    bar() {\n        return 1;\n    }\n}\n";
		let state = state_for(source, "typescript");
		let fn_bar = state.inner().chunk("class_Foo.fn_bar").expect("fn_bar");
		assert!(fn_bar.leaf, "fn_bar should be a leaf chunk");
		assert!(fn_bar.prologue_end_byte.is_some(), "leaf fn_bar should have prologue_end_byte set");
		assert!(
			fn_bar.epilogue_start_byte.is_some(),
			"leaf fn_bar should have epilogue_start_byte set"
		);
	}

	#[test]
	fn nested_body_replace_preserves_correct_indentation_4space() {
		// 4-space file: method body at 2 levels of indent.
		let source = "class Server {\n    start() {\n        work();\n    }\n}\n";
		let state = state_for(source, "typescript");
		let chunk = state
			.inner()
			.chunk("class_Server.fn_start")
			.expect("fn_start");

		let result = apply_single_edit(&state, "test.ts", EditOperation {
			op:      ChunkEditOp::Replace,
			sel:     Some(format!("class_Server.fn_start#{}@body", chunk.checksum)),
			crc:     None,
			region:  None,
			content: Some("\treturn 42;\n".to_owned()),
			find:    None,
		});

		assert_eq!(
			result.diff_after, "class Server {\n    start() {\n        return 42;\n    }\n}\n",
			"4-space: nested body replace should produce correct 2-level indent"
		);
	}

	#[test]
	fn nested_body_replace_preserves_correct_indentation_2space() {
		// 2-space file: method body at 2 levels of indent.
		let source = "class Server {\n  start() {\n    work();\n  }\n}\n";
		let state = state_for(source, "typescript");
		let chunk = state
			.inner()
			.chunk("class_Server.fn_start")
			.expect("fn_start");

		let result = apply_single_edit(&state, "test.ts", EditOperation {
			op:      ChunkEditOp::Replace,
			sel:     Some(format!("class_Server.fn_start#{}@body", chunk.checksum)),
			crc:     None,
			region:  None,
			content: Some("\treturn 42;\n".to_owned()),
			find:    None,
		});

		assert_eq!(
			result.diff_after, "class Server {\n  start() {\n    return 42;\n  }\n}\n",
			"2-space: nested body replace should produce correct 2-level indent"
		);
	}

	#[test]
	fn nested_body_replace_with_excess_tabs_corrected() {
		// Agent accidentally includes base padding (2 tabs instead of 1).
		// Correction mechanism should strip common indent and produce correct output.
		let source = "class Server {\n  start() {\n    work();\n  }\n}\n";
		let state = state_for(source, "typescript");
		let chunk = state
			.inner()
			.chunk("class_Server.fn_start")
			.expect("fn_start");

		let result = apply_single_edit(&state, "test.ts", EditOperation {
			op:      ChunkEditOp::Replace,
			sel:     Some(format!("class_Server.fn_start#{}@body", chunk.checksum)),
			crc:     None,
			region:  None,
			content: Some("\t\tif (x) {\n\t\t\ty();\n\t\t}\n".to_owned()),
			find:    None,
		});

		assert_eq!(
			result.diff_after,
			"class Server {\n  start() {\n    if (x) {\n      y();\n    }\n  }\n}\n",
			"2-space: excess tabs should be corrected via dedent"
		);
	}

	#[test]
	fn body_append_inserts_inside_class() {
		// Appending to @body of a class should insert inside the body,
		// not after the closing brace.
		let source = "class Foo {\n    bar() {\n        return 1;\n    }\n}\n";
		let state = state_for(source, "typescript");

		let result = apply_single_edit(&state, "test.ts", EditOperation {
			op:      ChunkEditOp::Append,
			sel:     Some("class_Foo@body".to_owned()),
			crc:     None,
			region:  None,
			content: Some("baz() {\n\treturn 2;\n}\n".to_owned()),
			find:    None,
		});

		assert!(
			result.diff_after.contains("baz()"),
			"appended method should appear: {}",
			result.diff_after
		);
		// baz should appear BEFORE the final closing brace
		let baz_pos = result.diff_after.find("baz()").unwrap();
		let last_brace = result.diff_after.rfind('}').unwrap();
		assert!(
			baz_pos < last_brace,
			"baz() at {baz_pos} should be before last '}}' at {last_brace}: {}",
			result.diff_after
		);
	}

	#[test]
	fn body_prepend_inserts_after_opening_brace() {
		// Prepending to @body of an enum should insert after the opening brace,
		// not before doc comments.
		let source = "/** My enum. */\nenum Color {\n    Red,\n    Green,\n    Blue,\n}\n";
		let state = state_for(source, "typescript");

		let result = apply_single_edit(&state, "test.ts", EditOperation {
			op:      ChunkEditOp::Prepend,
			sel:     Some("enum_Color@body".to_owned()),
			crc:     None,
			region:  None,
			content: Some("White,\n".to_owned()),
			find:    None,
		});

		assert!(
			result.diff_after.contains("White"),
			"prepended variant should appear: {}",
			result.diff_after
		);
		// White should appear AFTER the opening brace, before Red
		let white_pos = result.diff_after.find("White").unwrap();
		let red_pos = result.diff_after.find("Red").unwrap();
		let doc_pos = result.diff_after.find("/** My enum.").unwrap();
		assert!(white_pos > doc_pos, "White should be after doc comment: {}", result.diff_after);
		assert!(white_pos < red_pos, "White should be before Red: {}", result.diff_after);
	}

	#[test]
	fn markdown_list_replace_preserves_trailing_blank_line() {
		let source = "# Title\n\n- item 1\n- item 2\n\n## Next\n";
		let state = state_for(source, "markdown");
		let list = state
			.inner()
			.tree
			.chunks
			.iter()
			.find(|c| {
				c.path
					.rsplit('.')
					.next()
					.is_some_and(|leaf| leaf.starts_with("list"))
			})
			.expect("list chunk");

		let result = apply_single_edit(&state, "test.md", EditOperation {
			op:      ChunkEditOp::Replace,
			sel:     Some(format!("{}#{}", list.path, list.checksum)),
			crc:     None,
			region:  None,
			content: Some("- new 1\n- new 2\n".to_owned()),
			find:    None,
		});

		// The blank line between the list and ## Next must be preserved.
		assert!(
			result.diff_after.contains("- new 2\n\n## Next"),
			"blank line between list and heading should be preserved: {:?}",
			result.diff_after
		);
	}

	#[test]
	fn markdown_after_preserves_blank_line_before_next_section() {
		let source = "# Title\n\n## Alpha\n\nalpha body\n\n## Beta\n\nbeta body\n";
		let state = state_for(source, "markdown");
		let section = state
			.inner()
			.chunk("section_Title.section_Alpha")
			.expect("alpha section");

		let result = apply_single_edit(&state, "test.md", EditOperation {
			op:      ChunkEditOp::After,
			sel:     Some(format!("{}#{}", section.path, section.checksum)),
			crc:     None,
			region:  None,
			content: Some("## Inserted\n\ninserted body\n".to_owned()),
			find:    None,
		});

		assert!(
			result
				.diff_after
				.contains("## Inserted\n\ninserted body\n\n## Beta"),
			"blank line between inserted section and next heading should be preserved: {:?}",
			result.diff_after
		);
	}

	#[test]
	fn markdown_body_append_preserves_blank_line_before_next_section() {
		let source = "# Title\n\n## Alpha\n\nalpha body\n\n## Beta\n\nbeta body\n";
		let state = state_for(source, "markdown");
		let section = state
			.inner()
			.chunk("section_Title.section_Alpha")
			.expect("alpha section");

		let result = apply_single_edit(&state, "test.md", EditOperation {
			op:      ChunkEditOp::Append,
			sel:     Some(format!("{}#{}@body", section.path, section.checksum)),
			crc:     None,
			region:  None,
			content: Some("\nextra paragraph\n".to_owned()),
			find:    None,
		});

		assert!(
			result
				.diff_after
				.contains("alpha body\n\n    extra paragraph\n\n## Beta"),
			"blank line between appended body content and next heading should be preserved: {:?}",
			result.diff_after
		);
	}

	#[test]
	fn rust_trait_members_are_addressable() {
		let source = "trait Handler {\n    fn handle(&self, req: &str) -> String;\n    fn \
		              name(&self) -> &str;\n}\n";
		let state = state_for(source, "rust");
		let tree = state.inner().tree();

		let trait_chunk = tree
			.chunks
			.iter()
			.find(|c| c.path == "trait_Handler")
			.expect("trait_Handler should exist");

		// Trait members should be listed as children even when they're
		// single-line signatures (not collapsed as trivial).
		assert!(
			!trait_chunk.children.is_empty(),
			"trait_Handler should have children, got leaf. Chunks: {:?}",
			tree.chunks.iter().map(|c| &c.path).collect::<Vec<_>>()
		);
	}

	#[test]
	fn python_body_append_preserves_indentation() {
		let source = "class Server:\n    def __init__(self):\n        self.x = 1\n\n    def \
		              start(self):\n        pass\n";
		let state = state_for(source, "python");

		let result = apply_single_edit(&state, "test.py", EditOperation {
			op:      ChunkEditOp::Append,
			sel:     Some("class_Server@body".to_owned()),
			crc:     None,
			region:  None,
			content: Some("def stop(self):\n\tpass\n".to_owned()),
			find:    None,
		});

		// The appended method should be at 4-space indent (class member level),
		// with its body at 8-space indent.
		assert!(
			result
				.diff_after
				.contains("    def stop(self):\n        pass"),
			"appended method should have correct Python indentation: {}",
			result.diff_after
		);
	}

	#[test]
	fn body_region_on_leaf_without_delimiters_falls_back_to_full_chunk() {
		let source = "enum LogLevel {\n    Debug,\n    Info,\n    Warn,\n    Fatal,\n}\n";
		let state = state_for(source, "rust");
		let chunk = state
			.inner()
			.chunk("enum_LogLevel.variant_Info")
			.expect("variant_Info should exist");
		assert!(chunk.prologue_end_byte.is_none(), "leaf variant should not have prologue_end_byte");

		for region_name in ["body", "head", "tail"] {
			let sel = format!("enum_LogLevel.variant_Info#{}@{}", chunk.checksum, region_name);
			let result = apply_edits(&state, &EditParams {
				operations:       vec![EditOperation {
					op:      ChunkEditOp::Replace,
					sel:     Some(sel),
					crc:     None,
					region:  None,
					content: Some("Error,".to_owned()),
					find:    None,
				}],
				default_selector: None,
				default_crc:      None,
				anchor_style:     None,
				cwd:              ".".to_owned(),
				file_path:        "test.rs".to_owned(),
			})
			.expect("leaf region should fall back to full chunk");

			assert!(
				result.diff_after.contains("Debug,\n    Error,\n    Warn,"),
				"@{region_name} should replace the full leaf chunk, got: {}",
				result.diff_after
			);
		}
	}
	#[test]
	fn rust_impl_method_head_replace_no_body_duplication() {
		let source = concat!(
			"struct Server {
",
			"    running: bool,
",
			"}
",
			"
",
			"impl Server {
",
			"    /// Starts the server.
",
			"    pub fn start(&mut self) {
",
			"        self.running = true;
",
			"        println!(\"started\");
",
			"    }
",
			"}
",
		);
		let state = state_for(source, "rust");
		let chunk = state
			.inner()
			.chunk("impl_Server.fn_start")
			.expect("impl_Server.fn_start should exist");
		assert!(
			chunk.prologue_end_byte.is_some(),
			"fn_start should have prologue_end_byte, got: start_byte={}, end_byte={}, \
			 prologue_end_byte={:?}, epilogue_start_byte={:?}",
			chunk.start_byte,
			chunk.end_byte,
			chunk.prologue_end_byte,
			chunk.epilogue_start_byte,
		);

		let result = apply_single_edit(&state, "test.rs", EditOperation {
			op:      ChunkEditOp::Replace,
			sel:     Some(format!("impl_Server.fn_start#{}@head", chunk.checksum)),
			crc:     None,
			region:  None,
			content: Some(
				"    /// Initializes and starts the server.
    pub fn start(&mut self) {"
					.to_owned(),
			),
			find:    None,
		});

		let body_count = result.diff_after.matches("self.running = true;").count();
		assert_eq!(
			body_count, 1,
			"body should appear exactly once after @head replace, got {} occurrences in:
{}",
			body_count, result.diff_after
		);
		assert!(
			result
				.diff_after
				.contains("/// Initializes and starts the server."),
			"new doc comment should be in output:
{}",
			result.diff_after
		);
		assert!(
			!result.diff_after.contains("/// Starts the server."),
			"old doc comment should be removed:
{}",
			result.diff_after
		);
	}

	#[test]
	fn typescript_class_method_head_replace_no_body_duplication() {
		let source = concat!(
			"class Server {
",
			"    /** Starts the server. */
",
			"    start() {
",
			"        this.running = true;
",
			"        console.log(\"started\");
",
			"    }
",
			"}
",
		);
		let state = state_for(source, "typescript");
		let chunk = state
			.inner()
			.chunk("class_Server.fn_start")
			.expect("class_Server.fn_start should exist");
		assert!(chunk.prologue_end_byte.is_some(), "fn_start should have prologue_end_byte");

		let result = apply_single_edit(&state, "test.ts", EditOperation {
			op:      ChunkEditOp::Replace,
			sel:     Some(format!("class_Server.fn_start#{}@head", chunk.checksum)),
			crc:     None,
			region:  None,
			content: Some(
				"    /** Initializes the server. */
    start() {"
					.to_owned(),
			),
			find:    None,
		});

		let body_count = result.diff_after.matches("this.running = true;").count();
		assert_eq!(
			body_count, 1,
			"body should appear exactly once after @head replace, got {} occurrences in:
{}",
			body_count, result.diff_after
		);
		assert!(
			result.diff_after.contains("/** Initializes the server. */"),
			"new doc comment should be in output:
{}",
			result.diff_after
		);
	}

	#[test]
	fn python_body_replace_does_not_corrupt_surrounding_code() {
		let source =
			"import os\n\ndef main():\n    x = 1\n    print(x)\n\ndef helper():\n    return 42\n";
		let state = state_for(source, "python");
		let chunk = state.inner().chunk("fn_main").expect("fn_main");

		let result = apply_single_edit(&state, "test.py", EditOperation {
			op:      ChunkEditOp::Replace,
			sel:     Some(format!("fn_main#{}@body", chunk.checksum)),
			crc:     None,
			region:  None,
			content: Some("y = 2\nprint(y)\n".to_owned()),
			find:    None,
		});

		assert!(
			result.diff_after.contains("import os"),
			"imports should survive body replace: {}",
			result.diff_after
		);
		assert!(
			result.diff_after.contains("def main"),
			"function head should survive body replace: {}",
			result.diff_after
		);
		assert!(
			result.diff_after.contains("y = 2"),
			"replacement body should appear: {}",
			result.diff_after
		);
		assert!(
			result.diff_after.contains("def helper"),
			"sibling function should survive body replace: {}",
			result.diff_after
		);
		assert!(
			result.diff_after.contains("return 42"),
			"sibling function body should survive: {}",
			result.diff_after
		);
		// Imports should remain at column 0, not indented
		assert!(
			result.diff_after.starts_with("import os"),
			"import should be at column 0: {:?}",
			&result.diff_after[..40.min(result.diff_after.len())]
		);
	}

	#[test]
	fn python_head_replace_does_not_orphan_body() {
		let source = "class Server:\n    def start(self) -> None:\n        self.running = True\n";
		let state = state_for(source, "python");
		let chunk = state
			.inner()
			.chunk("class_Server.fn_start")
			.expect("fn_start");

		let result = apply_single_edit(&state, "test.py", EditOperation {
			op:      ChunkEditOp::Replace,
			sel:     Some(format!("class_Server.fn_start#{}@head", chunk.checksum)),
			crc:     None,
			region:  None,
			content: Some("def begin(self) -> None:\n".to_owned()),
			find:    None,
		});

		assert!(
			result.diff_after.contains("def begin"),
			"replaced head should appear: {}",
			result.diff_after
		);
		assert!(
			result.diff_after.contains("self.running = True"),
			"body should survive head replace: {}",
			result.diff_after
		);
	}

	#[test]
	fn python_body_prepend_has_correct_indentation() {
		let source = "def main():\n    x = 1\n    print(x)\n";
		let state = state_for(source, "python");

		let result = apply_single_edit(&state, "test.py", EditOperation {
			op:      ChunkEditOp::Prepend,
			sel:     Some("fn_main@body".to_owned()),
			crc:     None,
			region:  None,
			content: Some("y = 0\n".to_owned()),
			find:    None,
		});

		assert!(
			result.diff_after.contains("y = 0"),
			"prepended content should appear: {}",
			result.diff_after
		);
		assert!(
			result.diff_after.contains("x = 1"),
			"existing body should survive: {}",
			result.diff_after
		);
		// The prepended content should be at the body indent level
		assert!(
			result.diff_after.contains("    y = 0"),
			"prepended content should be at body indent: {}",
			result.diff_after
		);
	}

	#[test]
	fn python_class_body_replace_preserves_structure() {
		let source =
			"class Server:\n    def start(self):\n        pass\n\n    def stop(self):\n        pass\n";
		let state = state_for(source, "python");
		let chunk = state.inner().chunk("class_Server").expect("class_Server");

		let result = apply_single_edit(&state, "test.py", EditOperation {
			op:      ChunkEditOp::Replace,
			sel:     Some(format!("class_Server#{}@body", chunk.checksum)),
			crc:     None,
			region:  None,
			content: Some("def run(self):\n\tpass\n".to_owned()),
			find:    None,
		});

		assert!(
			result.diff_after.contains("class Server:"),
			"class header should survive body replace: {}",
			result.diff_after
		);
		assert!(
			result.diff_after.contains("def run(self)"),
			"replaced body should appear: {}",
			result.diff_after
		);
		assert!(
			!result.diff_after.contains("def start"),
			"old body should be replaced: {}",
			result.diff_after
		);
	}

	#[test]
	fn whole_chunk_replace_includes_leading_trivia_in_range() {
		// Whole-chunk replace covers the full range including absorbed leading
		// trivia (comments, attributes). If the replacement omits the trivia,
		// it gets dropped — the read output shows the trivia as part of the
		// chunk so the LLM knows to include it.
		let source = "#[cfg(test)]\nmod tests {\n\tuse super::*;\n\n\t#[test]\n\tfn my_test() \
		              {\n\t\told();\n\t}\n}\n";
		let state = state_for(source, "rust");
		let chunk = state
			.inner()
			.chunk("mod_tests.fn_my_test")
			.expect("mod_tests.fn_my_test should exist");

		// Verify the chunk absorbs the #[test] attribute as leading trivia.
		assert!(
			chunk.start_byte < chunk.checksum_start_byte,
			"chunk should have absorbed leading trivia (start_byte {} < checksum_start_byte {})",
			chunk.start_byte,
			chunk.checksum_start_byte
		);

		// Replace the function WITHOUT including #[test] in the content.
		let result = apply_single_edit(&state, "test.rs", EditOperation {
			op:      ChunkEditOp::Replace,
			sel:     Some("mod_tests.fn_my_test".to_owned()),
			crc:     Some(chunk.checksum.clone()),
			region:  None,
			content: Some("fn my_test() {\n\tnew();\n}".to_owned()),
			find:    None,
		});

		// #[test] is dropped because the replacement didn't include it.
		assert!(
			!result.diff_after.contains("#[test]"),
			"#[test] should be dropped when omitted from replacement. Full text:\n{}",
			result.diff_after
		);

		// Verify the read output shows #[test] as part of the chunk's content
		// so the LLM can see it needs to be included.
		let read_output = crate::chunk::render::render_state(state.inner(), &RenderParams {
			chunk_path:           Some(String::new()),
			title:                "test.rs".to_owned(),
			language_tag:         Some("rust".to_owned()),
			visible_range:        None,
			render_children_only: true,
			omit_checksum:        true,
			anchor_style:         Some(ChunkAnchorStyle::Full),
			show_leaf_preview:    true,
			tab_replacement:      Some("    ".to_owned()),
			normalize_indent:     Some(true),
			focused_paths:        None,
		});
		println!("=== READ OUTPUT ===\n{read_output}\n=== END ===");
		assert!(
			read_output.contains("#[test]"),
			"read output must show #[test] as part of the chunk. Output:\n{read_output}"
		);
	}

	#[test]
	fn decl_region_replaces_without_leading_trivia() {
		// @decl covers checksum_start_byte → end_byte: the declaration itself
		// without leading trivia. Leading comments/attributes are preserved.
		let source = "#[cfg(test)]\nmod tests {\n\tuse super::*;\n\n\t#[test]\n\tfn my_test() \
		              {\n\t\told();\n\t}\n}\n";
		let state = state_for(source, "rust");
		let chunk = state
			.inner()
			.chunk("mod_tests.fn_my_test")
			.expect("fn_my_test should exist");

		let result = apply_single_edit(&state, "test.rs", EditOperation {
			op:      ChunkEditOp::Replace,
			sel:     Some("mod_tests.fn_my_test".to_owned()),
			crc:     Some(chunk.checksum.clone()),
			region:  Some(ChunkRegion::Decl),
			content: Some("fn my_test() {\n\tnew();\n}".to_owned()),
			find:    None,
		});

		// #[test] should be preserved — @decl doesn't cover leading trivia.
		assert!(
			result.diff_after.contains("#[test]"),
			"#[test] should be preserved with @decl. Full text:\n{}",
			result.diff_after
		);
		assert!(
			result.diff_after.contains("new()"),
			"replacement body should appear. Full text:\n{}",
			result.diff_after
		);
	}

	#[test]
	fn whole_chunk_replace_shows_diff_hunks_after_attribute_restoration() {
		// Bug 2: After a first edit drops #[test] (bug 1), a follow-up edit that
		// adds it back should show diff hunks in the response text.
		// Uses a module with multiple functions and a batch of two replacements
		// to match the real-world scenario.
		let source = "\
#[cfg(test)]\nmod tests {\n\tuse super::*;\n\n\tfn test_alpha() {\n\t\told_alpha();\n\t}\n\n\tfn \
		              test_middle() {\n\t\tmiddle();\n\t}\n\n\tfn test_beta() \
		              {\n\t\told_beta();\n\t}\n}\n";
		let state = state_for(source, "rust");
		let chunk_a = state
			.inner()
			.chunk("mod_tests.fn_test_alpha")
			.expect("fn_test_alpha should exist");
		let chunk_b = state
			.inner()
			.chunk("mod_tests.fn_test_beta")
			.expect("fn_test_beta should exist");

		// Batch replace: add #[test] to both functions.
		let result = apply_edits(&state, &EditParams {
			operations:       vec![
				EditOperation {
					op:      ChunkEditOp::Replace,
					sel:     Some("mod_tests.fn_test_alpha".to_owned()),
					crc:     Some(chunk_a.checksum.clone()),
					region:  None,
					content: Some("#[test]\nfn test_alpha() {\n\tnew_alpha();\n}".to_owned()),
					find:    None,
				},
				EditOperation {
					op:      ChunkEditOp::Replace,
					sel:     Some("mod_tests.fn_test_beta".to_owned()),
					crc:     Some(chunk_b.checksum.clone()),
					region:  None,
					content: Some("#[test]\nfn test_beta() {\n\tnew_beta();\n}".to_owned()),
					find:    None,
				},
			],
			default_selector: None,
			default_crc:      None,
			anchor_style:     None,
			cwd:              ".".to_owned(),
			file_path:        "test.rs".to_owned(),
		})
		.expect("edit should apply");

		assert!(result.changed, "edit should be detected as a change");
		assert!(
			result.diff_after.contains("#[test]"),
			"#[test] should be in the result. Full text:\n{}",
			result.diff_after
		);
		// The response text should contain diff hunks (@@) showing the changes.
		assert!(
			result.response_text.contains("@@"),
			"response should include diff hunks showing the changes. Response:\n{}",
			result.response_text
		);
	}

	#[test]
	fn diff_hunks_shown_for_non_leaf_function_replacement() {
		// Bug 2 (realistic): When replacing functions that have children
		// (sub-chunks like stmts, let bindings), the diff hunks should still
		// appear in the response. Mirrors the real-world scenario where only
		// #[test] is added and the function body stays identical.
		let source =
			"\
#[cfg(test)]\nmod tests {\n\tuse super::*;\n\n\tfn test_alpha() {\n\t\tlet mut config = \
			 base_config();\n\t\tconfig.enabled = Some(false);\n\t\tconfig.max_items = \
			 Some(10);\n\n\t\tlet Err(error) = build_options(&config) else {\n\t\t\tpanic!(\"should \
			 fail\");\n\t\t};\n\t\tassert_error_contains(&error, \"cannot be \
			 combined\");\n\t}\n\n\tfn test_middle() {\n\t\tmiddle();\n\t}\n\n\tfn test_beta() \
			 {\n\t\tlet mut config = base_config();\n\t\tconfig.enabled = \
			 Some(true);\n\t\tconfig.max_size = Some(0);\n\n\t\tlet Err(error) = \
			 build_options(&config) else {\n\t\t\tpanic!(\"must be \
			 positive\");\n\t\t};\n\t\tassert_error_contains(&error, \"must be positive\");\n\t}\n}\n";
		let state = state_for(source, "rust");

		// Verify the functions have children (sub-chunks).
		let chunk_a = state
			.inner()
			.chunk("mod_tests.fn_test_alpha")
			.expect("fn_test_alpha should exist");
		assert!(
			!chunk_a.children.is_empty(),
			"fn_test_alpha should have children (sub-chunks), got: {:?}",
			chunk_a.children
		);
		let chunk_b = state
			.inner()
			.chunk("mod_tests.fn_test_beta")
			.expect("fn_test_beta should exist");
		assert!(
			!chunk_b.children.is_empty(),
			"fn_test_beta should have children (sub-chunks), got: {:?}",
			chunk_b.children
		);

		// Replace both functions: only adding #[test], body is identical.
		let result = apply_edits(&state, &EditParams {
			operations:       vec![
				EditOperation {
					op:      ChunkEditOp::Replace,
					sel:     Some("mod_tests.fn_test_alpha".to_owned()),
					crc:     Some(chunk_a.checksum.clone()),
					region:  None,
					content: Some(
						"#[test]\nfn test_alpha() {\n\tlet mut config = \
						 base_config();\n\tconfig.enabled = Some(false);\n\tconfig.max_items = \
						 Some(10);\n\n\tlet Err(error) = build_options(&config) else \
						 {\n\t\tpanic!(\"should fail\");\n\t};\n\tassert_error_contains(&error, \
						 \"cannot be combined\");\n}"
							.to_owned(),
					),
					find:    None,
				},
				EditOperation {
					op:      ChunkEditOp::Replace,
					sel:     Some("mod_tests.fn_test_beta".to_owned()),
					crc:     Some(chunk_b.checksum.clone()),
					region:  None,
					content: Some(
						"#[test]\nfn test_beta() {\n\tlet mut config = base_config();\n\tconfig.enabled \
						 = Some(true);\n\tconfig.max_size = Some(0);\n\n\tlet Err(error) = \
						 build_options(&config) else {\n\t\tpanic!(\"must be \
						 positive\");\n\t};\n\tassert_error_contains(&error, \"must be positive\");\n}"
							.to_owned(),
					),
					find:    None,
				},
			],
			default_selector: None,
			default_crc:      None,
			anchor_style:     None,
			cwd:              ".".to_owned(),
			file_path:        "test.rs".to_owned(),
		})
		.expect("edit should apply");

		assert!(result.changed, "edit should be detected as a change");
		assert!(result.diff_before != result.diff_after, "diff_before and diff_after should differ");
		// Count actual diff hunks.
		let hunks = super::generate_diff_hunks(&result.diff_before, &result.diff_after, 0);
		assert!(
			!hunks.is_empty(),
			"generate_diff_hunks should produce non-empty hunks.\ndiff_before:\n{}\ndiff_after:\n{}",
			result.diff_before,
			result.diff_after,
		);
		// The response text should contain diff hunks (@@) showing the changes.
		assert!(
			result.response_text.contains("@@"),
			"response should include diff hunks showing the changes.\nhunks: {}\nResponse:\n{}",
			hunks.len(),
			result.response_text,
		);
	}
}
