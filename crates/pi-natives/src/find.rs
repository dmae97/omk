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
use napi::{bindgen_prelude::*, tokio::task};
use napi_derive::napi;

/// Options for discovering files and directories.
#[napi(object)]
pub struct FindOptions {
	/// Glob pattern to match (e.g., "*.ts").
	pub pattern:     String,
	/// Directory to search.
	pub path:        String,
	/// Filter by file type: "file", "dir", or "symlink".
	#[napi(js_name = "fileType")]
	pub file_type:   Option<String>,
	/// Include hidden files (default: false).
	pub hidden:      Option<bool>,
	/// Maximum number of results to return.
	#[napi(js_name = "maxResults")]
	pub max_results: Option<u32>,
	/// Respect .gitignore files (default: true).
	pub gitignore:   Option<bool>,
}

/// A single filesystem match.
#[napi(object)]
pub struct FindMatch {
	pub path:      String,
	#[napi(js_name = "fileType")]
	pub file_type: String,
}

/// Result of a find operation.
#[napi(object)]
pub struct FindResult {
	pub matches:       Vec<FindMatch>,
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

fn classify_file_type(path: &Path) -> Option<&'static str> {
	let metadata = std::fs::symlink_metadata(path).ok()?;
	let file_type = metadata.file_type();
	if file_type.is_symlink() {
		Some(FILE_TYPE_SYMLINK)
	} else if file_type.is_dir() {
		Some(FILE_TYPE_DIR)
	} else {
		Some(FILE_TYPE_FILE)
	}
}

fn run_find(
	root: PathBuf,
	pattern: String,
	include_hidden: bool,
	file_type_filter: Option<String>,
	max_results: usize,
	use_gitignore: bool,
	mentions_node_modules: bool,
) -> Result<FindResult> {
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
		let Some(file_type) = classify_file_type(path) else {
			continue;
		};
		if let Some(filter) = file_type_filter.as_deref()
			&& filter != file_type
		{
			continue;
		}

		matches
			.push(FindMatch { path: relative.into_owned(), file_type: file_type.to_string() });

		if matches.len() >= max_results {
			break;
		}
	}

	let total_matches = matches.len().min(u32::MAX as usize) as u32;
	Ok(FindResult { matches, total_matches })
}

/// Find filesystem entries matching a glob pattern.
///
/// # Errors
/// Returns an error if the glob is invalid or the search path is missing.
#[napi(js_name = "find")]
pub async fn find(options: FindOptions) -> Result<FindResult> {
	let FindOptions { pattern, path, file_type, hidden, max_results, gitignore } = options;

	let pattern = pattern.trim();
	let pattern = if pattern.is_empty() { "*" } else { pattern };
	let pattern = pattern.to_string();

	let search_path = resolve_search_path(&path)?;
	let file_type_filter = normalize_file_type(file_type);
	let include_hidden = hidden.unwrap_or(false);
	let max_results = max_results.map_or(usize::MAX, |value| value as usize);
	let use_gitignore = gitignore.unwrap_or(true);
	let mentions_node_modules = pattern.contains("node_modules");

	task::spawn_blocking(move || {
		run_find(
			search_path,
			pattern,
			include_hidden,
			file_type_filter,
			max_results,
			use_gitignore,
			mentions_node_modules,
		)
	})
	.await
	.map_err(|err| Error::from_reason(format!("Join error: {err}")))?
}
