use std::{cmp::Ordering, collections::BTreeSet};

use crate::chunk::{
	state::ChunkStateInner,
	types::{ChunkNode, ChunkTree},
};

const CHUNK_NAME_PREFIXES: &[&str] =
	&["fn_", "var_", "class_", "stmts_", "type_", "interface_", "enum_", "const_"];
const CHECKSUM_ALPHABET: &str = "ZPMQVRWSNKTXJBYH";

pub struct ResolvedChunk<'a> {
	pub chunk: &'a ChunkNode,
	pub crc:   Option<String>,
}

pub fn sanitize_chunk_selector(selector: Option<&str>) -> Option<String> {
	let mut value = selector?.trim().to_owned();
	if matches!(value.as_str(), "null" | "undefined") {
		return None;
	}

	if let Some(index) = chunk_read_path_separator_index(&value) {
		value = value[index + 1..].to_owned();
	}

	let value = strip_trailing_checksum(&value).trim();
	if value.is_empty() {
		None
	} else {
		Some(value.to_owned())
	}
}

pub fn sanitize_crc(crc: Option<&str>) -> Option<String> {
	let value = crc?.trim();
	if matches!(value, "" | "null" | "undefined") {
		None
	} else {
		Some(value.to_ascii_uppercase())
	}
}

pub fn split_selector_and_crc(
	selector: Option<&str>,
	crc: Option<&str>,
) -> (Option<String>, Option<String>) {
	let cleaned_selector = sanitize_chunk_selector(selector);
	let selector_crc = selector.and_then(extract_crc_token);
	let cleaned_crc = sanitize_crc(crc).or(selector_crc);

	if cleaned_selector.is_none()
		&& let Some(selector) = selector
		&& let Some(raw) = selector_after_read_path(selector)
		&& let Some(raw_crc) = raw
			.strip_prefix('#')
			.or_else(|| is_checksum_token(raw).then_some(raw))
	{
		return (None, sanitize_crc(Some(raw_crc)).or(cleaned_crc));
	}

	if let Some(cleaned_selector) = cleaned_selector.as_deref()
		&& cleaned_crc.is_some()
		&& looks_like_file_target(cleaned_selector)
	{
		return (None, cleaned_crc);
	}

	if cleaned_selector.is_some() {
		(cleaned_selector, cleaned_crc)
	} else {
		(None, cleaned_crc)
	}
}

pub fn resolve_chunk_selector<'a>(
	state: &'a ChunkStateInner,
	selector: Option<&str>,
	warnings: &mut Vec<String>,
) -> Result<&'a ChunkNode, String> {
	let (cleaned_selector, cleaned_crc) = split_selector_and_crc(selector, None);
	resolve_chunk_selector_impl(state, cleaned_selector.as_deref(), cleaned_crc.as_deref(), warnings)
}

pub fn resolve_chunk_with_crc<'a>(
	state: &'a ChunkStateInner,
	selector: Option<&str>,
	crc: Option<&str>,
	warnings: &mut Vec<String>,
) -> Result<ResolvedChunk<'a>, String> {
	let (cleaned_selector, cleaned_crc) = split_selector_and_crc(selector, crc);

	if cleaned_selector.is_none()
		&& let Some(cleaned_crc) = cleaned_crc.clone()
	{
		let chunk = resolve_chunk_by_checksum(state, &cleaned_crc)?;
		return Ok(ResolvedChunk { chunk, crc: Some(cleaned_crc) });
	}

	let chunk = resolve_chunk_selector_impl(state, cleaned_selector.as_deref(), None, warnings)?;
	Ok(ResolvedChunk { chunk, crc: cleaned_crc })
}

pub fn resolve_chunk_by_checksum<'a>(
	state: &'a ChunkStateInner,
	crc: &str,
) -> Result<&'a ChunkNode, String> {
	let cleaned_crc = sanitize_crc(Some(crc)).ok_or_else(|| "Checksum is required".to_owned())?;
	let matches = state.chunks_by_checksum(&cleaned_crc);
	match matches.len() {
		0 => Err(format!(
			"Checksum \"{cleaned_crc}\" did not match any chunk. Re-read the file to get current \
			 checksums."
		)),
		1 => Ok(matches[0]),
		_ => Err(format!(
			"Ambiguous checksum \"{cleaned_crc}\" matches {} chunks: {}. Provide sel to disambiguate.",
			matches.len(),
			matches
				.iter()
				.map(|chunk| format_node_ref(chunk))
				.collect::<Vec<_>>()
				.join(", "),
		)),
	}
}

fn root_chunk(state: &ChunkStateInner) -> Result<&ChunkNode, String> {
	state
		.chunk("")
		.ok_or_else(|| "Chunk tree is missing the root chunk".to_owned())
}

fn resolve_chunk_selector_impl<'a>(
	state: &'a ChunkStateInner,
	selector: Option<&str>,
	crc: Option<&str>,
	warnings: &mut Vec<String>,
) -> Result<&'a ChunkNode, String> {
	let Some(cleaned) = selector else {
		return root_chunk(state);
	};

	if is_line_number_selector(cleaned) {
		return Err(format!(
			"Line-number targets are not supported in chunk mode. Use chunk paths like fn_foo#ABCD \
			 instead of \"{cleaned}\"."
		));
	}

	if let Some(chunk) = state.chunk(cleaned) {
		return match_crc_filter(cleaned, vec![chunk], crc);
	}

	if is_checksum_token(cleaned) {
		let matches = state.chunks_by_checksum(cleaned);
		if !matches.is_empty() {
			return resolve_matches(
				matches,
				cleaned,
				crc,
				warnings,
				"checksum selector",
				"Auto-resolved checksum selector",
			);
		}
	}

	let suffix_matches = state.chunks_by_suffix(cleaned);
	if !suffix_matches.is_empty() {
		return resolve_matches(
			suffix_matches,
			cleaned,
			crc,
			warnings,
			"chunk selector",
			"Auto-resolved chunk selector",
		);
	}

	if !cleaned.contains('.') {
		let prefixed = CHUNK_NAME_PREFIXES
			.iter()
			.map(|prefix| format!("{prefix}{cleaned}"))
			.collect::<Vec<_>>();
		let prefixed_matches =
			collect_unique_matches(prefixed.iter().flat_map(|name| state.chunks_by_leaf(name)));
		if !prefixed_matches.is_empty() {
			return resolve_matches(
				prefixed_matches,
				cleaned,
				crc,
				warnings,
				"chunk selector",
				"Auto-resolved chunk selector",
			);
		}
	}

	let kind_segments = cleaned.split('.').collect::<Vec<_>>();
	let kind_candidates = collect_unique_matches(
		state
			.chunks_by_leaf(kind_segments.last().copied().unwrap_or(cleaned))
			.into_iter()
			.filter(|candidate| kind_path_matches(candidate, &kind_segments)),
	);
	if !kind_candidates.is_empty() {
		return resolve_matches(
			kind_candidates,
			cleaned,
			crc,
			warnings,
			"kind selector",
			"Auto-resolved kind selector",
		);
	}

	Err(build_not_found_error(state.tree(), cleaned))
}

fn match_crc_filter<'a>(
	cleaned: &str,
	matches: Vec<&'a ChunkNode>,
	crc: Option<&str>,
) -> Result<&'a ChunkNode, String> {
	let Some(cleaned_crc) = crc else {
		return Ok(matches[0]);
	};
	let filtered = filter_by_crc(&matches, cleaned_crc);
	match filtered.len() {
		1 => Ok(filtered[0]),
		0 => {
			let actual = matches
				.iter()
				.map(|chunk| format_node_ref(chunk))
				.collect::<Vec<_>>()
				.join(", ");
			Err(format!("Stale checksum \"{cleaned_crc}\" for \"{cleaned}\". Current: {actual}."))
		},
		_ => Err(format!(
			"Ambiguous chunk selector \"{cleaned}\" with checksum \"{cleaned_crc}\" matches {} \
			 chunks: {}. Use the full path from read output.",
			filtered.len(),
			filtered
				.iter()
				.map(|chunk| format_node_ref(chunk))
				.collect::<Vec<_>>()
				.join(", "),
		)),
	}
}

fn resolve_matches<'a>(
	matches: Vec<&'a ChunkNode>,
	cleaned: &str,
	crc: Option<&str>,
	warnings: &mut Vec<String>,
	selector_label: &str,
	warning_label: &str,
) -> Result<&'a ChunkNode, String> {
	let matches = if let Some(cleaned_crc) = crc {
		let filtered = filter_by_crc(&matches, cleaned_crc);
		if filtered.is_empty() {
			let actual = matches
				.iter()
				.map(|chunk| format_node_ref(chunk))
				.collect::<Vec<_>>()
				.join(", ");
			return Err(format!(
				"Stale checksum \"{cleaned_crc}\" for {selector_label} \"{cleaned}\". Current: \
				 {actual}."
			));
		}
		filtered
	} else {
		matches
	};
	let outermost = retain_outermost_matches(matches);
	resolve_unique_chunks(outermost, cleaned, warnings, selector_label, warning_label)?.ok_or_else(
		|| {
			format!(
				"{selector_label} \"{cleaned}\" did not match any chunk. Re-read the file to see \
				 available chunk paths."
			)
		},
	)
}

fn filter_by_crc<'a>(matches: &[&'a ChunkNode], crc: &str) -> Vec<&'a ChunkNode> {
	matches
		.iter()
		.filter(|chunk| chunk.checksum == crc)
		.copied()
		.collect()
}

fn collect_unique_matches<'a>(
	matches: impl IntoIterator<Item = &'a ChunkNode>,
) -> Vec<&'a ChunkNode> {
	let mut seen = BTreeSet::new();
	let mut out = Vec::new();
	for chunk in matches {
		if chunk.path.is_empty() || !seen.insert(chunk.path.as_str()) {
			continue;
		}
		out.push(chunk);
	}
	out
}

fn retain_outermost_matches(matches: Vec<&ChunkNode>) -> Vec<&ChunkNode> {
	let Some(min_depth) = matches
		.iter()
		.map(|chunk| chunk.path.split('.').count())
		.min()
	else {
		return matches;
	};
	matches
		.into_iter()
		.filter(|chunk| chunk.path.split('.').count() == min_depth)
		.collect()
}

fn resolve_unique_chunks<'a>(
	matches: Vec<&'a ChunkNode>,
	cleaned: &str,
	warnings: &mut Vec<String>,
	selector_label: &str,
	warning_label: &str,
) -> Result<Option<&'a ChunkNode>, String> {
	match matches.len() {
		0 => Ok(None),
		1 => {
			warnings.push(format!(
				"{warning_label} \"{cleaned}\" to \"{}\". Use the full path from read output.",
				format_node_ref(matches[0])
			));
			Ok(Some(matches[0]))
		},
		_ => Err(format!(
			"Ambiguous {selector_label} \"{cleaned}\" matches {} chunks: {}. Use the full path from \
			 read output.",
			matches.len(),
			matches
				.iter()
				.map(|chunk| format_node_ref(chunk))
				.collect::<Vec<_>>()
				.join(", "),
		)),
	}
}

fn kind_path_matches(candidate: &ChunkNode, kind_segments: &[&str]) -> bool {
	if candidate.path.is_empty() {
		return false;
	}
	let path_segments = candidate.path.split('.').collect::<Vec<_>>();
	path_segments.len() == kind_segments.len()
		&& kind_segments
			.iter()
			.zip(path_segments)
			.all(|(kind, segment)| {
				segment == *kind
					|| segment.starts_with(&format!("{kind}_"))
					|| strip_known_chunk_prefix(segment) == Some(*kind)
			})
}

fn strip_known_chunk_prefix(segment: &str) -> Option<&str> {
	CHUNK_NAME_PREFIXES
		.iter()
		.find_map(|prefix| segment.strip_prefix(prefix))
}

/// Format a chunk path with its CRC suffix, e.g. `fn_start#ABCD`.
fn format_chunk_ref(tree: &ChunkTree, path: &str) -> String {
	if let Some(chunk) = find_chunk_by_path(tree, path) {
		format!("{}#{}", path, chunk.checksum)
	} else {
		path.to_owned()
	}
}

/// Format a `ChunkNode` as `path#CRC`.
fn format_node_ref(chunk: &ChunkNode) -> String {
	if chunk.path.is_empty() {
		format!("<root>#{}", chunk.checksum)
	} else {
		format!("{}#{}", chunk.path, chunk.checksum)
	}
}

fn build_not_found_error(tree: &ChunkTree, cleaned: &str) -> String {
	let (direct_children_parent, direct_children, matched_empty_prefix) =
		matching_prefix_context(tree, cleaned);
	let available_paths = tree
		.chunks
		.iter()
		.filter(|chunk| !chunk.path.is_empty() && !chunk.path.contains('.'))
		.map(format_node_ref)
		.collect::<Vec<_>>();
	let similarity = suggest_chunk_paths(tree, cleaned, 8);

	let hint = if let Some(parent) = direct_children_parent {
		let children_with_crc = direct_children
			.iter()
			.map(|child| format_chunk_ref(tree, child))
			.collect::<Vec<_>>()
			.join(", ");
		format!(" Direct children of \"{parent}\": {children_with_crc}.")
	} else if let Some(prefix) = matched_empty_prefix {
		if similarity.is_empty() {
			format!(" The prefix \"{prefix}\" exists but has no child chunks.")
		} else {
			format!(
				" The prefix \"{prefix}\" exists but has no child chunks. Similar paths: {}.",
				similarity.join(", ")
			)
		}
	} else if !similarity.is_empty() {
		format!(" Similar paths: {}.", similarity.join(", "))
	} else if !available_paths.is_empty() {
		format!(" Available top-level chunks: {}.", available_paths.join(", "))
	} else {
		" Re-read the file to see available chunk paths.".to_owned()
	};

	format!(
		"Chunk path not found: \"{cleaned}\".{hint} Re-read the file to see the full chunk tree \
		 with paths and checksums."
	)
}

fn matching_prefix_context(
	tree: &ChunkTree,
	cleaned: &str,
) -> (Option<String>, Vec<String>, Option<String>) {
	let mut direct_children = None;
	let mut direct_children_parent = None;
	let mut matched_empty_prefix = None;

	if cleaned.contains('.') {
		let parts = cleaned.split('.').collect::<Vec<_>>();
		for index in (1..parts.len()).rev() {
			let prefix = parts[..index].join(".");
			let Some(parent) = find_chunk_by_path(tree, &prefix) else {
				continue;
			};
			if !parent.children.is_empty() {
				let mut children = parent.children.clone();
				children.sort();
				direct_children_parent = Some(prefix);
				direct_children = Some(children);
				break;
			}
			if matched_empty_prefix.is_none() {
				matched_empty_prefix = Some(prefix);
			}
		}
	}

	(direct_children_parent, direct_children.unwrap_or_default(), matched_empty_prefix)
}

fn suggest_chunk_paths(tree: &ChunkTree, query: &str, limit: usize) -> Vec<String> {
	let mut scored = tree
		.chunks
		.iter()
		.filter(|chunk| !chunk.path.is_empty())
		.map(|chunk| (&chunk.path, &chunk.checksum, chunk_path_similarity(query, &chunk.path)))
		.filter(|(_, _, score)| *score > 0.1)
		.collect::<Vec<_>>();
	scored.sort_by(|left, right| {
		right
			.2
			.partial_cmp(&left.2)
			.unwrap_or(Ordering::Equal)
			.then_with(|| left.0.cmp(right.0))
	});
	scored
		.into_iter()
		.take(limit)
		.map(|(path, checksum, _)| format!("{path}#{checksum}"))
		.collect()
}

fn chunk_path_similarity(query: &str, candidate: &str) -> f64 {
	if candidate.ends_with(query) || candidate.ends_with(&format!(".{query}")) {
		return 0.9;
	}

	let query_leaf = query.rsplit('.').next().unwrap_or(query);
	let candidate_leaf = candidate.rsplit('.').next().unwrap_or(candidate);
	if query_leaf == candidate_leaf {
		return 0.85;
	}

	if candidate.contains(query) || query.contains(candidate) {
		return 0.6;
	}

	let query_parts = query.split('.').collect::<BTreeSet<_>>();
	let overlap = candidate
		.split('.')
		.filter(|part| query_parts.contains(part))
		.count();
	if overlap > 0 {
		0.1f64.mul_add(overlap as f64, 0.3)
	} else {
		0.0
	}
}

fn looks_like_file_target(selector: &str) -> bool {
	if selector.contains('/') || selector.contains('\\') {
		return true;
	}

	let Some((base, ext)) = selector.rsplit_once('.') else {
		return false;
	};
	!base.is_empty() && !ext.is_empty() && ext.chars().all(|ch| ch.is_ascii_alphanumeric())
}

fn is_line_number_selector(selector: &str) -> bool {
	let Some(rest) = selector.strip_prefix('L') else {
		return false;
	};
	let Some((start, end)) = rest.split_once('-') else {
		return !rest.is_empty() && rest.chars().all(|ch| ch.is_ascii_digit());
	};
	if start.is_empty() || !start.chars().all(|ch| ch.is_ascii_digit()) {
		return false;
	}
	let end = end.strip_prefix('L').unwrap_or(end);
	!end.is_empty() && end.chars().all(|ch| ch.is_ascii_digit())
}

fn strip_trailing_checksum(value: &str) -> &str {
	let Some((prefix, suffix)) = value.rsplit_once('#') else {
		return value;
	};
	if is_checksum_token(suffix) {
		prefix
	} else {
		value
	}
}

fn extract_crc_token(value: &str) -> Option<String> {
	let raw = selector_after_read_path(value)?;
	let token = raw
		.rsplit_once('#')
		.map(|(_, suffix)| suffix)
		.or_else(|| raw.strip_prefix('#'))
		.or_else(|| is_checksum_token(raw).then_some(raw))?;
	sanitize_crc(Some(token))
}

fn selector_after_read_path(value: &str) -> Option<&str> {
	chunk_read_path_separator_index(value)
		.map(|index| &value[index + 1..])
		.or(Some(value))
}

fn is_checksum_token(value: &str) -> bool {
	value.len() == 4
		&& value
			.chars()
			.all(|ch| CHECKSUM_ALPHABET.contains(ch.to_ascii_uppercase()))
}

fn find_chunk_by_path<'a>(tree: &'a ChunkTree, path: &str) -> Option<&'a ChunkNode> {
	tree.chunks.iter().find(|chunk| chunk.path == path)
}

/// Find the `:` separating a file path from a chunk selector in
/// `file.ts:chunk_path`. Skips Windows `C:\` / `C:/` drive prefixes.
fn chunk_read_path_separator_index(value: &str) -> Option<usize> {
	let bytes = value.as_bytes();
	// Skip Windows drive prefix: `C:\` or `C:/`
	let start = if bytes.len() >= 3
		&& bytes[0].is_ascii_alphabetic()
		&& bytes[1] == b':'
		&& matches!(bytes[2], b'/' | b'\\')
	{
		value[2..].find(':').map(|i| i + 2)?
	} else {
		value.find(':')?
	};
	Some(start)
}

#[cfg(test)]
mod tests {
	use super::*;

	fn chunk(
		path: &str,
		checksum: &str,
		parent_path: Option<&str>,
		children: Vec<&str>,
	) -> ChunkNode {
		ChunkNode {
			path:                path.to_owned(),
			name:                path.rsplit('.').next().unwrap_or(path).to_owned(),
			leaf:                children.is_empty(),
			parent_path:         parent_path.map(str::to_owned),
			children:            children.into_iter().map(str::to_owned).collect(),
			signature:           None,
			start_line:          1,
			end_line:            1,
			line_count:          1,
			start_byte:          0,
			end_byte:            0,
			checksum_start_byte: 0,
			body_start_byte:     None,
			body_end_byte:       None,
			checksum:            checksum.to_owned(),
			error:               false,
			indent:              0,
			indent_char:         " ".to_owned(),
			group:               false,
		}
	}

	fn state_for_resolution() -> ChunkStateInner {
		ChunkStateInner::new(String::new(), "typescript".to_owned(), ChunkTree {
			language:      "typescript".to_owned(),
			checksum:      "ROOT".to_owned(),
			line_count:    1,
			parse_errors:  0,
			fallback:      false,
			root_path:     String::new(),
			root_children: vec!["fn_handleTerraform".to_owned()],
			chunks:        vec![
				chunk("", "ROOT", None, vec!["fn_handleTerraform"]),
				chunk("fn_handleTerraform", "HVJB", Some(""), vec!["fn_handleTerraform.try"]),
				chunk("fn_handleTerraform.try", "RQPB", Some("fn_handleTerraform"), vec![
					"fn_handleTerraform.try.if_2",
				]),
				chunk("fn_handleTerraform.try.if_2", "PKPV", Some("fn_handleTerraform.try"), vec![
					"fn_handleTerraform.try.if_2.loop",
				]),
				chunk(
					"fn_handleTerraform.try.if_2.loop",
					"MZRS",
					Some("fn_handleTerraform.try.if_2"),
					vec!["fn_handleTerraform.try.if_2.loop.if_2"],
				),
				chunk(
					"fn_handleTerraform.try.if_2.loop.if_2",
					"QKJY",
					Some("fn_handleTerraform.try.if_2.loop"),
					vec![],
				),
			],
		})
	}

	#[test]
	fn resolves_requested_chunk_selector_forms() {
		let state = state_for_resolution();
		let selectors = [
			"fn_handleTerraform.try.if_2#PKPV",
			"fn_handleTerraform.try.if_2",
			"handleTerraform.try.if_2",
			"if_2",
			"if_2#PKPV",
			"#PKPV",
			"PKPV",
		];

		for selector in selectors {
			let mut warnings = Vec::new();
			let resolved = resolve_chunk_with_crc(&state, Some(selector), None, &mut warnings)
				.unwrap_or_else(|err| panic!("selector {selector} should resolve: {err}"));
			assert_eq!(resolved.chunk.path, "fn_handleTerraform.try.if_2");
		}
	}
}
