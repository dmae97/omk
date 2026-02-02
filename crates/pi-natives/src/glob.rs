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
};

use globset::{Glob, GlobSet, GlobSetBuilder};
use ignore::WalkBuilder;
use napi::{
	bindgen_prelude::*,
	threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode},
};
use napi_derive::napi;

use crate::task;

/// Options for discovering files and directories.
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
	/// Abort signal for cancelling the operation.
	pub signal:        Option<Unknown<'env>>,
	/// Timeout in milliseconds for the operation.
	#[napi(js_name = "timeoutMs")]
	pub timeout_ms:    Option<u32>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[napi]
pub enum FileType {
	File    = 1,
	Dir     = 2,
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
	/// Modification time in milliseconds since epoch (if available).
	pub mtime:     Option<f64>,
}

/// Result of a find operation.
#[napi(object)]
pub struct GlobResult {
	/// Matched filesystem entries.
	pub matches:       Vec<GlobMatch>,
	/// Number of matches returned after limits are applied.
	#[napi(js_name = "totalMatches")]
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
	if contains_component(path, ".git") {
		return true;
	}
	if !mentions_node_modules && contains_component(path, "node_modules") {
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

/// Internal configuration for the find operation, grouped to reduce parameter
/// count.
struct GlobConfig {
	root:                  PathBuf,
	pattern:               String,
	include_hidden:        bool,
	file_type_filter:      Option<FileType>,
	max_results:           usize,
	use_gitignore:         bool,
	mentions_node_modules: bool,
	sort_by_mtime:         bool,
}

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
		return Ok(GlobResult { matches, total_matches: 0 });
	}

	for entry in builder.build() {
		// Check for cancellation
		ct.heartbeat()?;

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
		if file_type_filter.is_some_and(|filter| filter != file_type) {
			continue;
		}

		let found = GlobMatch { path: relative.into_owned(), file_type, mtime };

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
	Ok(GlobResult { matches, total_matches })
}

/// Find filesystem entries matching a glob pattern.
///
/// Uses the provided options to resolve the search root, apply glob
/// matching, and optionally stream matches to a callback.
///
/// # Errors
/// Returns an error if the glob is invalid or the search path is missing.
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
				mentions_node_modules: pattern.contains("node_modules"),
				sort_by_mtime: sort_by_mtime.unwrap_or(false),
				pattern,
			},
			on_match.as_ref(),
			ct,
		)
	})
}
