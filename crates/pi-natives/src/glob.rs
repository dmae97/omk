//! Filesystem discovery with glob patterns, ignore semantics, and optional result caching.
//!
//! # Overview
//! Resolves a search root, walks entries with `ignore::WalkBuilder`, normalizes paths to
//! forward slashes, and applies glob matching plus optional file-type filtering.
//! Results can be streamed through a callback and are optionally sorted by mtime.
//!
//! The walker always skips `.git`, and skips `node_modules` unless explicitly requested.
//!
//! # Example
//! ```ignore
//! // JS: await native.glob({ pattern: "*.rs", path: "." })
//! ```

use std::{
	borrow::Cow,
	path::{Path, PathBuf},
	sync::LazyLock,
	time::{Duration, Instant},
};

use globset::{Glob, GlobSet, GlobSetBuilder};
use dashmap::DashMap;
use ignore::WalkBuilder;
use napi::{
	bindgen_prelude::*,
	threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode},
};
use napi_derive::napi;

use crate::task;

/// Input options for `glob`, including traversal, filtering, and cancellation.
#[napi(object)]
pub struct GlobOptions<'env> {
	/// Glob pattern to match (e.g., "*.ts").
	pub pattern:       String,
	/// Directory to search.
	pub path:          String,
	/// Filter by file type: "file", "dir", or "symlink".
	#[napi(js_name = "fileType")]
	pub file_type:     Option<FileType>,
	/// Include hidden files (default: false).
	pub hidden:        Option<bool>,
	/// Maximum number of results to return.
	#[napi(js_name = "maxResults")]
	pub max_results:   Option<u32>,
	/// Respect .gitignore files (default: true).
	pub gitignore:     Option<bool>,
	/// Sort results by mtime (most recent first) before applying limit.
	#[napi(js_name = "sortByMtime")]
	pub sort_by_mtime: Option<bool>,
	/// Include `node_modules` entries when the pattern does not explicitly mention them.
	#[napi(js_name = "includeNodeModules")]
	pub include_node_modules: Option<bool>,
	/// Reuse scanned entries for matching roots/options for this TTL (milliseconds).
	#[napi(js_name = "cacheTtlMs")]
	pub cache_ttl_ms:      Option<u32>,
	/// Abort signal for cancelling the operation.
	pub signal:        Option<Unknown<'env>>,
	/// Timeout in milliseconds for the operation.
	#[napi(js_name = "timeoutMs")]
	pub timeout_ms:    Option<u32>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[napi]
pub enum FileType {
	/// Regular file.
	File    = 1,
	/// Directory.
	Dir     = 2,
	/// Symbolic link.
	Symlink = 3,
}

/// A single filesystem match.
#[derive(Clone)]
#[napi(object)]
pub struct GlobMatch {
	/// Relative path from the search root, using forward slashes.
	pub path:      String,
	/// Resolved filesystem type for the match.
	#[napi(js_name = "fileType")]
	pub file_type: FileType,
	/// Modification time in milliseconds since Unix epoch (from `symlink_metadata`).
	pub mtime:     Option<f64>,
}

/// Result payload returned by a glob operation.
#[napi(object)]
pub struct GlobResult {
	/// Matched filesystem entries.
	pub matches:       Vec<GlobMatch>,
	/// Number of returned matches (`matches.len()`), clamped to `u32::MAX`.
	pub total_matches: u32,
}

fn resolve_search_path(path: &str) -> Result<PathBuf> {
	let candidate = PathBuf::from(path);
	let root = if candidate.is_absolute() {
		candidate
	} else {
		let cwd = std::env::current_dir()
			.map_err(|err| Error::from_reason(format!("Failed to resolve cwd: {err}")))?;
		cwd.join(candidate)
	};
	let metadata = std::fs::metadata(&root)
		.map_err(|err| Error::from_reason(format!("Path not found: {err}")))?;
	if !metadata.is_dir() {
		return Err(Error::from_reason("Search path must be a directory".to_string()));
	}
	Ok(root)
}

fn build_glob_pattern(glob: &str) -> String {
	let normalized = if cfg!(windows) && glob.contains('\\') {
		Cow::Owned(glob.replace('\\', "/"))
	} else {
		Cow::Borrowed(glob)
	};
	if normalized.contains('/') || normalized.starts_with("**") {
		normalized.into_owned()
	} else {
		format!("**/{normalized}")
	}
}

fn compile_glob(glob: &str) -> Result<GlobSet> {
	let mut builder = GlobSetBuilder::new();
	let pattern = build_glob_pattern(glob);
	let glob = Glob::new(&pattern)
		.map_err(|err| Error::from_reason(format!("Invalid glob pattern: {err}")))?;
	builder.add(glob);
	builder
		.build()
		.map_err(|err| Error::from_reason(format!("Failed to build glob matcher: {err}")))
}

fn normalize_relative_path<'a>(root: &Path, path: &'a Path) -> Cow<'a, str> {
	let relative = path.strip_prefix(root).unwrap_or(path);
	if cfg!(windows) {
		let relative = relative.to_string_lossy();
		if relative.contains('\\') {
			Cow::Owned(relative.replace('\\', "/"))
		} else {
			relative
		}
	} else {
		relative.to_string_lossy()
	}
}

fn contains_component(path: &Path, target: &str) -> bool {
	path.components().any(|component| {
		component
			.as_os_str()
			.to_str()
			.is_some_and(|value| value == target)
	})
}

fn should_skip_path(path: &Path, mentions_node_modules: bool) -> bool {
	// Always skip VCS internals; they are noise for user-facing discovery.
	if contains_component(path, ".git") {
		return true;
	}
	if !mentions_node_modules && contains_component(path, "node_modules") {
		// Skip node_modules by default unless explicitly requested/pattern-matched.
		return true;
	}
	false
}

fn classify_file_type(path: &Path) -> Option<(FileType, Option<f64>)> {
	let metadata = std::fs::symlink_metadata(path).ok()?;
	let file_type = metadata.file_type();
	let mtime_ms = metadata
		.modified()
		.ok()
		.and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
		.map(|d| d.as_millis() as f64);
	if file_type.is_symlink() {
		Some((FileType::Symlink, mtime_ms))
	} else if file_type.is_dir() {
		Some((FileType::Dir, mtime_ms))
	} else {
		Some((FileType::File, mtime_ms))
	}
}

/// Internal runtime config for a single glob execution.
///
/// This keeps `run_glob` parameters cohesive and makes option defaults explicit at
/// one construction site.
struct GlobConfig {
	root:                  PathBuf,
	pattern:               String,
	include_hidden:        bool,
	file_type_filter:      Option<FileType>,
	max_results:           usize,
	use_gitignore:         bool,
	mentions_node_modules: bool,
	sort_by_mtime:         bool,
	cache_ttl_ms:          u32,
}
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct GlobCacheKey {
	root:           PathBuf,
	include_hidden: bool,
	use_gitignore:  bool,
}

#[derive(Clone)]
struct GlobCacheEntry {
	expires_at: Instant,
	entries:    Vec<GlobMatch>,
}

const MAX_GLOB_CACHE_ENTRIES: usize = 16;
static GLOB_CACHE: LazyLock<DashMap<GlobCacheKey, GlobCacheEntry>> = LazyLock::new(DashMap::new);


/// Builds a deterministic filesystem walker configured for visibility and ignore rules.
fn build_walker(root: &Path, include_hidden: bool, use_gitignore: bool) -> WalkBuilder {
	let mut builder = WalkBuilder::new(root);
	builder
		.hidden(!include_hidden)
		.follow_links(false)
		.sort_by_file_path(|a, b| a.cmp(b));

	if use_gitignore {
		// Honor repository and global ignore files for repo-like behavior.
		builder
			.git_ignore(true)
			.git_exclude(true)
			.git_global(true)
			.ignore(true)
			.parents(true);
	} else {
		// Disable all ignore sources for exhaustive filesystem traversal.
		builder
			.git_ignore(false)
			.git_exclude(false)
			.git_global(false)
			.ignore(false)
			.parents(false);
	}

	builder
}

/// Scans filesystem entries and records normalized relative paths with file metadata.
fn collect_entries(root: &Path, include_hidden: bool, use_gitignore: bool, ct: &task::CancelToken) -> Result<Vec<GlobMatch>> {
	let builder = build_walker(root, include_hidden, use_gitignore);
	let mut entries = Vec::new();

	for entry in builder.build() {
		ct.heartbeat()?;

		let Ok(entry) = entry else { continue };
		let path = entry.path();
		if should_skip_path(path, true) {
			// The cache always stores node_modules; caller-side filtering is applied later.
			continue;
		}

		let relative = normalize_relative_path(root, path);
		if relative.is_empty() {
			// Ignore the synthetic root entry ("" relative path).
			continue;
		}

		let Some((file_type, mtime)) = classify_file_type(path) else {
			continue;
		};

		entries.push(GlobMatch {
			path: relative.into_owned(),
			file_type,
			mtime,
		});
	}

	Ok(entries)
}

/// Returns scanned entries, using a small TTL cache keyed by root and walker options.
pub(crate) fn get_entries_with_cache(
	root: &Path,
	include_hidden: bool,
	use_gitignore: bool,
	cache_ttl_ms: u32,
	ct: &task::CancelToken,
) -> Result<Vec<GlobMatch>> {
	if cache_ttl_ms == 0 {
		// Fast path: skip cache bookkeeping when TTL caching is disabled.
		return collect_entries(root, include_hidden, use_gitignore, ct);
	}

	let key = GlobCacheKey {
		root: root.to_path_buf(),
		include_hidden,
		use_gitignore,
	};

	let now = Instant::now();
	if let Some(entry) = GLOB_CACHE.get(&key) {
		if entry.expires_at > now {
			return Ok(entry.entries.clone());
		}
		GLOB_CACHE.remove(&key);
	}
	let entries = collect_entries(root, include_hidden, use_gitignore, ct)?;
	GLOB_CACHE.insert(
		key,
		GlobCacheEntry {
			expires_at: now + Duration::from_millis(cache_ttl_ms as u64),
			entries: entries.clone(),
		},
	);

	if GLOB_CACHE.len() > MAX_GLOB_CACHE_ENTRIES
		&& let Some(oldest_key) = GLOB_CACHE
			.iter()
			.min_by_key(|entry| entry.value().expires_at)
			.map(|entry| entry.key().clone())
	{
		GLOB_CACHE.remove(&oldest_key);
	}
	Ok(entries)
}

/// Executes matching/filtering over scanned entries and optionally streams each hit.
fn run_glob(
	config: GlobConfig,
	on_match: Option<&ThreadsafeFunction<GlobMatch>>,
	ct: task::CancelToken,
) -> Result<GlobResult> {
	let GlobConfig {
		root,
		pattern,
		include_hidden,
		file_type_filter,
		max_results,
		use_gitignore,
		mentions_node_modules,
		sort_by_mtime,
		cache_ttl_ms,
	} = config;

	let glob_set = compile_glob(&pattern)?;
	let mut matches = Vec::new();
	if max_results == 0 {
		// Avoid scanning/filtering when caller asked for zero results.
		return Ok(GlobResult { matches, total_matches: 0 });
	}

	let entries = get_entries_with_cache(&root, include_hidden, use_gitignore, cache_ttl_ms, &ct)?;

	for entry in entries {
		ct.heartbeat()?;
		if should_skip_path(Path::new(&entry.path), mentions_node_modules) {
			// Apply post-scan node_modules policy before glob matching.
			continue;
		}
		if !glob_set.is_match(&entry.path) {
			// Glob mismatch: skip without invoking callbacks.
			continue;
		}
		if file_type_filter.is_some_and(|filter| filter != entry.file_type) {
			// Type filter is applied after pattern match for cheaper rejection.
			continue;
		}
		if let Some(callback) = on_match {
			callback.call(Ok(entry.clone()), ThreadsafeFunctionCallMode::NonBlocking);
		}

		matches.push(entry);
		// Only early-break when not sorting; mtime sort requires full candidate set.
		if !sort_by_mtime && matches.len() >= max_results {
			break;
		}
	}
	if sort_by_mtime {
		// Sorting mode: rank by mtime descending, then apply max-results truncation.
		matches.sort_by(|a, b| {
			let a_mtime = a.mtime.unwrap_or(0.0);
			let b_mtime = b.mtime.unwrap_or(0.0);
			b_mtime
				.partial_cmp(&a_mtime)
				.unwrap_or(std::cmp::Ordering::Equal)
		});
		matches.truncate(max_results);
	}
	let total_matches = matches.len().min(u32::MAX as usize) as u32;
	Ok(GlobResult { matches, total_matches })
}

/// Find filesystem entries matching a glob pattern.
///
/// Resolves the search root, scans entries, applies glob and optional file-type filters,
/// and optionally streams each accepted match through `on_match`.
///
/// If `sortByMtime` is enabled, all matching entries are collected, sorted by descending
/// mtime, then truncated to `maxResults`.
///
/// # Errors
/// Returns an error when the search path cannot be resolved, the path is not a directory,
/// the glob pattern is invalid, or cancellation/timeout is triggered.
#[napi(js_name = "glob")]
pub fn glob(
	options: GlobOptions<'_>,
	#[napi(ts_arg_type = "((match: GlobMatch) => void) | undefined | null")] on_match: Option<
		ThreadsafeFunction<GlobMatch>,
	>,
) -> task::Async<GlobResult> {
	let GlobOptions {
		pattern,
		path,
		file_type,
		hidden,
		max_results,
		gitignore,
		sort_by_mtime,
		include_node_modules,
		cache_ttl_ms,
		timeout_ms,
		signal,
	} = options;

	let pattern = pattern.trim();
	let pattern = if pattern.is_empty() { "*" } else { pattern };
	let pattern = pattern.to_string();

	let ct = task::CancelToken::new(timeout_ms, signal);

	task::blocking("glob", ct, move |ct| {
		run_glob(
			GlobConfig {
				root: resolve_search_path(&path)?,
				include_hidden: hidden.unwrap_or(false),
				file_type_filter: file_type,
				max_results: max_results.map_or(usize::MAX, |value| value as usize),
				use_gitignore: gitignore.unwrap_or(true),
				mentions_node_modules: include_node_modules.unwrap_or_else(|| pattern.contains("node_modules")),
				cache_ttl_ms: cache_ttl_ms.unwrap_or(0),
				sort_by_mtime: sort_by_mtime.unwrap_or(false),
				pattern,
			},
			on_match.as_ref(),
			ct,
		)
	})
}
