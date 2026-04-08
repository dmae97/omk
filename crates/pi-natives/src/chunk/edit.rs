use std::{cmp::Ordering, path::Path};

use crate::chunk::{
	indent::{
		detect_file_indent_char, detect_file_indent_step, normalize_leading_whitespace_char,
		reindent_inserted_block, strip_content_prefixes,
	},
	resolve::{
		resolve_chunk_selector, resolve_chunk_with_crc, sanitize_chunk_selector, sanitize_crc,
	},
	state::{ChunkState, ChunkStateInner},
	types::{
		ChunkAnchorStyle, ChunkEditOp, ChunkFocusMode, ChunkNode, EditOperation, EditParams,
		EditResult, FocusedPath, RenderParams,
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
enum LeadingTriviaFamily {
	SlashLineComment,
	BlockComment,
	HashComment,
	DashDashComment,
	SemicolonComment,
	PercentComment,
	AtAttribute,
	RustAttribute,
	BracketAttribute,
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
			ChunkEditOp::ReplaceBody => apply_replace_body(
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
			ChunkEditOp::AppendChild
			| ChunkEditOp::PrependChild
			| ChunkEditOp::AppendSibling
			| ChunkEditOp::PrependSibling => apply_insert(
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
	// When auto-accepted, strip CRC so resolution finds by path only (CRC is stale
	// from pre-batch).
	let resolve_crc = if batch_auto_accepted { None } else { crc };
	let resolved = resolve_chunk_with_crc(state, anchor_selector, resolve_crc, warnings)?;
	if !batch_auto_accepted {
		validate_batch_crc(resolved.chunk, resolved.crc.as_deref(), requires_checksum)?;
	}
	let anchor = resolved.chunk.clone();

	// Scoped find/replace: locate a literal substring inside the chunk and replace
	// it.
	if let Some(find) = operation.find.as_deref() {
		if find.is_empty() {
			return Err(format!(
				"find/replace on {}: 'find' cannot be empty. Omit 'find' for whole-chunk replace.",
				describe_scheduled_operation(scheduled)
			));
		}

		let chunk_start = anchor.start_byte as usize;
		let chunk_end = anchor.end_byte as usize;
		let chunk_source = &state.source[chunk_start..chunk_end];
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
		let abs_start = chunk_start + rel_offset;
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

	let target_indent = anchor.indent_char.repeat(anchor.indent as usize);
	let content = operation.content.as_deref().unwrap_or_default();
	let mut replacement =
		normalize_inserted_content(content, &target_indent, Some(file_indent_step), file_indent_char);
	replacement = preserve_attached_leading_trivia(state, &anchor, &replacement);
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

/// Replace only the inner body of a chunk, preserving the signature line(s)
/// and closing delimiter.
fn apply_replace_body(
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
	let resolve_crc = if batch_auto_accepted { None } else { crc };
	let resolved = resolve_chunk_with_crc(state, anchor_selector, resolve_crc, warnings)?;
	if !batch_auto_accepted {
		validate_batch_crc(resolved.chunk, resolved.crc.as_deref(), requires_checksum)?;
	}
	let anchor = resolved.chunk.clone();

	let body_start = anchor.body_start_byte.ok_or_else(|| {
		format!(
			"replace_body on {}: chunk has no body range (not a function/method/class).",
			anchor.path
		)
	})? as usize;
	let body_end = anchor.body_end_byte.ok_or_else(|| {
		format!(
			"replace_body on {}: chunk has no body range (not a function/method/class).",
			anchor.path
		)
	})? as usize;

	// Determine inner body boundaries.  For brace-delimited bodies (most
	// languages), we want to replace only between the opening `{` and
	// closing `}`.  For Python (colon + indented block), body_start is
	// already the first statement.
	let body_slice = &state.source[body_start..body_end];

	let (inner_start, inner_end) = if let Some(open_brace) = body_slice.find('{') {
		// Find the closing brace from the end.
		let close_brace = body_slice.rfind('}').unwrap_or(body_slice.len());
		let abs_open = body_start + open_brace + 1; // after '{'
		let abs_close = body_start + close_brace; // before '}'
		// Skip the newline after '{' if present.
		let start = if state.source.as_bytes().get(abs_open) == Some(&b'\n') {
			abs_open + 1
		} else {
			abs_open
		};
		// Include trailing newline before '}' if the close is on its own line.
		let end = if abs_close > 0 && state.source.as_bytes().get(abs_close - 1) == Some(&b'\n') {
			abs_close - 1
		} else {
			abs_close
		};
		(start, end.max(start))
	} else {
		// No braces (e.g. Python): replace the entire body range.
		(body_start, body_end)
	};

	// Determine the target indent level for the body content.
	let target_indent_level = anchor.indent as usize + file_indent_step;
	let target_indent =
		std::iter::repeat_n(file_indent_char, target_indent_level).collect::<String>();
	let content = operation.content.as_deref().unwrap_or_default();
	let replacement =
		normalize_inserted_content(content, &target_indent, Some(file_indent_step), file_indent_char);

	// Build the new source: [before inner] + replacement + newline + [after inner]
	let mut new_source = String::with_capacity(state.source.len());
	new_source.push_str(&state.source[..inner_start]);
	if !replacement.is_empty() {
		new_source.push_str(&replacement);
		if !replacement.ends_with('\n') {
			new_source.push('\n');
		}
	}
	new_source.push_str(&state.source[inner_end..]);
	state.source = new_source;
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
	let resolve_crc = if batch_auto_accepted { None } else { crc };
	let resolved = resolve_chunk_with_crc(state, anchor_selector, resolve_crc, warnings)?;
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
	let resolve_crc = if batch_auto_accepted { None } else { crc };
	let resolved = resolve_chunk_with_crc(state, anchor_selector, resolve_crc, warnings)?;
	if !batch_auto_accepted {
		validate_batch_crc(resolved.chunk, resolved.crc.as_deref(), resolved.crc.is_some())?;
	}
	let anchor = resolved.chunk.clone();

	let pos = match operation.op {
		ChunkEditOp::AppendChild => InsertPosition::LastChild,
		ChunkEditOp::PrependChild => InsertPosition::FirstChild,
		ChunkEditOp::AppendSibling => InsertPosition::After,
		ChunkEditOp::PrependSibling => InsertPosition::Before,
		ChunkEditOp::Replace | ChunkEditOp::Delete | ChunkEditOp::ReplaceBody => {
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

fn preserve_attached_leading_trivia(
	state: &ChunkStateInner,
	anchor: &ChunkNode,
	replacement: &str,
) -> String {
	if replacement.is_empty() {
		return replacement.to_owned();
	}

	let trivia_start = anchor.start_byte as usize;
	let trivia_end = anchor.checksum_start_byte as usize;
	if trivia_end <= trivia_start {
		return replacement.to_owned();
	}

	let leading_trivia = &state.source[trivia_start..trivia_end];
	if leading_trivia.trim().is_empty()
		|| replacement.starts_with(leading_trivia)
		|| replacement_supplies_leading_trivia(leading_trivia, replacement)
	{
		return replacement.to_owned();
	}

	let mut combined = String::with_capacity(leading_trivia.len() + replacement.len());
	combined.push_str(leading_trivia);
	combined.push_str(replacement);
	combined
}

fn replacement_supplies_leading_trivia(leading_trivia: &str, replacement: &str) -> bool {
	let Some(family) = detect_leading_trivia_family(leading_trivia) else {
		return false;
	};
	let Some(first_non_empty_line) = replacement.lines().find(|line| !line.trim().is_empty()) else {
		return false;
	};
	matches_leading_trivia_family(family, first_non_empty_line.trim_start())
}

fn detect_leading_trivia_family(text: &str) -> Option<LeadingTriviaFamily> {
	let first_non_empty_line = text.lines().find(|line| !line.trim().is_empty())?;
	let trimmed = first_non_empty_line.trim_start();
	if trimmed.starts_with("//") {
		Some(LeadingTriviaFamily::SlashLineComment)
	} else if trimmed.starts_with("/*") || trimmed.starts_with('*') {
		Some(LeadingTriviaFamily::BlockComment)
	} else if trimmed.starts_with("#[") {
		Some(LeadingTriviaFamily::RustAttribute)
	} else if trimmed.starts_with('@') {
		Some(LeadingTriviaFamily::AtAttribute)
	} else if trimmed.starts_with('[') && trimmed.ends_with(']') {
		Some(LeadingTriviaFamily::BracketAttribute)
	} else if trimmed.starts_with("--") {
		Some(LeadingTriviaFamily::DashDashComment)
	} else if trimmed.starts_with(';') {
		Some(LeadingTriviaFamily::SemicolonComment)
	} else if trimmed.starts_with('%') {
		Some(LeadingTriviaFamily::PercentComment)
	} else if trimmed.starts_with('#') {
		Some(LeadingTriviaFamily::HashComment)
	} else {
		None
	}
}

fn matches_leading_trivia_family(family: LeadingTriviaFamily, line: &str) -> bool {
	match family {
		LeadingTriviaFamily::SlashLineComment => line.starts_with("//"),
		LeadingTriviaFamily::BlockComment => line.starts_with("/*") || line.starts_with('*'),
		LeadingTriviaFamily::HashComment => line.starts_with('#') && !line.starts_with("#["),
		LeadingTriviaFamily::DashDashComment => line.starts_with("--"),
		LeadingTriviaFamily::SemicolonComment => line.starts_with(';'),
		LeadingTriviaFamily::PercentComment => line.starts_with('%'),
		LeadingTriviaFamily::AtAttribute => line.starts_with('@'),
		LeadingTriviaFamily::RustAttribute => line.starts_with("#["),
		LeadingTriviaFamily::BracketAttribute => line.starts_with('[') && line.ends_with(']'),
	}
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
			if !anchor.path.is_empty()
				&& anchor.leaf
				&& !is_container_like_chunk(anchor)
				&& !anchor.group
			{
				return Err(format!("Cannot use prepend_child on leaf chunk {}", anchor.path));
			}
			Ok(get_insertion_point(state, anchor, Ordering::Less, insertion_content))
		},
		InsertPosition::LastChild => {
			if !anchor.path.is_empty()
				&& anchor.leaf
				&& !is_container_like_chunk(anchor)
				&& !anchor.group
			{
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

/// Returns true if a container's children should be separated by blank lines.
/// Root-level children (functions, classes) and containers with non-leaf
/// children (methods) want blank line spacing. Containers whose children are
/// all packed declarations (struct fields, enum variants) are tightly packed.
fn children_want_blank_line_spacing(state: &ChunkStateInner, anchor: &ChunkNode) -> bool {
	// Root children are always top-level declarations, separated by blank lines.
	if anchor.path.is_empty() {
		return true;
	}
	// If the container has no chunk children, fall back to spaced (preserves
	// existing behavior for containers with interior content but no parsed
	// children).
	if anchor.children.is_empty() {
		return true;
	}
	// Packed children are declarations that belong tightly together without
	// blank line separators: struct fields, enum variants, etc.
	let all_packed = anchor.children.iter().all(|child_path| {
		state
			.tree
			.chunks
			.iter()
			.any(|c| c.path == *child_path && is_packed_child(&c.name))
	});
	!all_packed
}

/// Returns true if a chunk name indicates a packed (tightly-spaced) child.
/// These are declarations like struct fields and enum variants that don't
/// need blank line separators between them.
fn is_packed_child(name: &str) -> bool {
	name.starts_with("field_") || name.starts_with("variant_")
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
) -> InsertSpacing {
	let has_interior_content = container_has_interior_content(state, anchor);
	match pos {
		InsertPosition::FirstChild => {
			let spaced = children_want_blank_line_spacing(state, anchor);
			InsertSpacing {
				blank_line_before: false,
				blank_line_after:  spaced && (!anchor.children.is_empty() || has_interior_content),
			}
		},
		InsertPosition::LastChild => {
			let spaced = children_want_blank_line_spacing(state, anchor);
			InsertSpacing {
				blank_line_before: spaced && (!anchor.children.is_empty() || has_interior_content),
				blank_line_after:  false,
			}
		},
		InsertPosition::Before => InsertSpacing {
			blank_line_before: has_sibling_before(state, anchor) && is_spaced_sibling(state, anchor),
			blank_line_after:  is_spaced_sibling(state, anchor),
		},
		InsertPosition::After => InsertSpacing {
			blank_line_before: is_spaced_sibling(state, anchor),
			blank_line_after:  has_sibling_after(state, anchor) && is_spaced_sibling(state, anchor),
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
				op:      ChunkEditOp::Replace,
				sel:     Some("fn_main".to_owned()),
				crc:     Some(chunk.checksum.clone()),
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
	fn edit_rejects_line_number_targets_with_clear_error() {
		let source = "function main(): void {\n\tconsole.log(\"old\");\n}\n";
		let state = state_for(source, "typescript");

		let result = apply_edits(&state, &EditParams {
			operations:       vec![EditOperation {
				op:      ChunkEditOp::Replace,
				sel:     Some("L2".to_owned()),
				crc:     None,
				content: Some("function main(): void {\n\tconsole.log(\"new\");\n}".to_owned()),
				find:    None,
			}],
			default_selector: None,
			default_crc:      None,
			anchor_style:     None,
			cwd:              ".".to_owned(),
			file_path:        "box.ts".to_owned(),
		});
		let Err(err) = result else {
			panic!("line-number selectors should be rejected");
		};

		assert!(err.contains("Line-number targets are not supported in chunk mode"), "{err}");
		assert!(err.contains("fn_foo#ABCD"), "{err}");
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
	fn append_child_on_group_chunk_inserts_at_end() {
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
			.find(|c| c.name.starts_with("stmts"))
			.expect("stmts chunk should exist");
		assert!(stmts.group, "stmts chunk should be marked as group");

		let result = apply_edits(&state, &EditParams {
			operations:       vec![EditOperation {
				op:      ChunkEditOp::AppendChild,
				sel:     Some(stmts.path.clone()),
				crc:     None,
				content: Some("\nit(\"b\", () => {});".to_owned()),
				find:    None,
			}],
			default_selector: None,
			default_crc:      None,
			anchor_style:     None,
			cwd:              ".".to_owned(),
			file_path:        "test.ts".to_owned(),
		})
		.expect("append_child on group chunk should succeed");

		assert!(
			result.diff_after.contains("it(\"b\""),
			"appended content should appear in output, got: {}",
			result.diff_after
		);
	}
}
