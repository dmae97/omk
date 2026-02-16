//! Ripgrep-backed search exported via N-API.
//!
//! Provides two layers:
//! - `search()` for in-memory content search.
//! - `grep()` for filesystem search with glob/type filtering.
//!
//! The filesystem search matches the previous JS wrapper behavior, including
//! global offsets, optional match limits, and per-file match summaries.

use std::{
	fs::File,
	io::{self, Cursor, Read},
	path::{Path, PathBuf},
};

use globset::GlobSet;
use grep_matcher::Matcher;
use grep_regex::RegexMatcherBuilder;
use grep_searcher::{
	BinaryDetection, Searcher, SearcherBuilder, Sink, SinkContext, SinkContextKind, SinkMatch,
};
use napi::{
	JsString,
	bindgen_prelude::*,
	threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode},
};
use napi_derive::napi;
use rayon::prelude::*;
use smallvec::SmallVec;

use crate::{fs_cache, glob_util, task};

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
	pub pattern:        String,
	/// Case-insensitive search.
	#[napi(js_name = "ignoreCase")]
	pub ignore_case:    Option<bool>,
	/// Enable multiline matching.
	pub multiline:      Option<bool>,
	/// Maximum number of matches to return.
	#[napi(js_name = "maxCount")]
	pub max_count:      Option<u32>,
	/// Skip first N matches.
	pub offset:         Option<u32>,
	/// Lines of context before matches.
	#[napi(js_name = "contextBefore")]
	pub context_before: Option<u32>,
	/// Lines of context after matches.
	#[napi(js_name = "contextAfter")]
	pub context_after:  Option<u32>,
	/// Lines of context before/after matches (legacy).
	pub context:        Option<u32>,
	/// Truncate lines longer than this (characters).
	#[napi(js_name = "maxColumns")]
	pub max_columns:    Option<u32>,
	/// Output mode (content or count).
	pub mode:           Option<String>,
}

/// Options for searching files on disk.
#[napi(object)]
pub struct GrepOptions<'env> {
	/// Regex pattern to search for.
	pub pattern:        String,
	/// Directory or file to search.
	pub path:           String,
	/// Glob filter for filenames (e.g., "*.ts").
	pub glob:           Option<String>,
	/// Filter by file type (e.g., "js", "py", "rust").
	#[napi(js_name = "type")]
	pub type_filter:    Option<String>,
	/// Case-insensitive search.
	#[napi(js_name = "ignoreCase")]
	pub ignore_case:    Option<bool>,
	/// Enable multiline matching.
	pub multiline:      Option<bool>,
	/// Include hidden files (default: true).
	pub hidden:         Option<bool>,
	/// Enable shared filesystem scan cache (default: false).
	pub cache:          Option<bool>,
	/// Maximum number of matches to return.
	#[napi(js_name = "maxCount")]
	pub max_count:      Option<u32>,
	/// Skip first N matches.
	pub offset:         Option<u32>,
	/// Lines of context before matches.
	#[napi(js_name = "contextBefore")]
	pub context_before: Option<u32>,
	/// Lines of context after matches.
	#[napi(js_name = "contextAfter")]
	pub context_after:  Option<u32>,
	/// Lines of context before/after matches (legacy).
	pub context:        Option<u32>,
	/// Truncate lines longer than this (characters).
	#[napi(js_name = "maxColumns")]
	pub max_columns:    Option<u32>,
	/// Output mode (content, filesWithMatches, or count).
	pub mode:           Option<String>,
	/// Abort signal for cancelling the operation.
	pub signal:         Option<Unknown<'env>>,
	/// Timeout in milliseconds for the operation.
	#[napi(js_name = "timeoutMs")]
	pub timeout_ms:     Option<u32>,
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

enum TypeFilter {
	Known { exts: &'static [&'static str], names: &'static [&'static str] },
	Custom(String),
}

impl TypeFilter {
	fn match_ext(&self, ext: &str) -> bool {
		match self {
			Self::Known { exts, .. } => exts.iter().any(|e| ext.eq_ignore_ascii_case(e)),
			Self::Custom(custom_ext) => ext.eq_ignore_ascii_case(custom_ext),
		}
	}

	fn match_name(&self, name: &str) -> bool {
		match self {
			Self::Known { names, .. } => names.iter().any(|n| name.eq_ignore_ascii_case(n)),
			Self::Custom(ext) => ext.eq_ignore_ascii_case(name),
		}
	}
}

struct MatchCollector {
	matches:         Vec<CollectedMatch>,
	match_count:     u64,
	collected_count: u64,
	max_count:       Option<u64>,
	offset:          u64,
	skipped:         u64,
	limit_reached:   bool,
	context_before:  SmallVec<[ContextLine; 8]>,
	max_columns:     Option<usize>,
	collect_matches: bool,
}

struct CollectedMatch {
	line_number:    u64,
	line:           String,
	context_before: SmallVec<[ContextLine; 8]>,
	context_after:  SmallVec<[ContextLine; 8]>,
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
	fn new(
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
			context_before: SmallVec::new(),
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
				context_after: SmallVec::new(),
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


fn resolve_type_filter(type_name: Option<&str>) -> Option<TypeFilter> {
	let normalized = type_name
		.map(str::trim)
		.filter(|value| !value.is_empty())
		.map(|value| value.trim_start_matches('.').to_lowercase())?;

	let (exts, names): (&[&str], &[&str]) = match normalized.as_str() {
		"js" | "javascript" => (&["js", "jsx", "mjs", "cjs"], &[]),
		"ts" | "typescript" => (&["ts", "tsx", "mts", "cts"], &[]),
		"json" => (&["json", "jsonc", "json5"], &[]),
		"yaml" | "yml" => (&["yaml", "yml"], &[]),
		"toml" => (&["toml"], &[]),
		"md" | "markdown" => (&["md", "markdown", "mdx"], &[]),
		"py" | "python" => (&["py", "pyi"], &[]),
		"rs" | "rust" => (&["rs"], &[]),
		"go" => (&["go"], &[]),
		"java" => (&["java"], &[]),
		"kt" | "kotlin" => (&["kt", "kts"], &[]),
		"c" => (&["c", "h"], &[]),
		"cpp" | "cxx" => (&["cpp", "cc", "cxx", "hpp", "hxx", "hh"], &[]),
		"cs" | "csharp" => (&["cs", "csx"], &[]),
		"php" => (&["php", "phtml"], &[]),
		"rb" | "ruby" => (&["rb", "rake", "gemspec"], &[]),
		"sh" | "bash" => (&["sh", "bash", "zsh"], &[]),
		"zsh" => (&["zsh"], &[]),
		"fish" => (&["fish"], &[]),
		"html" => (&["html", "htm"], &[]),
		"css" => (&["css"], &[]),
		"scss" => (&["scss"], &[]),
		"sass" => (&["sass"], &[]),
		"less" => (&["less"], &[]),
		"xml" => (&["xml"], &[]),
		"docker" | "dockerfile" => (&[], &["dockerfile"]),
		"make" | "makefile" => (&[], &["makefile"]),
		_ => {
			return Some(TypeFilter::Custom(normalized));
		},
	};

	Some(TypeFilter::Known { exts, names })
}

fn matches_type_filter(path: &Path, filter: &TypeFilter) -> bool {
	let base_name = path
		.file_name()
		.and_then(|name| name.to_str())
		.unwrap_or("");
	if filter.match_name(base_name) {
		return true;
	}
	let ext = path.extension().and_then(|ext| ext.to_str()).unwrap_or("");
	if ext.is_empty() {
		return false;
	}
	filter.match_ext(ext)
}

fn resolve_context(
	context: Option<u32>,
	context_before: Option<u32>,
	context_after: Option<u32>,
) -> (u32, u32) {
	if context_before.is_some() || context_after.is_some() {
		(context_before.unwrap_or(0), context_after.unwrap_or(0))
	} else {
		let value = context.unwrap_or(0);
		(value, value)
	}
}

fn build_searcher(before_context: u32, after_context: u32) -> Searcher {
	SearcherBuilder::new()
		.binary_detection(BinaryDetection::quit(b'\x00'))
		.line_number(true)
		.before_context(before_context as usize)
		.after_context(after_context as usize)
		.build()
}

#[derive(Clone, Copy)]
struct SearchParams {
	context_before: u32,
	context_after:  u32,
	max_columns:    Option<u32>,
	mode:           OutputMode,
	max_count:      Option<u64>,
	offset:         u64,
}

fn run_search(
	matcher: &grep_regex::RegexMatcher,
	content: &[u8],
	params: SearchParams,
) -> io::Result<SearchResultInternal> {
	run_search_reader(matcher, Cursor::new(content), params)
}

/// Stream-based search that reads directly from a `Read` without buffering.
fn run_search_reader<R: Read>(
	matcher: &grep_regex::RegexMatcher,
	reader: R,
	params: SearchParams,
) -> io::Result<SearchResultInternal> {
	let mut searcher = build_searcher(
		if params.mode == OutputMode::Content {
			params.context_before
		} else {
			0
		},
		if params.mode == OutputMode::Content {
			params.context_after
		} else {
			0
		},
	);
	let mut collector = MatchCollector::new(
		params.max_count,
		params.offset,
		params.max_columns.map(|v| v as usize),
		params.mode == OutputMode::Content,
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
		Some(matched.context_before.into_vec())
	};
	let context_after = if matched.context_after.is_empty() {
		None
	} else {
		Some(matched.context_after.into_vec())
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
		Some(matched.context_before.into_vec())
	};
	let context_after = if matched.context_after.is_empty() {
		None
	} else {
		Some(matched.context_after.into_vec())
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

/// Internal configuration for grep, extracted from options.
struct GrepConfig {
	pattern:        String,
	path:           String,
	glob:           Option<String>,
	type_filter:    Option<String>,
	ignore_case:    Option<bool>,
	multiline:      Option<bool>,
	hidden:         Option<bool>,
	cache:          Option<bool>,
	max_count:      Option<u32>,
	offset:         Option<u32>,
	context_before: Option<u32>,
	context_after:  Option<u32>,
	context:        Option<u32>,
	max_columns:    Option<u32>,
	mode:           Option<String>,
}

fn collect_files(
	root: &Path,
	scanned_entries: &[fs_cache::GlobMatch],
	glob_set: Option<&GlobSet>,
	type_filter: Option<&TypeFilter>,
) -> Vec<FileEntry> {
	let mut entries = Vec::new();
	for entry in scanned_entries {
		if entry.file_type != fs_cache::FileType::File {
			continue;
		}
		if let Some(glob_set) = glob_set
			&& !glob_set.is_match(Path::new(&entry.path))
		{
			continue;
		}
		let path = root.join(&entry.path);
		if let Some(filter) = type_filter
			&& !matches_type_filter(&path, filter)
		{
			continue;
		}
		entries.push(FileEntry { path, relative_path: entry.path.clone() });
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
	context_before: u32,
	context_after: u32,
	max_columns: Option<u32>,
	mode: OutputMode,
) -> Vec<FileSearchResult> {
	let params =
		SearchParams { context_before, context_after, max_columns, mode, max_count: None, offset: 0 };
	let mut results: Vec<FileSearchResult> = entries
		.par_iter()
		.filter_map(|entry| {
			let file = File::open(&entry.path).ok()?;
			let reader = file.take(MAX_FILE_BYTES);
			let search = run_search_reader(matcher, reader, params).ok()?;
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
	params: SearchParams,
) -> (Vec<GrepMatch>, u64, u32, u32, bool) {
	let SearchParams { mode, max_count, offset, .. } = params;
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

		let file_params = SearchParams { max_count: remaining, offset: file_offset, ..params };
		let Ok(search) = run_search_reader(matcher, reader, file_params) else {
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

	let (context_before, context_after) =
		resolve_context(options.context, options.context_before, options.context_after);
	let max_columns = options.max_columns;
	let max_count = options.max_count.map(u64::from);
	let offset = options.offset.unwrap_or(0) as u64;
	let params =
		SearchParams { context_before, context_after, max_columns, mode, max_count, offset };

	let result = match run_search(&matcher, content, params) {
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
	options: GrepConfig,
	on_match: Option<&ThreadsafeFunction<GrepMatch>>,
	ct: task::CancelToken,
) -> Result<GrepResult> {
	let search_path = resolve_search_path(&options.path)?;
	let metadata = std::fs::metadata(&search_path)
		.map_err(|err| Error::from_reason(format!("Path not found: {err}")))?;
	let ignore_case = options.ignore_case.unwrap_or(false);
	let multiline = options.multiline.unwrap_or(false);
	let output_mode = parse_output_mode(options.mode.as_deref());
	let matcher = build_matcher(&options.pattern, ignore_case, multiline)?;

	let (context_before, context_after) =
		resolve_context(options.context, options.context_before, options.context_after);
	let (context_before, context_after) = if output_mode == OutputMode::Content {
		(context_before, context_after)
	} else {
		(0, 0)
	};
	let max_columns = options.max_columns;
	let max_count = options.max_count.map(u64::from);
	let offset = options.offset.unwrap_or(0) as u64;
	let include_hidden = options.hidden.unwrap_or(true);
	let use_cache = options.cache.unwrap_or(false);
	let glob_set = glob_util::try_compile_glob(options.glob.as_deref(), true)?;
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

		let params = SearchParams {
			context_before,
			context_after,
			max_columns,
			mode: output_mode,
			max_count,
			offset,
		};
		let search = run_search_reader(&matcher, reader, params)
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

	let entries = if use_cache {
		let scan = fs_cache::get_or_scan(&search_path, include_hidden, true, &ct)?;
		let mut entries =
			collect_files(&search_path, &scan.entries, glob_set.as_ref(), type_filter.as_ref());
		if entries.is_empty() && scan.cache_age_ms >= fs_cache::empty_recheck_ms() {
			let fresh = fs_cache::force_rescan(&search_path, include_hidden, true, true, &ct)?;
			entries = collect_files(&search_path, &fresh, glob_set.as_ref(), type_filter.as_ref());
		}
		entries
	} else {
		let fresh = fs_cache::force_rescan(&search_path, include_hidden, true, false, &ct)?;
		collect_files(&search_path, &fresh, glob_set.as_ref(), type_filter.as_ref())
	};
	// Check cancellation before heavy work
	ct.heartbeat()?;
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
		let results = run_parallel_search(
			&entries,
			&matcher,
			context_before,
			context_after,
			max_columns,
			output_mode,
		);
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
		run_sequential_search(&entries, &matcher, SearchParams {
			context_before,
			context_after,
			max_columns,
			mode: output_mode,
			max_count,
			offset,
		});

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
pub fn grep(
	options: GrepOptions<'_>,
	#[napi(ts_arg_type = "((match: GrepMatch) => void) | undefined | null")] on_match: Option<
		ThreadsafeFunction<GrepMatch>,
	>,
) -> task::Async<GrepResult> {
	let GrepOptions {
		pattern,
		path,
		glob,
		type_filter,
		ignore_case,
		multiline,
		hidden,
		cache,
		max_count,
		offset,
		context_before,
		context_after,
		context,
		max_columns,
		mode,
		timeout_ms,
		signal,
	} = options;

	let config = GrepConfig {
		pattern,
		path,
		glob,
		type_filter,
		ignore_case,
		multiline,
		hidden,
		cache,
		max_count,
		offset,
		context_before,
		context_after,
		context,
		max_columns,
		mode,
	};

	let ct = task::CancelToken::new(timeout_ms, signal);
	task::blocking("grep", ct, move |ct| grep_sync(config, on_match.as_ref(), ct))
}
