//! Filesystem discovery with glob patterns and ignore rules.
//!
//! # Overview
//! Walks a directory tree, applies glob matching, and reports file types while
//! optionally respecting .gitignore rules.
//!
//! # Example
//! ```ignore
//! // JS: await native.find({ pattern: "*.rs", path: "." })
//! ```

use std::{
	borrow::Cow,
	path::{Path, PathBuf},
	sync::atomic::{AtomicBool, Ordering},
};

use globset::{Glob, GlobSet, GlobSetBuilder};
use ignore::WalkBuilder;
use napi::{
	bindgen_prelude::*,
	threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode},
};
use napi_derive::napi;

use crate::work::launch_blocking;

/// Options for discovering files and directories.
#[napi(object)]
pub struct FindOptions {
	/// Glob pattern to match (e.g., "*.ts").
	pub pattern:       String,
	/// Directory to search.
	pub path:          String,
	/// Filter by file type: "file", "dir", or "symlink".
	#[napi(js_name = "fileType")]
	pub file_type:     Option<String>,
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
}

/// A single filesystem match.
#[derive(Clone)]
#[napi(object)]
pub struct FindMatch {
	/// Relative path from the search root, using forward slashes.
	pub path:      String,
	/// Resolved filesystem type for the match.
	#[napi(js_name = "fileType")]
	pub file_type: String,
	/// Modification time in milliseconds since epoch (if available).
	pub mtime:     Option<f64>,
}

/// Result of a find operation.
#[napi(object)]
pub struct FindResult {
	/// Matched filesystem entries.
	pub matches:       Vec<FindMatch>,
	/// Number of matches returned after limits are applied.
	#[napi(js_name = "totalMatches")]
	pub total_matches: u32,
}

const FILE_TYPE_FILE: &str = "file";
const FILE_TYPE_DIR: &str = "dir";
const FILE_TYPE_SYMLINK: &str = "symlink";

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
	if contains_component(path, ".git") {
		return true;
	}
	if !mentions_node_modules && contains_component(path, "node_modules") {
		return true;
	}
	false
}

fn normalize_file_type(value: Option<String>) -> Option<String> {
	value
		.map(|v| v.trim().to_string())
		.filter(|v| !v.is_empty())
}

fn classify_file_type(path: &Path) -> Option<(&'static str, Option<f64>)> {
	let metadata = std::fs::symlink_metadata(path).ok()?;
	let file_type = metadata.file_type();
	let mtime_ms = metadata
		.modified()
		.ok()
		.and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
		.map(|d| d.as_millis() as f64);
	if file_type.is_symlink() {
		Some((FILE_TYPE_SYMLINK, mtime_ms))
	} else if file_type.is_dir() {
		Some((FILE_TYPE_DIR, mtime_ms))
	} else {
		Some((FILE_TYPE_FILE, mtime_ms))
	}
}

/// Internal configuration for the find operation, grouped to reduce parameter
/// count.
struct FindConfig {
	root:                  PathBuf,
	pattern:               String,
	include_hidden:        bool,
	file_type_filter:      Option<String>,
	max_results:           usize,
	use_gitignore:         bool,
	mentions_node_modules: bool,
	sort_by_mtime:         bool,
}

fn run_find(
	config: FindConfig,
	on_match: Option<&ThreadsafeFunction<FindMatch>>,
	cancelled: &AtomicBool,
) -> Result<FindResult> {
	let FindConfig {
		root,
		pattern,
		include_hidden,
		file_type_filter,
		max_results,
		use_gitignore,
		mentions_node_modules,
		sort_by_mtime,
	} = config;

	let glob_set = compile_glob(&pattern)?;
	let mut builder = WalkBuilder::new(&root);
	builder
		.hidden(!include_hidden)
		.follow_links(false)
		.sort_by_file_path(|a, b| a.cmp(b));

	if use_gitignore {
		builder
			.git_ignore(true)
			.git_exclude(true)
			.git_global(true)
			.ignore(true)
			.parents(true);
	} else {
		builder
			.git_ignore(false)
			.git_exclude(false)
			.git_global(false)
			.ignore(false)
			.parents(false);
	}

	let mut matches = Vec::new();
	if max_results == 0 {
		return Ok(FindResult { matches, total_matches: 0 });
	}

	for entry in builder.build() {
		// Check for cancellation
		if cancelled.load(Ordering::Relaxed) {
			break;
		}

		let Ok(entry) = entry else { continue };
		let path = entry.path();
		if should_skip_path(path, mentions_node_modules) {
			continue;
		}
		let relative = normalize_relative_path(&root, path);
		if relative.is_empty() {
			continue;
		}
		if !glob_set.is_match(relative.as_ref()) {
			continue;
		}
		let Some((file_type, mtime)) = classify_file_type(path) else {
			continue;
		};
		if let Some(filter) = file_type_filter.as_deref()
			&& filter != file_type
		{
			continue;
		}

		let found =
			FindMatch { path: relative.into_owned(), file_type: file_type.to_string(), mtime };

		// Call streaming callback if provided
		if let Some(callback) = on_match {
			callback.call(Ok(found.clone()), ThreadsafeFunctionCallMode::NonBlocking);
		}

		matches.push(found);

		// Only limit during iteration if NOT sorting by mtime
		// (sorting requires collecting all matches first)
		if !sort_by_mtime && matches.len() >= max_results {
			break;
		}
	}

	// Sort by mtime (most recent first) if requested
	if sort_by_mtime {
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
	Ok(FindResult { matches, total_matches })
}

/// Find filesystem entries matching a glob pattern.
///
/// Uses the provided options to resolve the search root, apply glob
/// matching, and optionally stream matches to a callback.
///
/// # Errors
/// Returns an error if the glob is invalid or the search path is missing.
#[napi(js_name = "find")]
pub async fn find(
	options: FindOptions,
	#[napi(ts_arg_type = "((match: FindMatch) => void) | undefined | null")] on_match: Option<
		ThreadsafeFunction<FindMatch>,
	>,
) -> Result<FindResult> {
	let FindOptions { pattern, path, file_type, hidden, max_results, gitignore, sort_by_mtime } =
		options;

	let pattern = pattern.trim();
	let pattern = if pattern.is_empty() { "*" } else { pattern };
	let pattern = pattern.to_string();

	let search_path = resolve_search_path(&path)?;
	let file_type_filter = normalize_file_type(file_type);
	let include_hidden = hidden.unwrap_or(false);
	let max_results = max_results.map_or(usize::MAX, |value| value as usize);
	let use_gitignore = gitignore.unwrap_or(true);
	let mentions_node_modules = pattern.contains("node_modules");
	let sort_by_mtime = sort_by_mtime.unwrap_or(false);

	launch_blocking("find", move || {
		let cancelled = AtomicBool::new(false);
		let config = FindConfig {
			root: search_path,
			pattern,
			include_hidden,
			file_type_filter,
			max_results,
			use_gitignore,
			mentions_node_modules,
			sort_by_mtime,
		};
		run_find(config, on_match.as_ref(), &cancelled)
	})
	.wait()
	.await
}
