//! Ripgrep-backed search exported via N-API.
//!
//! Provides two layers:
//! - `search()` for in-memory content search.
//! - `grep()` for filesystem search with glob/type filtering.
//!
//! The filesystem search matches the previous JS wrapper behavior, including
//! global offsets, optional match limits, and per-file match summaries.

use std::{
	borrow::Cow,
	fs::File,
	io::{self, Cursor, Read},
	path::{Path, PathBuf},
};

use globset::{Glob, GlobSet, GlobSetBuilder};
use grep_matcher::Matcher;
use grep_regex::RegexMatcherBuilder;
use grep_searcher::{
	BinaryDetection, Searcher, SearcherBuilder, Sink, SinkContext, SinkContextKind, SinkMatch,
};
use ignore::WalkBuilder;
use napi::{
	JsString,
	bindgen_prelude::*,
	threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode},
};
use napi_derive::napi;
use rayon::prelude::*;

use crate::work::launch_blocking;

const MAX_FILE_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum OutputMode {
	Content,
	Count,
}

/// Options for searching file content.
#[napi(object)]
pub struct SearchOptions {
	/// Regex pattern to search for.
	pub pattern:     String,
	/// Case-insensitive search.
	#[napi(js_name = "ignoreCase")]
	pub ignore_case: Option<bool>,
	/// Enable multiline matching.
	pub multiline:   Option<bool>,
	/// Maximum number of matches to return.
	#[napi(js_name = "maxCount")]
	pub max_count:   Option<u32>,
	/// Skip first N matches.
	pub offset:      Option<u32>,
	/// Lines of context before/after matches.
	pub context:     Option<u32>,
	/// Truncate lines longer than this (characters).
	#[napi(js_name = "maxColumns")]
	pub max_columns: Option<u32>,
	/// Output mode (content or count).
	pub mode:        Option<String>,
}

/// Options for searching files on disk.
#[napi(object)]
pub struct GrepOptions {
	/// Regex pattern to search for.
	pub pattern:     String,
	/// Directory or file to search.
	pub path:        String,
	/// Glob filter for filenames (e.g., "*.ts").
	pub glob:        Option<String>,
	/// Filter by file type (e.g., "js", "py", "rust").
	#[napi(js_name = "type")]
	pub type_filter: Option<String>,
	/// Case-insensitive search.
	#[napi(js_name = "ignoreCase")]
	pub ignore_case: Option<bool>,
	/// Enable multiline matching.
	pub multiline:   Option<bool>,
	/// Include hidden files (default: true).
	pub hidden:      Option<bool>,
	/// Maximum number of matches to return.
	#[napi(js_name = "maxCount")]
	pub max_count:   Option<u32>,
	/// Skip first N matches.
	pub offset:      Option<u32>,
	/// Lines of context before/after matches.
	pub context:     Option<u32>,
	/// Truncate lines longer than this (characters).
	#[napi(js_name = "maxColumns")]
	pub max_columns: Option<u32>,
	/// Output mode (content, filesWithMatches, or count).
	pub mode:        Option<String>,
}

/// A context line (before or after a match).
#[derive(Clone)]
#[napi(object)]
pub struct ContextLine {
	#[napi(js_name = "lineNumber")]
	pub line_number: u32,
	/// Raw line content (trimmed line ending).
	pub line:        String,
}

/// A single match in the content.
#[napi(object)]
pub struct Match {
	/// 1-indexed line number.
	#[napi(js_name = "lineNumber")]
	pub line_number:    u32,
	/// The matched line content.
	pub line:           String,
	/// Context lines before the match.
	#[napi(js_name = "contextBefore")]
	pub context_before: Option<Vec<ContextLine>>,
	/// Context lines after the match.
	#[napi(js_name = "contextAfter")]
	pub context_after:  Option<Vec<ContextLine>>,
	/// Whether the line was truncated.
	pub truncated:      Option<bool>,
}

/// Result of searching content.
#[napi(object)]
pub struct SearchResult {
	/// All matches found.
	pub matches:       Vec<Match>,
	/// Total number of matches (may exceed `matches.len()` due to offset/limit).
	#[napi(js_name = "matchCount")]
	pub match_count:   u32,
	/// Whether the limit was reached.
	#[napi(js_name = "limitReached")]
	pub limit_reached: bool,
	/// Error message, if any.
	pub error:         Option<String>,
}

/// A single match in a grep result.
#[derive(Clone)]
#[napi(object)]
pub struct GrepMatch {
	/// File path for the match (relative for directory searches).
	pub path:           String,
	/// 1-indexed line number (0 for count-only entries).
	#[napi(js_name = "lineNumber")]
	pub line_number:    u32,
	/// The matched line content (empty for count-only entries).
	pub line:           String,
	/// Context lines before the match.
	#[napi(js_name = "contextBefore")]
	pub context_before: Option<Vec<ContextLine>>,
	/// Context lines after the match.
	#[napi(js_name = "contextAfter")]
	pub context_after:  Option<Vec<ContextLine>>,
	/// Whether the line was truncated.
	pub truncated:      Option<bool>,
	/// Per-file match count (count mode only).
	#[napi(js_name = "matchCount")]
	pub match_count:    Option<u32>,
}

/// Result of searching files.
#[napi(object)]
pub struct GrepResult {
	/// Matches or per-file counts, depending on output mode.
	pub matches:            Vec<GrepMatch>,
	/// Total matches across all files.
	#[napi(js_name = "totalMatches")]
	pub total_matches:      u32,
	/// Number of files with at least one match.
	#[napi(js_name = "filesWithMatches")]
	pub files_with_matches: u32,
	/// Number of files searched.
	#[napi(js_name = "filesSearched")]
	pub files_searched:     u32,
	/// Whether the limit/offset stopped the search early.
	#[napi(js_name = "limitReached")]
	pub limit_reached:      Option<bool>,
}

struct TypeFilter {
	extensions: Vec<String>,
	names:      Vec<String>,
}

struct MatchCollector {
	matches:         Vec<CollectedMatch>,
	match_count:     u64,
	collected_count: u64,
	max_count:       Option<u64>,
	offset:          u64,
	skipped:         u64,
	limit_reached:   bool,
	context_before:  Vec<ContextLine>,
	max_columns:     Option<usize>,
	collect_matches: bool,
}

struct CollectedMatch {
	line_number:    u64,
	line:           String,
	context_before: Vec<ContextLine>,
	context_after:  Vec<ContextLine>,
	truncated:      bool,
}

struct SearchResultInternal {
	matches:       Vec<CollectedMatch>,
	match_count:   u64,
	collected:     u64,
	limit_reached: bool,
}

struct FileEntry {
	path:          PathBuf,
	relative_path: String,
}

struct FileSearchResult {
	relative_path: String,
	matches:       Vec<CollectedMatch>,
	match_count:   u64,
}

impl MatchCollector {
	const fn new(
		max_count: Option<u64>,
		offset: u64,
		max_columns: Option<usize>,
		collect_matches: bool,
	) -> Self {
		Self {
			matches: Vec::new(),
			match_count: 0,
			collected_count: 0,
			max_count,
			offset,
			skipped: 0,
			limit_reached: false,
			context_before: Vec::new(),
			max_columns,
			collect_matches,
		}
	}

	fn truncate_line(&self, line: &str) -> (String, bool) {
		match self.max_columns {
			Some(max) if line.len() > max => {
				let cut = max.saturating_sub(3);
				let boundary = line.floor_char_boundary(cut);
				let truncated = format!("{}...", &line[..boundary]);
				(truncated, true)
			},
			_ => (line.to_string(), false),
		}
	}
}

fn bytes_to_trimmed_string(bytes: &[u8]) -> String {
	match std::str::from_utf8(bytes) {
		Ok(text) => text.trim_end().to_string(),
		Err(_) => String::from_utf8_lossy(bytes).trim_end().to_string(),
	}
}

impl Sink for MatchCollector {
	type Error = io::Error;

	fn matched(
		&mut self,
		_searcher: &Searcher,
		mat: &SinkMatch<'_>,
	) -> std::result::Result<bool, Self::Error> {
		self.match_count += 1;

		// If we already hit the limit, stop now (after-context for previous match was
		// collected).
		if self.limit_reached {
			return Ok(false);
		}

		if self.skipped < self.offset {
			self.skipped += 1;
			self.context_before.clear();
			return Ok(true);
		}

		if self.collect_matches {
			let raw_line = bytes_to_trimmed_string(mat.bytes());
			let (line, truncated) = self.truncate_line(&raw_line);
			let line_number = mat.line_number().unwrap_or(0);

			self.matches.push(CollectedMatch {
				line_number,
				line,
				context_before: std::mem::take(&mut self.context_before),
				context_after: Vec::new(),
				truncated,
			});
		} else {
			self.context_before.clear();
		}

		self.collected_count += 1;

		// Mark limit reached but don't stop yet - allow after-context to be collected.
		if let Some(max) = self.max_count
			&& self.collected_count >= max
		{
			self.limit_reached = true;
		}

		Ok(true)
	}

	fn context(
		&mut self,
		_searcher: &Searcher,
		ctx: &SinkContext<'_>,
	) -> std::result::Result<bool, Self::Error> {
		if !self.collect_matches {
			return Ok(true);
		}

		let raw_line = bytes_to_trimmed_string(ctx.bytes());
		let (line, _) = self.truncate_line(&raw_line);
		let line_number = ctx.line_number().unwrap_or(0);

		match ctx.kind() {
			SinkContextKind::Before => {
				self
					.context_before
					.push(ContextLine { line_number: clamp_u32(line_number), line });
			},
			SinkContextKind::After => {
				if let Some(last_match) = self.matches.last_mut() {
					last_match
						.context_after
						.push(ContextLine { line_number: clamp_u32(line_number), line });
				}
			},
			SinkContextKind::Other => {},
		}

		Ok(true)
	}
}

fn clamp_u32(value: u64) -> u32 {
	value.min(u32::MAX as u64) as u32
}

fn parse_output_mode(mode: Option<&str>) -> OutputMode {
	match mode {
		Some("count" | "filesWithMatches") => OutputMode::Count,
		_ => OutputMode::Content,
	}
}

fn resolve_search_path(path: &str) -> Result<PathBuf> {
	let candidate = PathBuf::from(path);
	if candidate.is_absolute() {
		return Ok(candidate);
	}
	let cwd = std::env::current_dir()
		.map_err(|err| Error::from_reason(format!("Failed to resolve cwd: {err}")))?;
	Ok(cwd.join(candidate))
}

fn build_glob_pattern(glob: &str) -> String {
	let normalized = glob.replace('\\', "/");
	if normalized.contains('/') || normalized.starts_with("**/") {
		normalized
	} else {
		format!("**/{normalized}")
	}
}

fn compile_glob(glob: Option<&str>) -> Result<Option<GlobSet>> {
	let Some(glob) = glob.map(str::trim).filter(|value| !value.is_empty()) else {
		return Ok(None);
	};
	let mut builder = GlobSetBuilder::new();
	let pattern = build_glob_pattern(glob);
	let glob = Glob::new(&pattern)
		.map_err(|err| Error::from_reason(format!("Invalid glob pattern: {err}")))?;
	builder.add(glob);
	builder
		.build()
		.map(Some)
		.map_err(|err| Error::from_reason(format!("Failed to build glob matcher: {err}")))
}

fn resolve_type_filter(type_name: Option<&str>) -> Option<TypeFilter> {
	let normalized = type_name
		.map(str::trim)
		.filter(|value| !value.is_empty())
		.map(|value| value.trim_start_matches('.').to_lowercase())?;

	let (extensions, names): (Vec<&str>, Vec<&str>) = match normalized.as_str() {
		"js" | "javascript" => (vec!["js", "jsx", "mjs", "cjs"], vec![]),
		"ts" | "typescript" => (vec!["ts", "tsx", "mts", "cts"], vec![]),
		"json" => (vec!["json", "jsonc", "json5"], vec![]),
		"yaml" | "yml" => (vec!["yaml", "yml"], vec![]),
		"toml" => (vec!["toml"], vec![]),
		"md" | "markdown" => (vec!["md", "markdown", "mdx"], vec![]),
		"py" | "python" => (vec!["py", "pyi"], vec![]),
		"rs" | "rust" => (vec!["rs"], vec![]),
		"go" => (vec!["go"], vec![]),
		"java" => (vec!["java"], vec![]),
		"kt" | "kotlin" => (vec!["kt", "kts"], vec![]),
		"c" => (vec!["c", "h"], vec![]),
		"cpp" | "cxx" => (vec!["cpp", "cc", "cxx", "hpp", "hxx", "hh"], vec![]),
		"cs" | "csharp" => (vec!["cs", "csx"], vec![]),
		"php" => (vec!["php", "phtml"], vec![]),
		"rb" | "ruby" => (vec!["rb", "rake", "gemspec"], vec![]),
		"sh" | "bash" => (vec!["sh", "bash", "zsh"], vec![]),
		"zsh" => (vec!["zsh"], vec![]),
		"fish" => (vec!["fish"], vec![]),
		"html" => (vec!["html", "htm"], vec![]),
		"css" => (vec!["css"], vec![]),
		"scss" => (vec!["scss"], vec![]),
		"sass" => (vec!["sass"], vec![]),
		"less" => (vec!["less"], vec![]),
		"xml" => (vec!["xml"], vec![]),
		"docker" | "dockerfile" => (vec![], vec!["dockerfile"]),
		"make" | "makefile" => (vec![], vec!["makefile"]),
		_ => (vec![normalized.as_str()], vec![]),
	};

	Some(TypeFilter {
		extensions: extensions
			.into_iter()
			.map(|value| value.to_string())
			.collect(),
		names:      names.into_iter().map(|value| value.to_string()).collect(),
	})
}

fn matches_case_insensitive(value: &str, candidates: &[String]) -> bool {
	if value.is_ascii() {
		candidates
			.iter()
			.any(|candidate| value.eq_ignore_ascii_case(candidate))
	} else {
		let lowered = value.to_lowercase();
		candidates.iter().any(|candidate| candidate == &lowered)
	}
}

fn matches_type_filter(path: &Path, filter: &TypeFilter) -> bool {
	let base_name = path
		.file_name()
		.and_then(|name| name.to_str())
		.unwrap_or("");
	if matches_case_insensitive(base_name, &filter.names) {
		return true;
	}
	let ext = path.extension().and_then(|ext| ext.to_str()).unwrap_or("");
	if ext.is_empty() {
		return false;
	}
	matches_case_insensitive(ext, &filter.extensions)
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

fn build_searcher(context: u32) -> Searcher {
	SearcherBuilder::new()
		.binary_detection(BinaryDetection::quit(b'\x00'))
		.line_number(true)
		.before_context(context as usize)
		.after_context(context as usize)
		.build()
}

fn run_search(
	matcher: &grep_regex::RegexMatcher,
	content: &[u8],
	context: u32,
	max_columns: Option<u32>,
	mode: OutputMode,
	max_count: Option<u64>,
	offset: u64,
) -> io::Result<SearchResultInternal> {
	run_search_reader(matcher, Cursor::new(content), context, max_columns, mode, max_count, offset)
}

/// Stream-based search that reads directly from a `Read` without buffering.
fn run_search_reader<R: Read>(
	matcher: &grep_regex::RegexMatcher,
	reader: R,
	context: u32,
	max_columns: Option<u32>,
	mode: OutputMode,
	max_count: Option<u64>,
	offset: u64,
) -> io::Result<SearchResultInternal> {
	let mut searcher = build_searcher(if mode == OutputMode::Content {
		context
	} else {
		0
	});
	let mut collector = MatchCollector::new(
		max_count,
		offset,
		max_columns.map(|v| v as usize),
		mode == OutputMode::Content,
	);
	searcher.search_reader(matcher, reader, &mut collector)?;
	Ok(SearchResultInternal {
		matches:       collector.matches,
		match_count:   collector.match_count,
		collected:     collector.collected_count,
		limit_reached: collector.limit_reached,
	})
}

fn to_public_match(matched: CollectedMatch) -> Match {
	let context_before = if matched.context_before.is_empty() {
		None
	} else {
		Some(matched.context_before)
	};
	let context_after = if matched.context_after.is_empty() {
		None
	} else {
		Some(matched.context_after)
	};
	Match {
		line_number: clamp_u32(matched.line_number),
		line: matched.line,
		context_before,
		context_after,
		truncated: if matched.truncated { Some(true) } else { None },
	}
}

fn to_grep_match(path: &str, matched: CollectedMatch) -> GrepMatch {
	let context_before = if matched.context_before.is_empty() {
		None
	} else {
		Some(matched.context_before)
	};
	let context_after = if matched.context_after.is_empty() {
		None
	} else {
		Some(matched.context_after)
	};
	GrepMatch {
		path: path.to_string(),
		line_number: clamp_u32(matched.line_number),
		line: matched.line,
		context_before,
		context_after,
		truncated: if matched.truncated { Some(true) } else { None },
		match_count: None,
	}
}

const fn empty_search_result(error: Option<String>) -> SearchResult {
	SearchResult { matches: Vec::new(), match_count: 0, limit_reached: false, error }
}

fn collect_files(
	root: &Path,
	glob_set: Option<&GlobSet>,
	include_hidden: bool,
	type_filter: Option<&TypeFilter>,
) -> Vec<FileEntry> {
	let mut builder = WalkBuilder::new(root);
	builder
		.hidden(!include_hidden)
		.git_ignore(true)
		.git_exclude(true)
		.git_global(true)
		.ignore(true)
		.parents(true)
		.follow_links(false)
		.sort_by_file_path(|a, b| a.cmp(b));

	let mut entries = Vec::new();
	for entry in builder.build() {
		let Ok(entry) = entry else { continue };
		let file_type = entry.file_type();
		if !file_type.is_some_and(|ft| ft.is_file()) {
			continue;
		}
		let path = entry.into_path();
		if let Some(glob_set) = glob_set {
			let relative = path.strip_prefix(root).unwrap_or(&path);
			if !glob_set.is_match(relative) {
				continue;
			}
		}
		if let Some(filter) = type_filter
			&& !matches_type_filter(&path, filter)
		{
			continue;
		}
		let relative_path = normalize_relative_path(root, &path).into_owned();
		entries.push(FileEntry { path, relative_path });
	}
	entries
}

fn build_matcher(
	pattern: &str,
	ignore_case: bool,
	multiline: bool,
) -> Result<grep_regex::RegexMatcher> {
	RegexMatcherBuilder::new()
		.case_insensitive(ignore_case)
		.multi_line(multiline)
		.build(pattern)
		.map_err(|err| Error::from_reason(format!("Regex error: {err}")))
}

fn run_parallel_search(
	entries: &[FileEntry],
	matcher: &grep_regex::RegexMatcher,
	context: u32,
	max_columns: Option<u32>,
	mode: OutputMode,
) -> Vec<FileSearchResult> {
	let mut results: Vec<FileSearchResult> = entries
		.par_iter()
		.filter_map(|entry| {
			let file = File::open(&entry.path).ok()?;
			let reader = file.take(MAX_FILE_BYTES);
			let search =
				run_search_reader(matcher, reader, context, max_columns, mode, None, 0).ok()?;
			Some(FileSearchResult {
				relative_path: entry.relative_path.clone(),
				matches:       search.matches,
				match_count:   search.match_count,
			})
		})
		.collect();

	results.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
	results
}

fn run_sequential_search(
	entries: &[FileEntry],
	matcher: &grep_regex::RegexMatcher,
	context: u32,
	max_columns: Option<u32>,
	mode: OutputMode,
	max_count: Option<u64>,
	offset: u64,
) -> (Vec<GrepMatch>, u64, u32, u32, bool) {
	let mut matches = Vec::new();
	let mut total_matches = 0u64;
	let mut collected = 0u64;
	let mut files_with_matches = 0u32;
	let mut files_searched = 0u32;
	let mut limit_reached = false;

	for entry in entries {
		if limit_reached {
			break;
		}

		// Calculate offset for this file (skip matches we've already seen)
		let file_offset = offset.saturating_sub(total_matches);
		// Calculate remaining based on collected count, not total matches
		let remaining = max_count.map(|max| max.saturating_sub(collected));
		if remaining == Some(0) {
			limit_reached = true;
			break;
		}

		// Open file and search directly - no intermediate buffer, no precheck scan
		let Ok(file) = File::open(&entry.path) else {
			continue;
		};
		files_searched = files_searched.saturating_add(1);
		let reader = file.take(MAX_FILE_BYTES);

		let Ok(search) =
			run_search_reader(matcher, reader, context, max_columns, mode, remaining, file_offset)
		else {
			continue;
		};

		if search.match_count == 0 {
			continue;
		}

		files_with_matches = files_with_matches.saturating_add(1);
		total_matches = total_matches.saturating_add(search.match_count);
		collected = collected.saturating_add(search.collected);

		match mode {
			OutputMode::Content => {
				for matched in search.matches {
					matches.push(to_grep_match(&entry.relative_path, matched));
				}
			},
			OutputMode::Count => {
				matches.push(GrepMatch {
					path:           entry.relative_path.clone(),
					line_number:    0,
					line:           String::new(),
					context_before: None,
					context_after:  None,
					truncated:      None,
					match_count:    Some(clamp_u32(search.match_count)),
				});
			},
		}

		if search.limit_reached || max_count.is_some_and(|max| collected >= max) {
			limit_reached = true;
		}
	}

	(matches, total_matches, files_with_matches, files_searched, limit_reached)
}

fn search_sync(content: &[u8], options: SearchOptions) -> SearchResult {
	let ignore_case = options.ignore_case.unwrap_or(false);
	let multiline = options.multiline.unwrap_or(false);
	let mode = parse_output_mode(options.mode.as_deref());
	let matcher = match build_matcher(&options.pattern, ignore_case, multiline) {
		Ok(matcher) => matcher,
		Err(err) => return empty_search_result(Some(err.to_string())),
	};

	let context = options.context.unwrap_or(0);
	let max_columns = options.max_columns;
	let max_count = options.max_count.map(u64::from);
	let offset = options.offset.unwrap_or(0) as u64;

	let result = match run_search(&matcher, content, context, max_columns, mode, max_count, offset) {
		Ok(result) => result,
		Err(err) => return empty_search_result(Some(err.to_string())),
	};

	SearchResult {
		matches:       result.matches.into_iter().map(to_public_match).collect(),
		match_count:   clamp_u32(result.match_count),
		limit_reached: result.limit_reached,
		error:         None,
	}
}

fn grep_sync(
	options: GrepOptions,
	on_match: Option<&ThreadsafeFunction<GrepMatch>>,
) -> Result<GrepResult> {
	let search_path = resolve_search_path(&options.path)?;
	let metadata = std::fs::metadata(&search_path)
		.map_err(|err| Error::from_reason(format!("Path not found: {err}")))?;
	let ignore_case = options.ignore_case.unwrap_or(false);
	let multiline = options.multiline.unwrap_or(false);
	let output_mode = parse_output_mode(options.mode.as_deref());
	let matcher = build_matcher(&options.pattern, ignore_case, multiline)?;

	let context = if output_mode == OutputMode::Content {
		options.context.unwrap_or(0)
	} else {
		0
	};
	let max_columns = options.max_columns;
	let max_count = options.max_count.map(u64::from);
	let offset = options.offset.unwrap_or(0) as u64;
	let include_hidden = options.hidden.unwrap_or(true);
	let glob_set = compile_glob(options.glob.as_deref())?;
	let type_filter = resolve_type_filter(options.type_filter.as_deref());

	if metadata.is_file() {
		if let Some(filter) = type_filter.as_ref()
			&& !matches_type_filter(&search_path, filter)
		{
			return Ok(GrepResult {
				matches:            Vec::new(),
				total_matches:      0,
				files_with_matches: 0,
				files_searched:     0,
				limit_reached:      None,
			});
		}

		let Ok(file) = File::open(&search_path) else {
			return Ok(GrepResult {
				matches:            Vec::new(),
				total_matches:      0,
				files_with_matches: 0,
				files_searched:     0,
				limit_reached:      None,
			});
		};
		let reader = file.take(MAX_FILE_BYTES);

		let search =
			run_search_reader(&matcher, reader, context, max_columns, output_mode, max_count, offset)
				.map_err(|err| Error::from_reason(format!("Search failed: {err}")))?;

		if search.match_count == 0 {
			return Ok(GrepResult {
				matches:            Vec::new(),
				total_matches:      0,
				files_with_matches: 0,
				files_searched:     1,
				limit_reached:      None,
			});
		}

		let path_string = search_path.to_string_lossy().to_string();
		let mut matches = Vec::new();
		match output_mode {
			OutputMode::Content => {
				for matched in search.matches {
					matches.push(to_grep_match(&path_string, matched));
				}
			},
			OutputMode::Count => {
				matches.push(GrepMatch {
					path:           path_string,
					line_number:    0,
					line:           String::new(),
					context_before: None,
					context_after:  None,
					truncated:      None,
					match_count:    Some(clamp_u32(search.match_count)),
				});
			},
		}

		let limit_reached =
			search.limit_reached || max_count.is_some_and(|max| search.collected >= max);

		return Ok(GrepResult {
			matches,
			total_matches: clamp_u32(search.match_count),
			files_with_matches: 1,
			files_searched: 1,
			limit_reached: if limit_reached { Some(true) } else { None },
		});
	}

	let entries =
		collect_files(&search_path, glob_set.as_ref(), include_hidden, type_filter.as_ref());

	if entries.is_empty() {
		return Ok(GrepResult {
			matches:            Vec::new(),
			total_matches:      0,
			files_with_matches: 0,
			files_searched:     0,
			limit_reached:      None,
		});
	}

	let allow_parallel = max_count.is_none() && offset == 0;
	if allow_parallel {
		let results = run_parallel_search(&entries, &matcher, context, max_columns, output_mode);
		let mut matches = Vec::new();
		let mut total_matches = 0u64;
		let mut files_with_matches = 0u32;
		let files_searched = clamp_u32(results.len() as u64);

		for result in results {
			if result.match_count == 0 {
				continue;
			}
			files_with_matches = files_with_matches.saturating_add(1);
			total_matches = total_matches.saturating_add(result.match_count);

			match output_mode {
				OutputMode::Content => {
					for matched in result.matches {
						let grep_match = to_grep_match(&result.relative_path, matched);
						if let Some(callback) = on_match {
							callback.call(Ok(grep_match.clone()), ThreadsafeFunctionCallMode::NonBlocking);
						}
						matches.push(grep_match);
					}
				},
				OutputMode::Count => {
					let grep_match = GrepMatch {
						path:           result.relative_path.clone(),
						line_number:    0,
						line:           String::new(),
						context_before: None,
						context_after:  None,
						truncated:      None,
						match_count:    Some(clamp_u32(result.match_count)),
					};
					if let Some(callback) = on_match {
						callback.call(Ok(grep_match.clone()), ThreadsafeFunctionCallMode::NonBlocking);
					}
					matches.push(grep_match);
				},
			}
		}

		return Ok(GrepResult {
			matches,
			total_matches: clamp_u32(total_matches),
			files_with_matches,
			files_searched,
			limit_reached: None,
		});
	}

	let (matches, total_matches, files_with_matches, files_searched, limit_reached) =
		run_sequential_search(
			&entries,
			&matcher,
			context,
			max_columns,
			output_mode,
			max_count,
			offset,
		);

	// Fire callbacks for sequential search results
	if let Some(callback) = on_match {
		for grep_match in &matches {
			callback.call(Ok(grep_match.clone()), ThreadsafeFunctionCallMode::NonBlocking);
		}
	}

	Ok(GrepResult {
		matches,
		total_matches: clamp_u32(total_matches),
		files_with_matches,
		files_searched,
		limit_reached: if limit_reached { Some(true) } else { None },
	})
}

/// Search content for a pattern (one-shot, compiles pattern each time).
/// For repeated searches with the same pattern, use [`grep`] with file filters.
///
/// # Arguments
/// - `content`: `Uint8Array`/`Buffer` (zero-copy) or `string` (UTF-8).
/// - `options`: Regex settings, context, and output mode.
///
/// # Returns
/// Match list plus counts/limit status; errors are surfaced in `error`.
#[napi(js_name = "search")]
pub fn search(content: Either<JsString, Uint8Array>, options: SearchOptions) -> SearchResult {
	match &content {
		Either::A(js_str) => {
			let utf8 = match js_str.into_utf8() {
				Ok(utf8) => utf8,
				Err(err) => return empty_search_result(Some(err.to_string())),
			};
			search_sync(utf8.as_slice(), options)
		},
		Either::B(buf) => search_sync(buf.as_ref(), options),
	}
}

/// Quick check if content matches a pattern.
///
/// # Arguments
/// - `content`: `Uint8Array`/`Buffer` (zero-copy) or `string` (UTF-8).
/// - `pattern`: `Uint8Array`/`Buffer` (zero-copy) or `string` (UTF-8).
/// - `ignore_case`: Case-insensitive matching.
/// - `multiline`: Enable multiline regex mode.
///
/// # Returns
/// True if any match exists; false on no match.
#[napi(js_name = "hasMatch")]
pub fn has_match(
	content: Either<JsString, Uint8Array>,
	pattern: Either<JsString, Uint8Array>,
	ignore_case: bool,
	multiline: bool,
) -> Result<bool> {
	// Hold JsStringUtf8 on the stack and borrow - no copy
	let content_utf8;
	let content_slice: &[u8] = match &content {
		Either::A(js_str) => {
			content_utf8 = js_str.into_utf8()?;
			content_utf8.as_slice()
		},
		Either::B(buf) => buf.as_ref(),
	};

	let pattern_utf8;
	let pattern_string;
	let pattern_ref: &str = match &pattern {
		Either::A(js_str) => {
			pattern_utf8 = js_str.into_utf8()?;
			pattern_utf8.as_str()?
		},
		Either::B(buf) => {
			pattern_string = std::str::from_utf8(buf.as_ref())
				.map_err(|err| Error::from_reason(format!("Invalid UTF-8 in pattern: {err}")))?
				.to_owned();
			&pattern_string
		},
	};

	let matcher = build_matcher(pattern_ref, ignore_case, multiline)?;
	Ok(matcher.is_match(content_slice).unwrap_or(false))
}

/// Search files for a regex pattern.
///
/// # Arguments
/// - `options`: Pattern, path, filters, and output mode.
/// - `on_match`: Optional callback invoked per match/result.
///
/// # Returns
/// Aggregated results across matching files.
#[napi(js_name = "grep")]
pub async fn grep(
	options: GrepOptions,
	#[napi(ts_arg_type = "((match: GrepMatch) => void) | undefined | null")] on_match: Option<
		ThreadsafeFunction<GrepMatch>,
	>,
) -> Result<GrepResult> {
	launch_blocking("grep", move || grep_sync(options, on_match.as_ref()))
		.wait()
		.await
}

// =============================================================================
// Fuzzy Find
// =============================================================================

/// Options for fuzzy file path search.
#[napi(object)]
pub struct FuzzyFindOptions {
	/// Substring query to match against file paths (case-insensitive).
	pub query:       String,
	/// Directory to search.
	pub path:        String,
	/// Include hidden files (default: false).
	pub hidden:      Option<bool>,
	/// Respect .gitignore (default: true).
	pub gitignore:   Option<bool>,
	/// Maximum number of matches to return (default: 100).
	#[napi(js_name = "maxResults")]
	pub max_results: Option<u32>,
}

/// A single match in fuzzy find results.
#[napi(object)]
pub struct FuzzyFindMatch {
	/// Relative path from the search root (uses `/` separators).
	pub path:         String,
	/// Whether this entry is a directory.
	#[napi(js_name = "isDirectory")]
	pub is_directory: bool,
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

fn fuzzy_find_sync(options: FuzzyFindOptions) -> Result<FuzzyFindResult> {
	let root = resolve_search_path(&options.path)?;
	let metadata = std::fs::metadata(&root)
		.map_err(|err| Error::from_reason(format!("Path not found: {err}")))?;

	if !metadata.is_dir() {
		return Err(Error::from_reason("Path must be a directory"));
	}

	let include_hidden = options.hidden.unwrap_or(false);
	let respect_gitignore = options.gitignore.unwrap_or(true);
	let max_results = options.max_results.unwrap_or(100) as usize;
	let query_lower = options.query.to_lowercase();

	let mut builder = WalkBuilder::new(&root);
	builder
		.hidden(!include_hidden)
		.git_ignore(respect_gitignore)
		.git_exclude(respect_gitignore)
		.git_global(respect_gitignore)
		.ignore(respect_gitignore)
		.parents(true)
		.follow_links(false)
		.sort_by_file_path(|a, b| a.cmp(b));

	let mut matches = Vec::with_capacity(max_results.min(256));
	let mut total_matches = 0u32;

	for entry in builder.build() {
		let Ok(entry) = entry else { continue };
		let file_type = entry.file_type();
		let Some(ft) = file_type else { continue };

		// Skip symlinks
		if ft.is_symlink() {
			continue;
		}

		// Skip the root directory itself
		if entry.depth() == 0 {
			continue;
		}

		let entry_path = entry.path();
		let relative = normalize_relative_path(&root, entry_path);

		// Case-insensitive substring match
		if !query_lower.is_empty() && !relative.to_lowercase().contains(&query_lower) {
			continue;
		}

		total_matches = total_matches.saturating_add(1);

		if matches.len() < max_results {
			let is_directory = ft.is_dir();
			let path_str = if is_directory {
				format!("{relative}/")
			} else {
				relative.into_owned()
			};

			matches.push(FuzzyFindMatch { path: path_str, is_directory });
		}
	}

	Ok(FuzzyFindResult { matches, total_matches })
}

/// Fuzzy file path search for autocomplete.
///
/// # Arguments
/// - `options`: Query substring, root path, and limits.
///
/// # Returns
/// Matching file and directory entries.
#[napi(js_name = "fuzzyFind")]
pub async fn fuzzy_find(options: FuzzyFindOptions) -> Result<FuzzyFindResult> {
	launch_blocking("fuzzy_find", move || fuzzy_find_sync(options))
		.wait()
		.await
}
