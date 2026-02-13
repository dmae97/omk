//! Fuzzy file path discovery for autocomplete and @-mention resolution.
//!
//! Searches for files and directories whose paths match a query string via
//! subsequence scoring. Uses the shared [`fs_cache`] for directory scanning.

use std::path::Path;

use napi::bindgen_prelude::*;
use napi_derive::napi;

use crate::{fs_cache, task};

// ═══════════════════════════════════════════════════════════════════════════
// Public types
// ═══════════════════════════════════════════════════════════════════════════

/// Options for fuzzy file path search.
#[napi(object)]
pub struct FuzzyFindOptions<'env> {
	/// Fuzzy query to match against file paths (case-insensitive).
	pub query:       String,
	/// Directory to search.
	pub path:        String,
	/// Include hidden files (default: false).
	pub hidden:      Option<bool>,
	/// Respect .gitignore (default: true).
	pub gitignore:   Option<bool>,
	/// Enable shared filesystem scan cache (default: false).
	pub cache:       Option<bool>,
	/// Maximum number of matches to return (default: 100).
	#[napi(js_name = "maxResults")]
	pub max_results: Option<u32>,
	/// Abort signal for cancelling the operation.
	pub signal:      Option<Unknown<'env>>,
	/// Timeout in milliseconds for the operation.
	#[napi(js_name = "timeoutMs")]
	pub timeout_ms:  Option<u32>,
}

/// A single match in fuzzy find results.
#[napi(object)]
pub struct FuzzyFindMatch {
	/// Relative path from the search root (uses `/` separators).
	pub path:         String,
	/// Whether this entry is a directory.
	#[napi(js_name = "isDirectory")]
	pub is_directory: bool,
	/// Match quality score (higher is better).
	pub score:        u32,
}

/// Result of fuzzy file path search.
#[napi(object)]
pub struct FuzzyFindResult {
	/// Matched entries (up to `maxResults`).
	pub matches:       Vec<FuzzyFindMatch>,
	/// Total number of matches found (may exceed `matches.len()`).
	#[napi(js_name = "totalMatches")]
	pub total_matches: u32,
}

// ═══════════════════════════════════════════════════════════════════════════
// Scoring
// ═══════════════════════════════════════════════════════════════════════════

/// Strips separators, whitespace, and punctuation for normalized fuzzy
/// comparison.
fn normalize_fuzzy_text(value: &str) -> String {
	value
		.chars()
		.filter(|ch| !ch.is_whitespace() && !matches!(ch, '/' | '\\' | '.' | '_' | '-'))
		.flat_map(|ch| ch.to_lowercase())
		.collect()
}

/// Scores a query as a subsequence of `target`. Returns 0 if not a subsequence.
fn fuzzy_subsequence_score(query: &str, target: &str) -> u32 {
	let query_chars: Vec<char> = query.chars().collect();
	if query_chars.is_empty() {
		return 1;
	}
	let mut query_index = 0usize;
	let mut gaps = 0u32;
	let mut last_match_index: Option<usize> = None;
	for (target_index, target_ch) in target.chars().enumerate() {
		if query_index >= query_chars.len() {
			break;
		}
		if query_chars[query_index] == target_ch {
			if let Some(last_index) = last_match_index
				&& target_index > last_index + 1
			{
				gaps = gaps.saturating_add(1);
			}
			last_match_index = Some(target_index);
			query_index += 1;
		}
	}
	if query_index != query_chars.len() {
		return 0;
	}
	let gap_penalty = gaps.saturating_mul(5);
	40u32.saturating_sub(gap_penalty).max(1)
}

/// Composite path scoring: exact > starts-with > contains > fuzzy subsequence.
fn score_fuzzy_path(
	path: &str,
	is_directory: bool,
	query_lower: &str,
	normalized_query: &str,
) -> u32 {
	let lower_path = path.to_lowercase();
	let normalized_path = normalize_fuzzy_text(path);
	let file_name_source = path.trim_end_matches('/');
	let file_name = Path::new(file_name_source)
		.file_name()
		.and_then(|name| name.to_str())
		.unwrap_or(file_name_source);
	let lower_file_name = file_name.to_lowercase();
	let normalized_file_name = normalize_fuzzy_text(file_name);

	let mut score = if query_lower.is_empty() {
		1
	} else if lower_file_name == query_lower {
		120
	} else if lower_file_name.starts_with(query_lower) {
		100
	} else if lower_file_name.contains(query_lower) {
		80
	} else if lower_path.contains(query_lower) {
		60
	} else {
		let file_name_fuzzy = fuzzy_subsequence_score(normalized_query, &normalized_file_name);
		if file_name_fuzzy > 0 {
			50 + file_name_fuzzy
		} else {
			let path_fuzzy = fuzzy_subsequence_score(normalized_query, &normalized_path);
			if path_fuzzy > 0 { 30 + path_fuzzy } else { 0 }
		}
	};

	if is_directory && score > 0 {
		score += 10;
	}

	score
}

// ═══════════════════════════════════════════════════════════════════════════
// Execution
// ═══════════════════════════════════════════════════════════════════════════

/// Internal configuration for fuzzy find, extracted from options.
struct FuzzyFindConfig {
	query:       String,
	path:        String,
	hidden:      Option<bool>,
	gitignore:   Option<bool>,
	max_results: Option<u32>,
	cache:       Option<bool>,
}

fn clamp_u32(value: u64) -> u32 {
	value.min(u32::MAX as u64) as u32
}

fn fuzzy_find_sync(config: FuzzyFindConfig, ct: task::CancelToken) -> Result<FuzzyFindResult> {
	let root = fs_cache::resolve_search_path(&config.path)?;
	let include_hidden = config.hidden.unwrap_or(false);
	let respect_gitignore = config.gitignore.unwrap_or(true);
	let max_results = config.max_results.unwrap_or(100) as usize;
	if max_results == 0 {
		return Ok(FuzzyFindResult { matches: Vec::new(), total_matches: 0 });
	}

	let query_lower = config.query.trim().to_lowercase();
	let normalized_query = normalize_fuzzy_text(&query_lower);
	if !query_lower.is_empty() && normalized_query.is_empty() {
		return Ok(FuzzyFindResult { matches: Vec::new(), total_matches: 0 });
	}

	let use_cache = config.cache.unwrap_or(false);
	let mut scored = if use_cache {
		let scan = fs_cache::get_or_scan(&root, include_hidden, respect_gitignore, &ct)?;
		let mut scored = score_entries(&scan.entries, &query_lower, &normalized_query, &ct)?;
		// Empty-result recheck: if the query was non-trivial but produced zero matches
		// from a cached scan that's old enough, force one rescan before giving up.
		if scored.is_empty()
			&& !query_lower.is_empty()
			&& scan.cache_age_ms >= fs_cache::empty_recheck_ms()
		{
			let fresh = fs_cache::force_rescan(&root, include_hidden, respect_gitignore, true, &ct)?;
			scored = score_entries(&fresh, &query_lower, &normalized_query, &ct)?;
		}
		scored
	} else {
		let fresh = fs_cache::force_rescan(&root, include_hidden, respect_gitignore, false, &ct)?;
		score_entries(&fresh, &query_lower, &normalized_query, &ct)?
	};

	scored.sort_by(|a, b| b.score.cmp(&a.score).then_with(|| a.path.cmp(&b.path)));
	let total_matches = clamp_u32(scored.len() as u64);
	let matches = scored.into_iter().take(max_results).collect();
	Ok(FuzzyFindResult { matches, total_matches })
}

/// Score all entries against the query, returning only those with score > 0.
fn score_entries(
	entries: &[fs_cache::GlobMatch],
	query_lower: &str,
	normalized_query: &str,
	ct: &task::CancelToken,
) -> Result<Vec<FuzzyFindMatch>> {
	let mut scored = Vec::new();
	for entry in entries {
		ct.heartbeat()?;
		if entry.file_type == fs_cache::FileType::Symlink {
			continue;
		}

		let is_directory = entry.file_type == fs_cache::FileType::Dir;
		let path = if is_directory {
			format!("{}/", entry.path)
		} else {
			entry.path.clone()
		};
		let score = score_fuzzy_path(&path, is_directory, query_lower, normalized_query);
		if score == 0 {
			continue;
		}

		scored.push(FuzzyFindMatch { path, is_directory, score });
	}
	Ok(scored)
}

/// Fuzzy file path search for autocomplete.
///
/// # Arguments
/// - `options`: Query string, root path, and limits.
///
/// # Returns
/// Matching file and directory entries sorted by match quality.
#[napi(js_name = "fuzzyFind")]
pub fn fuzzy_find(options: FuzzyFindOptions<'_>) -> task::Async<FuzzyFindResult> {
	let FuzzyFindOptions { query, path, hidden, gitignore, cache, max_results, timeout_ms, signal } =
		options;
	let ct = task::CancelToken::new(timeout_ms, signal);
	let config = FuzzyFindConfig { query, path, hidden, gitignore, max_results, cache };
	task::blocking("fuzzy_find", ct, move |ct| fuzzy_find_sync(config, ct))
}
