//! FFF-backed fuzzy file path discovery for autocomplete and @-mention
//! resolution.
//!
//! Uses `fff-search` as the fuzzy ranking engine. When a shared [`SearchDb`]
//! is provided, file results come from a per-root shared `FilePicker` cache;
//! directory results still come from one-shot scan entries because `fff`'s
//! picker indexes files only.

use std::{collections::HashSet, path::Path};

use fff::{FileItem, FilePicker, FuzzySearchOptions, PaginationArgs, QueryParser};
use napi::bindgen_prelude::*;
use napi_derive::napi;

use crate::{
	fs_cache,
	search_db::{SearchDb, wait_for_picker_scan},
	task,
};

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

struct RankedMatch {
	path:         String,
	is_directory: bool,
	score:        u32,
}

fn entry_file_name(path: &str) -> String {
	Path::new(path)
		.file_name()
		.and_then(|name| name.to_str())
		.unwrap_or(path)
		.to_string()
}

fn modified_seconds(mtime_ms: Option<f64>) -> u64 {
	match mtime_ms {
		Some(mtime) if mtime.is_finite() && mtime >= 0.0 => (mtime / 1000.0) as u64,
		_ => 0,
	}
}

fn build_file_items(
	root: &Path,
	entries: &[fs_cache::GlobMatch],
	include_files: bool,
	include_directories: bool,
	db: Option<&SearchDb>,
	ct: &task::CancelToken,
) -> Result<(Vec<FileItem>, HashSet<String>)> {
	let mut files = Vec::with_capacity(entries.len());
	let mut directories = HashSet::new();

	for entry in entries {
		ct.heartbeat()?;
		if entry.file_type == fs_cache::FileType::Symlink {
			continue;
		}

		let is_directory = entry.file_type == fs_cache::FileType::Dir;
		if is_directory && !include_directories {
			continue;
		}
		if !is_directory && !include_files {
			continue;
		}

		let mut relative_path = entry.path.clone();
		if is_directory {
			relative_path.push('/');
			directories.insert(relative_path.clone());
		}

		let mut item = FileItem::new_raw(
			root.join(&entry.path),
			relative_path,
			entry_file_name(&entry.path),
			0,
			modified_seconds(entry.mtime),
			None,
			false,
		);
		if !is_directory && let Some(db) = db {
			db.update_frecency_scores(&mut item);
		}
		files.push(item);
	}

	Ok((files, directories))
}

fn search_limit(max_results: usize) -> usize {
	max_results.max(50).saturating_mul(4).min(5000)
}

fn to_ranked_matches(
	results: fff::SearchResult,
	directories: &HashSet<String>,
) -> (Vec<RankedMatch>, u32) {
	let matches = results
		.items
		.into_iter()
		.zip(results.scores)
		.map(|(item, score)| RankedMatch {
			path:         item.relative_path.clone(),
			is_directory: directories.contains(&item.relative_path),
			score:        crate::utils::clamp_u32(score.total.max(0) as u64),
		})
		.collect();
	(matches, crate::utils::clamp_u32(results.total_matched as u64))
}

#[allow(clippy::too_many_arguments, reason = "search helper carries per-call filters explicitly")]
fn search_stateless_entries(
	root: &Path,
	entries: &[fs_cache::GlobMatch],
	query: &str,
	limit: usize,
	include_files: bool,
	include_directories: bool,
	db: Option<&SearchDb>,
	ct: &task::CancelToken,
) -> Result<(Vec<RankedMatch>, u32)> {
	let (items, directories) =
		build_file_items(root, entries, include_files, include_directories, db, ct)?;
	let parser = QueryParser::default();
	let parsed = parser.parse(query);
	let results = FilePicker::fuzzy_search(&items, &parsed, None, FuzzySearchOptions {
		pagination: PaginationArgs { offset: 0, limit },
		..Default::default()
	});
	Ok(to_ranked_matches(results, &directories))
}

fn search_stateful_files(
	root: &Path,
	query: &str,
	limit: usize,
	db: &SearchDb,
	ct: &task::CancelToken,
) -> Result<(Vec<RankedMatch>, u32)> {
	let shared_picker = db.get_or_init_picker(root)?;
	wait_for_picker_scan(&shared_picker, ct)?;
	let guard = shared_picker
		.read()
		.map_err(|_| Error::from_reason("shared picker lock poisoned"))?;
	let Some(picker) = guard.as_ref() else {
		return Ok((Vec::new(), 0));
	};

	let parser = QueryParser::default();
	let parsed = parser.parse(query);
	let results = FilePicker::fuzzy_search(picker.get_files(), &parsed, None, FuzzySearchOptions {
		pagination: PaginationArgs { offset: 0, limit },
		..Default::default()
	});
	Ok(to_ranked_matches(results, &HashSet::new()))
}

fn finalize_results(
	mut matches: Vec<RankedMatch>,
	total_matches: u32,
	max_results: usize,
) -> FuzzyFindResult {
	matches.sort_by(|a, b| b.score.cmp(&a.score).then_with(|| a.path.cmp(&b.path)));
	matches.truncate(max_results);
	FuzzyFindResult {
		matches: matches
			.into_iter()
			.map(|matched| FuzzyFindMatch {
				path:         matched.path,
				is_directory: matched.is_directory,
				score:        matched.score,
			})
			.collect(),
		total_matches,
	}
}

#[allow(clippy::too_many_arguments, reason = "search helper carries per-call filters explicitly")]
fn run_fff_search(
	root: &Path,
	entries: &[fs_cache::GlobMatch],
	query: &str,
	max_results: usize,
	include_hidden: bool,
	respect_gitignore: bool,
	db: Option<&SearchDb>,
	ct: &task::CancelToken,
) -> Result<FuzzyFindResult> {
	let limit = search_limit(max_results);
	if let Some(db) = db
		&& include_hidden
		&& respect_gitignore
	{
		let (mut file_matches, file_total) = search_stateful_files(root, query, limit, db, ct)?;
		let (dir_matches, dir_total) =
			search_stateless_entries(root, entries, query, limit, false, true, None, ct)?;
		file_matches.extend(dir_matches);
		let total_matches = crate::utils::clamp_u32(file_total as u64 + dir_total as u64);
		return Ok(finalize_results(file_matches, total_matches, max_results));
	}

	let (matches, total_matches) =
		search_stateless_entries(root, entries, query, limit, true, true, db, ct)?;
	Ok(finalize_results(matches, total_matches, max_results))
}

fn fuzzy_find_sync(
	config: FuzzyFindConfig,
	db: Option<&SearchDb>,
	ct: task::CancelToken,
) -> Result<FuzzyFindResult> {
	let root = fs_cache::resolve_search_path(&config.path)?;
	let include_hidden = config.hidden.unwrap_or(false);
	let respect_gitignore = config.gitignore.unwrap_or(true);
	let max_results = config.max_results.unwrap_or(100) as usize;
	if max_results == 0 {
		return Ok(FuzzyFindResult { matches: Vec::new(), total_matches: 0 });
	}

	let query = config.query.trim().to_string();
	let use_cache = config.cache.unwrap_or(false);
	if use_cache {
		let scan = fs_cache::get_or_scan(&root, include_hidden, respect_gitignore, &ct)?;
		let mut results = run_fff_search(
			&root,
			&scan.entries,
			&query,
			max_results,
			include_hidden,
			respect_gitignore,
			db,
			&ct,
		)?;
		if results.total_matches == 0
			&& !query.is_empty()
			&& scan.cache_age_ms >= fs_cache::empty_recheck_ms()
		{
			let fresh = fs_cache::force_rescan(&root, include_hidden, respect_gitignore, true, &ct)?;
			results = run_fff_search(
				&root,
				&fresh,
				&query,
				max_results,
				include_hidden,
				respect_gitignore,
				db,
				&ct,
			)?;
		}
		return Ok(results);
	}

	let fresh = fs_cache::force_rescan(&root, include_hidden, respect_gitignore, false, &ct)?;
	run_fff_search(&root, &fresh, &query, max_results, include_hidden, respect_gitignore, db, &ct)
}

/// Fuzzy file path search for autocomplete.
///
/// # Arguments
/// - `options`: Query string, root path, and limits.
///
/// # Returns
/// Matching file and directory entries sorted by match quality.
#[napi(js_name = "fuzzyFind")]
pub fn fuzzy_find(
	options: FuzzyFindOptions<'_>,
	db: Option<&SearchDb>,
) -> task::Async<FuzzyFindResult> {
	let FuzzyFindOptions { query, path, hidden, gitignore, cache, max_results, timeout_ms, signal } =
		options;
	let ct = task::CancelToken::new(timeout_ms, signal);
	let config = FuzzyFindConfig { query, path, hidden, gitignore, max_results, cache };
	let db = db.cloned();
	task::blocking("fuzzy_find", ct, move |ct| fuzzy_find_sync(config, db.as_ref(), ct))
}

#[cfg(test)]
mod tests {
	use std::{
		fs,
		path::{Path, PathBuf},
		time::{SystemTime, UNIX_EPOCH},
	};

	use super::{FuzzyFindConfig, fuzzy_find_sync};
	use crate::task::CancelToken;

	struct TempDirGuard(PathBuf);

	impl TempDirGuard {
		fn new() -> Self {
			let unique = SystemTime::now()
				.duration_since(UNIX_EPOCH)
				.expect("system time is after UNIX_EPOCH")
				.as_nanos();
			let path = std::env::temp_dir().join(format!("pi-natives-fff-test-{unique}"));
			fs::create_dir_all(&path).expect("create temp test directory");
			Self(path)
		}

		fn path(&self) -> &Path {
			&self.0
		}
	}

	impl Drop for TempDirGuard {
		fn drop(&mut self) {
			let _ = fs::remove_dir_all(&self.0);
		}
	}

	fn write_file(path: &Path, content: &str) {
		if let Some(parent) = path.parent() {
			fs::create_dir_all(parent).expect("create parent directories for test file");
		}
		fs::write(path, content).expect("write test file");
	}

	#[test]
	fn returns_directory_matches() {
		let root = TempDirGuard::new();
		write_file(&root.path().join("src/lib.rs"), "pub fn lib_fn() {}\n");
		write_file(&root.path().join("README.md"), "readme\n");

		let result = fuzzy_find_sync(
			FuzzyFindConfig {
				query:       "src".to_string(),
				path:        root.path().to_string_lossy().into_owned(),
				hidden:      Some(false),
				gitignore:   Some(false),
				max_results: Some(20),
				cache:       Some(false),
			},
			None,
			CancelToken::default(),
		)
		.expect("fuzzy_find_sync should succeed for directory query");

		assert!(
			result
				.matches
				.iter()
				.any(|m| m.path == "src/" && m.is_directory),
			"expected directory result for src/; got {:?}",
			result
				.matches
				.iter()
				.map(|m| (&m.path, m.is_directory))
				.collect::<Vec<_>>()
		);
	}

	#[test]
	fn hidden_files_require_hidden_flag() {
		let root = TempDirGuard::new();
		write_file(&root.path().join("visible.txt"), "visible\n");
		write_file(&root.path().join(".hidden-file.txt"), "hidden\n");

		let hidden_off = fuzzy_find_sync(
			FuzzyFindConfig {
				query:       "hidden".to_string(),
				path:        root.path().to_string_lossy().into_owned(),
				hidden:      Some(false),
				gitignore:   Some(false),
				max_results: Some(20),
				cache:       Some(false),
			},
			None,
			CancelToken::default(),
		)
		.expect("hidden-off fuzzy_find_sync should succeed");
		assert!(
			hidden_off
				.matches
				.iter()
				.all(|m| m.path != ".hidden-file.txt"),
			"hidden file should be excluded when hidden=false; got {:?}",
			hidden_off
				.matches
				.iter()
				.map(|m| m.path.as_str())
				.collect::<Vec<_>>()
		);

		let hidden_on = fuzzy_find_sync(
			FuzzyFindConfig {
				query:       "hidden".to_string(),
				path:        root.path().to_string_lossy().into_owned(),
				hidden:      Some(true),
				gitignore:   Some(false),
				max_results: Some(20),
				cache:       Some(false),
			},
			None,
			CancelToken::default(),
		)
		.expect("hidden-on fuzzy_find_sync should succeed");
		assert!(
			hidden_on
				.matches
				.iter()
				.any(|m| m.path == ".hidden-file.txt" && !m.is_directory),
			"hidden file should be returned when hidden=true; got {:?}",
			hidden_on
				.matches
				.iter()
				.map(|m| (&m.path, m.is_directory))
				.collect::<Vec<_>>()
		);
	}
}
