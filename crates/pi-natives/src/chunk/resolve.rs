use std::{cmp::Ordering, collections::BTreeSet};

use crate::chunk::{
	state::ChunkStateInner,
	types::{ChunkNode, ChunkRegion, ChunkTree},
};

const CHECKSUM_ALPHABET: &str = "ZPMQVRWSNKTXJBYH";

pub struct ResolvedChunk<'a> {
	pub chunk: &'a ChunkNode,
	pub crc:   Option<String>,
}

fn parse_region_name(value: &str) -> Option<ChunkRegion> {
	match value.trim() {
		"head" => Some(ChunkRegion::Head),
		"body" => Some(ChunkRegion::Body),
		"tail" => Some(ChunkRegion::Tail),
		_ => None,
	}
}

fn is_known_region_name(value: &str) -> bool {
	matches!(value.trim(), "head" | "body" | "tail")
}

/// Split a trailing `@region` suffix from a selector. Returns the selector
/// prefix, and `Some(region)` if a region was specified. The outer `Option`
/// indicates whether an `@` was found.
pub fn split_region_suffix(selector: &str) -> (&str, bool, Option<ChunkRegion>) {
	let Some((prefix, suffix)) = selector.rsplit_once('@') else {
		return (selector, false, None);
	};
	if !is_known_region_name(suffix.trim()) {
		return (selector, false, None);
	}
	(prefix.trim_end(), true, parse_region_name(suffix.trim()))
}

pub struct ParsedSelector {
	pub selector: Option<String>,
	pub crc:      Option<String>,
	pub region:   Option<ChunkRegion>,
}

pub fn split_selector_crc_and_region(
	selector: Option<&str>,
	crc: Option<&str>,
	region: Option<ChunkRegion>,
) -> Result<ParsedSelector, String> {
	let mut raw = selector
		.map(str::trim)
		.filter(|value| !matches!(*value, "" | "null" | "undefined"))
		.unwrap_or_default()
		.to_owned();
	if let Some(index) = chunk_read_path_separator_index(&raw) {
		raw = raw[index + 1..].to_owned();
	}

	let (without_region, parsed_region) = if raw.is_empty() {
		(raw.as_str(), None)
	} else {
		let (prefix, found, parsed_region) = split_region_suffix(raw.as_str());
		if found {
			(prefix, parsed_region)
		} else if let Some((_, suffix)) = raw.rsplit_once('@') {
			return Err(format!(
				"Unknown chunk region \"{}\". Valid regions: head, body, tail (or omit for the full \
				 chunk).",
				suffix.trim()
			));
		} else {
			(raw.as_str(), None)
		}
	};

	let mut selector_part = without_region.trim();
	let embedded_crc = if let Some((prefix, suffix)) = selector_part.rsplit_once('#') {
		if is_checksum_token(suffix.trim()) {
			selector_part = prefix.trim_end();
			sanitize_crc(Some(suffix))
		} else {
			None
		}
	} else if let Some(suffix) = selector_part.strip_prefix('#') {
		if is_checksum_token(suffix.trim()) {
			selector_part = "";
			sanitize_crc(Some(suffix))
		} else {
			None
		}
	} else if is_checksum_token(selector_part) {
		let cleaned = sanitize_crc(Some(selector_part));
		selector_part = "";
		cleaned
	} else {
		None
	};

	let cleaned_selector = if selector_part.is_empty() {
		None
	} else {
		Some(selector_part.to_owned())
	};
	let cleaned_crc = sanitize_crc(crc).or(embedded_crc);
	let region = region.or(parsed_region);

	if let Some(cleaned_selector) = cleaned_selector.as_deref()
		&& cleaned_crc.is_some()
		&& looks_like_file_target(cleaned_selector)
	{
		return Ok(ParsedSelector { selector: None, crc: cleaned_crc, region });
	}

	Ok(ParsedSelector { selector: cleaned_selector, crc: cleaned_crc, region })
}

pub fn sanitize_chunk_selector(selector: Option<&str>) -> Option<String> {
	split_selector_crc_and_region(selector, None, None)
		.ok()
		.and_then(|parsed| parsed.selector)
}

pub fn sanitize_crc(crc: Option<&str>) -> Option<String> {
	let value = crc?.trim();
	if matches!(value, "" | "null" | "undefined") {
		None
	} else {
		Some(value.to_ascii_uppercase())
	}
}

pub fn resolve_chunk_selector<'a>(
	state: &'a ChunkStateInner,
	selector: Option<&str>,
	warnings: &mut Vec<String>,
) -> Result<&'a ChunkNode, String> {
	let ParsedSelector { selector: cleaned_selector, crc: cleaned_crc, .. } =
		split_selector_crc_and_region(selector, None, None)?;
	resolve_chunk_selector_impl(state, cleaned_selector.as_deref(), cleaned_crc.as_deref(), warnings)
}

pub fn resolve_chunk_with_crc<'a>(
	state: &'a ChunkStateInner,
	selector: Option<&str>,
	crc: Option<&str>,
	warnings: &mut Vec<String>,
) -> Result<ResolvedChunk<'a>, String> {
	let ParsedSelector { selector: cleaned_selector, crc: cleaned_crc, .. } =
		split_selector_crc_and_region(selector, crc, None)?;

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

pub fn chunk_region_range(chunk: &ChunkNode, region: ChunkRegion) -> (usize, usize) {
	let start = chunk.start_byte as usize;
	let end = chunk.end_byte as usize;
	let pro_end = chunk.prologue_end_byte.map_or(start, |b| b as usize);
	let epi_start = chunk.epilogue_start_byte.map_or(end, |b| b as usize);
	match region {
		ChunkRegion::Head => (start, pro_end),
		ChunkRegion::Body => (pro_end, epi_start),
		ChunkRegion::Tail => (epi_start, end),
	}
}

pub fn format_region_ref(chunk: &ChunkNode, region: Option<ChunkRegion>) -> String {
	let suffix = region.map_or(String::new(), |r| format!("@{}", r.as_str()));
	if chunk.path.is_empty() {
		format!("<root>#{}{suffix}", chunk.checksum)
	} else {
		format!("{}#{}{suffix}", chunk.path, chunk.checksum)
	}
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
		if let Some(line) = parse_line_number(cleaned)
			&& let Some(chunk_path) = crate::chunk::line_to_chunk_path(state.tree(), line)
		{
			warnings
				.push(format!("Auto-resolved line target \"{cleaned}\" to chunk \"{chunk_path}\"."));
			return resolve_chunk_selector_impl(state, Some(&chunk_path), crc, warnings);
		}
		return Err(format!(
			"Line target \"{cleaned}\" does not fall inside any chunk. Use chunk paths like \
			 fn_foo#ABCD instead, or run read(sel=\"?\") to list available chunks."
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
		let prefixed_matches = collect_unique_matches(state.tree.chunks.iter().filter(|chunk| {
			if chunk.path.is_empty() {
				return false;
			}
			let leaf = chunk.path.rsplit('.').next().unwrap_or(chunk.path.as_str());
			let expected = chunk.kind.path_segment(Some(cleaned));
			leaf == expected || leaf == cleaned
		}));
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
					|| segment
						.split_once('_')
						.is_some_and(|(prefix, identifier)| prefix == *kind || identifier == *kind)
			})
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

/// Extract the start line number from a line selector like `L89` or `L24-L27`.
fn parse_line_number(selector: &str) -> Option<u32> {
	let rest = selector.strip_prefix('L')?;
	let digits = rest.split('-').next().unwrap_or(rest);
	digits.parse::<u32>().ok()
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
	use crate::chunk::kind::ChunkKind;

	fn chunk(
		path: &str,
		checksum: &str,
		parent_path: Option<&str>,
		children: Vec<&str>,
	) -> ChunkNode {
		let leaf = path.rsplit('.').next().unwrap_or(path);
		let kind = match leaf.split_once('_').map_or(leaf, |(prefix, _)| prefix) {
			"fn" => ChunkKind::Function,
			"class" => ChunkKind::Class,
			"try" => ChunkKind::Try,
			_ => ChunkKind::Chunk,
		};
		ChunkNode {
			path: path.to_owned(),
			identifier: leaf
				.split_once('_')
				.and_then(|(_, identifier)| (!identifier.is_empty()).then_some(identifier.to_owned())),
			kind,
			leaf: children.is_empty(),
			parent_path: parent_path.map(str::to_owned),
			children: children.into_iter().map(str::to_owned).collect(),
			signature: None,
			start_line: 1,
			end_line: 1,
			line_count: 1,
			start_byte: 0,
			end_byte: 0,
			checksum_start_byte: 0,
			prologue_end_byte: None,
			epilogue_start_byte: None,
			checksum: checksum.to_owned(),
			error: false,
			indent: 0,
			indent_char: " ".to_owned(),
			group: false,
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
