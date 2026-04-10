use std::collections::{HashMap, HashSet};

use super::{
	chunk_checksum,
	common::{detect_indent, total_line_count},
	kind::ChunkKind,
	line_start_offsets,
	state::ConflictMeta,
	types::{ChunkNode, ChunkTree},
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConflictRegion {
	pub ours_start_line:   usize,
	pub ours_end_line:     usize,
	pub theirs_start_line: usize,
	pub theirs_end_line:   usize,
	pub marker_start_line: usize,
	pub marker_end_line:   usize,
	pub ours_content:      String,
	pub theirs_content:    String,
	pub base_content:      Option<String>,
	pub base_label:        Option<String>,
	pub ours_label:        String,
	pub theirs_label:      String,
}

#[derive(Clone, Debug)]
pub struct CleanResult {
	pub source:           String,
	pub conflicts:        Vec<ConflictRegion>,
	pub ours_byte_ranges: Vec<(usize, usize)>,
}

#[derive(Clone)]
struct PendingConflict {
	path:            Option<String>,
	parent_path:     Option<String>,
	ours_start_byte: usize,
	ours_end_byte:   usize,
	ours_content:    String,
	theirs_content:  String,
	base_content:    Option<String>,
	base_label:      Option<String>,
	ours_label:      String,
	theirs_label:    String,
}

pub fn has_conflict_markers(source: &str) -> bool {
	source.contains("<<<<<<<") && source.contains("=======") && source.contains(">>>>>>>")
}

pub fn detect_conflicts(source: &str) -> Vec<ConflictRegion> {
	let lines = source_lines(source);
	let mut conflicts = Vec::new();
	let mut index = 0usize;

	while index < lines.len() {
		let Some(ours_label) = marker_label(lines[index], "<<<<<<<") else {
			index += 1;
			continue;
		};
		let marker_start_line = index + 1;
		let ours_start_index = index + 1;
		let mut separator_index = None;
		let mut base_marker_index = None;
		let mut base_label = None;
		let mut cursor = ours_start_index;

		while cursor < lines.len() {
			if let Some(label) = marker_label(lines[cursor], "|||||||") {
				base_marker_index = Some(cursor);
				base_label = Some(label);
				cursor += 1;
				while cursor < lines.len() {
					if is_marker_line(lines[cursor], "=======") {
						separator_index = Some(cursor);
						break;
					}
					cursor += 1;
				}
				break;
			}
			if is_marker_line(lines[cursor], "=======") {
				separator_index = Some(cursor);
				break;
			}
			cursor += 1;
		}

		let Some(separator_index) = separator_index else {
			index += 1;
			continue;
		};

		let theirs_start_index = separator_index + 1;
		let mut end_index = theirs_start_index;
		while end_index < lines.len() && marker_label(lines[end_index], ">>>>>>>").is_none() {
			end_index += 1;
		}
		let Some(theirs_label) = lines
			.get(end_index)
			.and_then(|line| marker_label(line, ">>>>>>>"))
		else {
			index += 1;
			continue;
		};

		let ours_end_index = base_marker_index.unwrap_or(separator_index);
		let base_start_index = base_marker_index.map_or(separator_index, |value| value + 1);
		let base_end_index = separator_index;

		let (ours_start_line, ours_end_line) = content_line_range(ours_start_index, ours_end_index);
		let (theirs_start_line, theirs_end_line) = content_line_range(theirs_start_index, end_index);

		conflicts.push(ConflictRegion {
			ours_start_line,
			ours_end_line,
			theirs_start_line,
			theirs_end_line,
			marker_start_line,
			marker_end_line: end_index + 1,
			ours_content: join_lines(&lines[ours_start_index..ours_end_index]),
			theirs_content: join_lines(&lines[theirs_start_index..end_index]),
			base_content: base_marker_index
				.map(|_| join_lines(&lines[base_start_index..base_end_index])),
			base_label,
			ours_label,
			theirs_label,
		});
		index = end_index + 1;
	}

	conflicts
}

pub fn accept_ours(source: &str, conflicts: &[ConflictRegion]) -> CleanResult {
	if conflicts.is_empty() {
		return CleanResult {
			source:           source.to_owned(),
			conflicts:        Vec::new(),
			ours_byte_ranges: Vec::new(),
		};
	}

	let lines = source_lines(source);
	let mut clean_source = String::with_capacity(source.len());
	let mut ours_byte_ranges = Vec::with_capacity(conflicts.len());
	let mut cursor_line = 1usize;

	for conflict in conflicts {
		let marker_start = conflict.marker_start_line.saturating_sub(1);
		for line in lines
			.iter()
			.take(marker_start)
			.skip(cursor_line.saturating_sub(1))
		{
			clean_source.push_str(line);
		}
		let ours_start_byte = clean_source.len();
		let ours_start_index = conflict.ours_start_line.saturating_sub(1);
		let ours_end_index = if conflict.ours_start_line <= conflict.ours_end_line {
			conflict.ours_end_line
		} else {
			ours_start_index
		};
		for line in lines.iter().take(ours_end_index).skip(ours_start_index) {
			clean_source.push_str(line);
		}
		ours_byte_ranges.push((ours_start_byte, clean_source.len()));
		cursor_line = conflict.marker_end_line + 1;
	}

	for line in lines.iter().skip(cursor_line.saturating_sub(1)) {
		clean_source.push_str(line);
	}

	CleanResult { source: clean_source, conflicts: conflicts.to_vec(), ours_byte_ranges }
}

pub fn reconstruct_markers(
	clean_source: &str,
	conflict_meta: &HashMap<String, ConflictMeta>,
) -> String {
	if conflict_meta.is_empty() {
		return clean_source.to_owned();
	}

	let mut conflicts = conflict_meta.iter().collect::<Vec<_>>();
	conflicts.sort_unstable_by_key(|(_, meta)| meta.ours_start_byte);

	let mut rendered = String::with_capacity(clean_source.len() + conflict_meta.len() * 64);
	let mut cursor = 0usize;
	for (_, meta) in conflicts {
		if meta.ours_start_byte > clean_source.len()
			|| meta.ours_end_byte > clean_source.len()
			|| meta.ours_start_byte > meta.ours_end_byte
		{
			continue;
		}

		rendered.push_str(&clean_source[cursor..meta.ours_start_byte]);
		push_marker_line(&mut rendered, "<<<<<<<", Some(meta.ours_label.as_str()));
		push_conflict_content(&mut rendered, &clean_source[meta.ours_start_byte..meta.ours_end_byte]);
		if let Some(base_content) = meta.base_content.as_deref() {
			push_marker_line(&mut rendered, "|||||||", meta.base_label.as_deref());
			push_conflict_content(&mut rendered, base_content);
		}
		push_marker_line(&mut rendered, "=======", None);
		push_conflict_content(&mut rendered, meta.theirs_content.as_str());
		push_marker_line(&mut rendered, ">>>>>>>", Some(meta.theirs_label.as_str()));
		cursor = meta.ours_end_byte;
	}
	rendered.push_str(&clean_source[cursor..]);
	rendered
}

pub fn inject_conflict_chunks(
	tree: &mut ChunkTree,
	source: &str,
	clean_result: &CleanResult,
) -> HashMap<String, ConflictMeta> {
	let mut pending = Vec::with_capacity(clean_result.conflicts.len());
	for (conflict, (ours_start_byte, ours_end_byte)) in clean_result
		.conflicts
		.iter()
		.zip(clean_result.ours_byte_ranges.iter().copied())
	{
		pending.push(PendingConflict {
			path: None,
			parent_path: None,
			ours_start_byte,
			ours_end_byte,
			ours_content: conflict.ours_content.clone(),
			theirs_content: conflict.theirs_content.clone(),
			base_content: conflict.base_content.clone(),
			base_label: conflict.base_label.clone(),
			ours_label: conflict.ours_label.clone(),
			theirs_label: conflict.theirs_label.clone(),
		});
	}
	inject_pending_conflicts(tree, source, pending)
}

pub fn reinject_conflict_chunks(
	tree: &mut ChunkTree,
	source: &str,
	conflict_meta: &HashMap<String, ConflictMeta>,
) -> HashMap<String, ConflictMeta> {
	let mut pending = conflict_meta
		.iter()
		.map(|(path, meta)| PendingConflict {
			path:            Some(path.clone()),
			parent_path:     conflict_parent_path(path),
			ours_start_byte: meta.ours_start_byte,
			ours_end_byte:   meta.ours_end_byte,
			ours_content:    source
				.get(meta.ours_start_byte..meta.ours_end_byte)
				.unwrap_or_default()
				.to_owned(),
			theirs_content:  meta.theirs_content.clone(),
			base_content:    meta.base_content.clone(),
			base_label:      meta.base_label.clone(),
			ours_label:      meta.ours_label.clone(),
			theirs_label:    meta.theirs_label.clone(),
		})
		.collect::<Vec<_>>();
	pending.sort_unstable_by_key(|conflict| conflict.ours_start_byte);
	inject_pending_conflicts(tree, source, pending)
}

fn inject_pending_conflicts(
	tree: &mut ChunkTree,
	source: &str,
	pending: Vec<PendingConflict>,
) -> HashMap<String, ConflictMeta> {
	let mut conflict_meta = HashMap::new();
	let mut existing_paths = tree
		.chunks
		.iter()
		.map(|chunk| chunk.path.clone())
		.collect::<HashSet<_>>();
	let line_starts = line_start_offsets(source);
	let mut counters = HashMap::<String, usize>::new();

	for pending_conflict in pending {
		if pending_conflict.ours_start_byte > pending_conflict.ours_end_byte
			|| pending_conflict.ours_end_byte > source.len()
		{
			continue;
		}

		let parent_path = match pending_conflict.parent_path.as_deref() {
			Some(parent_path) => {
				if tree.chunks.iter().any(|chunk| chunk.path == parent_path) {
					parent_path.to_owned()
				} else {
					continue;
				}
			},
			None => find_innermost_parent_path(
				tree,
				pending_conflict.ours_start_byte,
				pending_conflict.ours_end_byte,
			)
			.unwrap_or_default(),
		};

		let conflict_path = pending_conflict.path.unwrap_or_else(|| {
			next_conflict_path(parent_path.as_str(), &mut counters, &existing_paths)
		});
		let ours_path = format!("{conflict_path}.ours");
		let theirs_path = format!("{conflict_path}.theirs");
		existing_paths.insert(conflict_path.clone());
		existing_paths.insert(ours_path.clone());
		existing_paths.insert(theirs_path.clone());

		let (start_line, end_line, line_count) = real_line_stats(
			&line_starts,
			pending_conflict.ours_start_byte,
			pending_conflict.ours_end_byte,
		);
		let theirs_line_count = display_line_count(pending_conflict.theirs_content.as_str()) as u32;
		let (indent, indent_char) =
			detect_indent(source, pending_conflict.ours_start_byte.min(source.len()));
		let conflict_identifier = conflict_path
			.rsplit('.')
			.next()
			.and_then(|leaf| leaf.strip_prefix("conflict_"))
			.map(ToOwned::to_owned);
		let conflict_checksum = chunk_checksum(
			format!(
				"{}\0{}\0{}\0{}\0{}",
				pending_conflict.ours_label,
				pending_conflict.theirs_label,
				pending_conflict.ours_content,
				pending_conflict.theirs_content,
				pending_conflict.base_content.as_deref().unwrap_or_default(),
			)
			.as_bytes(),
		);
		let theirs_start_line = start_line;
		let theirs_end_line = if theirs_line_count == 0 {
			theirs_start_line
		} else {
			theirs_start_line + theirs_line_count - 1
		};
		let conflict_end_line = end_line.max(theirs_end_line);
		let conflict_line_count = if conflict_end_line >= start_line {
			conflict_end_line - start_line + 1
		} else {
			0
		};

		tree.chunks.push(ChunkNode {
			path: conflict_path.clone(),
			identifier: conflict_identifier,
			kind: ChunkKind::Conflict,
			leaf: false,
			virtual_content: None,
			parent_path: Some(parent_path.clone()),
			children: vec![ours_path.clone(), theirs_path.clone()],
			signature: None,
			start_line,
			end_line: conflict_end_line,
			line_count: conflict_line_count,
			start_byte: pending_conflict.ours_start_byte as u32,
			end_byte: pending_conflict.ours_end_byte as u32,
			checksum_start_byte: pending_conflict.ours_start_byte as u32,
			prologue_end_byte: None,
			epilogue_start_byte: None,
			checksum: conflict_checksum,
			error: false,
			indent,
			indent_char: indent_char.clone(),
			group: false,
		});
		tree.chunks.push(ChunkNode {
			path: ours_path.clone(),
			identifier: None,
			kind: ChunkKind::Ours,
			leaf: true,
			virtual_content: (pending_conflict.ours_start_byte == pending_conflict.ours_end_byte)
				.then(String::new),
			parent_path: Some(conflict_path.clone()),
			children: Vec::new(),
			signature: None,
			start_line,
			end_line,
			line_count,
			start_byte: pending_conflict.ours_start_byte as u32,
			end_byte: pending_conflict.ours_end_byte as u32,
			checksum_start_byte: pending_conflict.ours_start_byte as u32,
			prologue_end_byte: None,
			epilogue_start_byte: None,
			checksum: chunk_checksum(
				source
					.as_bytes()
					.get(pending_conflict.ours_start_byte..pending_conflict.ours_end_byte)
					.unwrap_or_default(),
			),
			error: false,
			indent,
			indent_char: indent_char.clone(),
			group: false,
		});
		tree.chunks.push(ChunkNode {
			path: theirs_path.clone(),
			identifier: None,
			kind: ChunkKind::Theirs,
			leaf: true,
			virtual_content: Some(pending_conflict.theirs_content.clone()),
			parent_path: Some(conflict_path.clone()),
			children: Vec::new(),
			signature: None,
			start_line: theirs_start_line,
			end_line: theirs_end_line,
			line_count: theirs_line_count,
			start_byte: pending_conflict.ours_start_byte as u32,
			end_byte: pending_conflict.ours_start_byte as u32,
			checksum_start_byte: pending_conflict.ours_start_byte as u32,
			prologue_end_byte: None,
			epilogue_start_byte: None,
			checksum: chunk_checksum(pending_conflict.theirs_content.as_bytes()),
			error: false,
			indent,
			indent_char,
			group: false,
		});

		insert_conflict_child(
			tree,
			parent_path.as_str(),
			conflict_path.as_str(),
			pending_conflict.ours_start_byte,
			pending_conflict.ours_end_byte,
		);

		conflict_meta.insert(conflict_path, ConflictMeta {
			theirs_content:  pending_conflict.theirs_content,
			ours_label:      pending_conflict.ours_label,
			theirs_label:    pending_conflict.theirs_label,
			base_content:    pending_conflict.base_content,
			base_label:      pending_conflict.base_label,
			ours_start_byte: pending_conflict.ours_start_byte,
			ours_end_byte:   pending_conflict.ours_end_byte,
		});
	}

	conflict_meta
}

fn source_lines(source: &str) -> Vec<&str> {
	if source.is_empty() {
		Vec::new()
	} else {
		source.split_inclusive('\n').collect()
	}
}

fn strip_line_ending(line: &str) -> &str {
	line.trim_end_matches(['\n', '\r'])
}

fn marker_label(line: &str, prefix: &str) -> Option<String> {
	let stripped = strip_line_ending(line);
	let remainder = stripped.strip_prefix(prefix)?;
	Some(remainder.trim_start().to_owned())
}

fn is_marker_line(line: &str, prefix: &str) -> bool {
	strip_line_ending(line).starts_with(prefix)
}

fn join_lines(lines: &[&str]) -> String {
	let mut joined = String::new();
	for line in lines {
		joined.push_str(line);
	}
	joined
}

const fn content_line_range(start_index: usize, end_index: usize) -> (usize, usize) {
	if start_index < end_index {
		(start_index + 1, end_index)
	} else {
		(start_index + 1, start_index)
	}
}

fn push_marker_line(out: &mut String, marker: &str, label: Option<&str>) {
	out.push_str(marker);
	if let Some(label) = label
		&& !label.is_empty()
	{
		out.push(' ');
		out.push_str(label);
	}
	out.push('\n');
}

fn push_conflict_content(out: &mut String, content: &str) {
	out.push_str(content);
	if !content.is_empty() && !content.ends_with('\n') {
		out.push('\n');
	}
}

fn find_innermost_parent_path(tree: &ChunkTree, start: usize, end: usize) -> Option<String> {
	tree
		.chunks
		.iter()
		.filter(|chunk| {
			(chunk.start_byte as usize) <= start
				&& end <= (chunk.end_byte as usize)
				&& (chunk.end_byte as usize).saturating_sub(chunk.start_byte as usize)
					>= end.saturating_sub(start)
		})
		.min_by_key(|chunk| {
			(
				(chunk.end_byte as usize).saturating_sub(chunk.start_byte as usize),
				chunk.path.split('.').count(),
			)
		})
		.map(|chunk| chunk.path.clone())
}

fn next_conflict_path(
	parent_path: &str,
	counters: &mut HashMap<String, usize>,
	existing_paths: &HashSet<String>,
) -> String {
	let key = parent_path.to_owned();
	let next = counters.entry(key).or_insert(1);
	loop {
		let leaf = format!("conflict_{next}");
		let path = if parent_path.is_empty() {
			leaf
		} else {
			format!("{parent_path}.{leaf}")
		};
		*next += 1;
		if !existing_paths.contains(path.as_str()) {
			return path;
		}
	}
}

fn insert_conflict_child(
	tree: &mut ChunkTree,
	parent_path: &str,
	conflict_path: &str,
	ours_start_byte: usize,
	ours_end_byte: usize,
) {
	let Some(parent_index) = tree
		.chunks
		.iter()
		.position(|chunk| chunk.path == parent_path)
	else {
		return;
	};
	let current_children = tree.chunks[parent_index].children.clone();
	let mut updated_children = Vec::with_capacity(current_children.len() + 1);
	let mut inserted = false;

	for child_path in current_children {
		let Some(child) = tree.chunks.iter().find(|chunk| chunk.path == child_path) else {
			continue;
		};
		let child_start = child.start_byte as usize;
		let child_end = child.end_byte as usize;
		let overlaps = child_start < ours_end_byte && ours_start_byte < child_end;
		if overlaps {
			continue;
		}
		if !inserted && child_start > ours_start_byte {
			updated_children.push(conflict_path.to_owned());
			inserted = true;
		}
		updated_children.push(child_path);
	}

	if !inserted {
		updated_children.push(conflict_path.to_owned());
	}

	tree.chunks[parent_index]
		.children
		.clone_from(&updated_children);
	if parent_path.is_empty() {
		tree.root_children = updated_children;
	}
}

fn byte_to_line(line_starts: &[usize], byte: usize) -> u32 {
	if line_starts.is_empty() {
		return 0;
	}
	line_starts.partition_point(|offset| *offset <= byte) as u32
}

fn real_line_stats(line_starts: &[usize], start: usize, end: usize) -> (u32, u32, u32) {
	if start == end {
		let line = byte_to_line(line_starts, start);
		return (line, line, 0);
	}
	let start_line = byte_to_line(line_starts, start);
	let end_line = byte_to_line(line_starts, end.saturating_sub(1));
	let line_count = if end_line >= start_line {
		end_line - start_line + 1
	} else {
		0
	};
	(start_line, end_line, line_count)
}

fn display_line_count(content: &str) -> usize {
	if content.is_empty() {
		0
	} else if content.ends_with('\n') {
		content.split_terminator('\n').count()
	} else {
		total_line_count(content)
	}
}

fn conflict_parent_path(path: &str) -> Option<String> {
	match path.rsplit_once('.') {
		Some((parent, _)) => Some(parent.to_owned()),
		None if !path.is_empty() => Some(String::new()),
		None => None,
	}
}

#[cfg(test)]
mod tests {
	use std::collections::HashMap;

	use super::*;
	use crate::chunk::state::ConflictMeta;

	#[test]
	fn detects_standard_and_diff3_conflicts() {
		let source = "\
one\n<<<<<<< HEAD\nours\n||||||| base\nbase\n=======\ntheirs\n>>>>>>> topic\ntwo\n<<<<<<< \
		              HEAD\nx\n=======\ny\n>>>>>>> other\n";
		let conflicts = detect_conflicts(source);
		assert_eq!(conflicts.len(), 2);
		assert_eq!(conflicts[0].ours_content, "ours\n");
		assert_eq!(conflicts[0].theirs_content, "theirs\n");
		assert_eq!(conflicts[0].base_content.as_deref(), Some("base\n"));
		assert_eq!(conflicts[0].base_label.as_deref(), Some("base"));
		assert_eq!(conflicts[1].ours_content, "x\n");
		assert_eq!(conflicts[1].theirs_content, "y\n");
		assert!(conflicts[1].base_content.is_none());
	}

	#[test]
	fn accept_ours_returns_clean_source_and_byte_ranges() {
		let source = "\
fn a() {\n<<<<<<< HEAD\n\treturn foo();\n=======\n\treturn bar();\n>>>>>>> topic\n}\n";
		let conflicts = detect_conflicts(source);
		let clean = accept_ours(source, &conflicts);
		assert_eq!(clean.source, "fn a() {\n\treturn foo();\n}\n");
		assert_eq!(clean.ours_byte_ranges, vec![(9, 24)]);
	}

	#[test]
	fn reconstructs_conflict_markers_from_clean_source() {
		let clean_source = "fn a() {\n\treturn foo();\n}\n";
		let mut conflict_meta = HashMap::new();
		conflict_meta.insert("fn_a.conflict_1".to_owned(), ConflictMeta {
			theirs_content:  "\treturn bar();\n".to_owned(),
			ours_label:      "HEAD".to_owned(),
			theirs_label:    "topic".to_owned(),
			base_content:    Some("\treturn baz();\n".to_owned()),
			base_label:      Some("base".to_owned()),
			ours_start_byte: 9,
			ours_end_byte:   24,
		});

		let reconstructed = reconstruct_markers(clean_source, &conflict_meta);
		assert_eq!(
			reconstructed,
			"fn a() {\n<<<<<<< HEAD\n\treturn foo();\n||||||| base\n\treturn \
			 baz();\n=======\n\treturn bar();\n>>>>>>> topic\n}\n",
		);
	}
}
