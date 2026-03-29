//! Search engine exported via N-API.
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
	io,
	ops::Range,
	path::{Path, PathBuf},
};

use fff_grep::{Searcher, SearcherBuilder, Sink, SinkMatch};
use globset::GlobSet;
use grep_matcher::Matcher;
use grep_regex::RegexMatcherBuilder;
use napi::{
	JsString,
	bindgen_prelude::*,
	threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode},
};
use napi_derive::napi;
use rayon::prelude::*;
use smallvec::SmallVec;

use crate::{
	fs_cache, glob_util,
	search_db::{SearchDb, wait_for_picker_scan},
	task,
};

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
	/// Respect .gitignore files (default: true).
	pub gitignore:      Option<bool>,
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

// ---------------------------------------------------------------------------
// Internal match collection
// ---------------------------------------------------------------------------

struct MatchCollector {
	matches:         Vec<CollectedMatch>,
	match_count:     u64,
	collected_count: u64,
	max_count:       Option<u64>,
	offset:          u64,
	skipped:         u64,
	limit_reached:   bool,
	max_columns:     Option<usize>,
	collect_matches: bool,
	before_count:    usize,
	after_count:     usize,
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
	path:                  PathBuf,
	relative_path:         String,
	prefer_text_fast_path: bool,
}

struct FileSearchResult {
	relative_path: String,
	matches:       Vec<CollectedMatch>,
	match_count:   u64,
}

enum FileBytes {
	Mapped(memmap2::Mmap),
	Owned(Vec<u8>),
}

impl FileBytes {
	fn as_slice(&self) -> &[u8] {
		match self {
			Self::Mapped(mapped) => mapped.as_ref(),
			Self::Owned(bytes) => bytes.as_slice(),
		}
	}
}

impl MatchCollector {
	const fn new(
		max_count: Option<u64>,
		offset: u64,
		max_columns: Option<usize>,
		collect_matches: bool,
		before_count: usize,
		after_count: usize,
	) -> Self {
		Self {
			matches: Vec::new(),
			match_count: 0,
			collected_count: 0,
			max_count,
			offset,
			skipped: 0,
			limit_reached: false,
			max_columns,
			collect_matches,
			before_count,
			after_count,
		}
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn truncate_line(line: &str, max_columns: Option<usize>) -> (String, bool) {
	match max_columns {
		Some(max) if line.len() > max => {
			let cut = max.saturating_sub(3);
			let boundary = line.floor_char_boundary(cut);
			(format!("{}...", &line[..boundary]), true)
		},
		_ => (line.to_string(), false),
	}
}

const KNOWN_TEXT_EXTENSIONS: &[&str] = &[
	"js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts", "json", "jsonc", "json5", "yaml", "yml",
	"toml", "md", "markdown", "mdx", "py", "pyi", "rs", "go", "java", "kt", "kts", "c", "h", "cpp",
	"cc", "cxx", "hpp", "hxx", "hh", "cs", "csx", "php", "phtml", "rb", "rake", "gemspec", "sh",
	"bash", "zsh", "fish", "html", "htm", "css", "scss", "sass", "less", "xml",
];

fn is_known_text_extension(ext: &str) -> bool {
	KNOWN_TEXT_EXTENSIONS
		.iter()
		.any(|&e| ext.eq_ignore_ascii_case(e))
}

fn is_known_text_path(path: &Path) -> bool {
	let file_name = path
		.file_name()
		.and_then(|name| name.to_str())
		.unwrap_or("");
	if file_name.eq_ignore_ascii_case("dockerfile") || file_name.eq_ignore_ascii_case("makefile") {
		return true;
	}

	let ext = path.extension().and_then(|ext| ext.to_str()).unwrap_or("");
	!ext.is_empty() && is_known_text_extension(ext)
}

fn bytes_to_trimmed_string(bytes: &[u8]) -> String {
	match std::str::from_utf8(bytes) {
		Ok(text) => text.trim_end().to_string(),
		Err(_) => String::from_utf8_lossy(bytes).trim_end().to_string(),
	}
}

/// Extract context lines before and after a match from the searched buffer.
///
/// `match_range` is the byte range of the matched line(s) within `buffer`.
/// `match_line_number` is the 1-indexed line number of the first matched line.
fn extract_context_lines(
	buffer: &[u8],
	match_range: Range<usize>,
	before: usize,
	after: usize,
	match_line_number: u64,
	max_columns: Option<usize>,
) -> (SmallVec<[ContextLine; 8]>, SmallVec<[ContextLine; 8]>) {
	let mut before_lines = SmallVec::new();
	let mut after_lines = SmallVec::new();

	// --- Before context ---
	if before > 0 && match_range.start > 0 {
		let mut end = match_range.start;
		let mut line_num = match_line_number;

		for _ in 0..before {
			if end == 0 || line_num == 0 {
				break;
			}
			// Skip trailing newline of the previous line
			let content_end = if buffer[end - 1] == b'\n' {
				end - 1
			} else {
				end
			};
			// Find start of this line (search backward for newline)
			let start = match buffer[..content_end].iter().rposition(|&b| b == b'\n') {
				Some(pos) => pos + 1,
				None => 0,
			};
			line_num -= 1;
			let raw = bytes_to_trimmed_string(&buffer[start..content_end]);
			let (line, _) = truncate_line(&raw, max_columns);
			before_lines.push(ContextLine { line_number: crate::utils::clamp_u32(line_num), line });
			end = start;
		}
		before_lines.reverse();
	}

	// --- After context ---
	if after > 0 && match_range.end < buffer.len() {
		// Count newlines in match bytes to find the first after-context line number.
		// Line-oriented search includes trailing \n, so newline count equals line
		// count. If the match lacks a trailing \n (last line of file),
		// match_range.end == buffer.len() and this branch is skipped entirely.
		#[allow(clippy::naive_bytecount, reason = "match spans 1-2 lines; not worth a dependency")]
		let newlines = buffer[match_range.clone()]
			.iter()
			.filter(|&&b| b == b'\n')
			.count() as u64;
		let mut start = match_range.end;
		for line_num in (match_line_number + newlines)..(match_line_number + newlines + after as u64)
		{
			if start >= buffer.len() {
				break;
			}
			let end = match buffer[start..].iter().position(|&b| b == b'\n') {
				Some(pos) => start + pos,
				None => buffer.len(),
			};
			let raw = bytes_to_trimmed_string(&buffer[start..end]);
			let (line, _) = truncate_line(&raw, max_columns);
			after_lines.push(ContextLine { line_number: crate::utils::clamp_u32(line_num), line });
			start = end + 1;
		}
	}

	(before_lines, after_lines)
}

// ---------------------------------------------------------------------------
// Sink implementation for fff-grep
// ---------------------------------------------------------------------------

impl Sink for MatchCollector {
	type Error = io::Error;

	fn matched(
		&mut self,
		_searcher: &Searcher,
		mat: &SinkMatch<'_>,
	) -> std::result::Result<bool, Self::Error> {
		self.match_count += 1;

		if self.limit_reached {
			return Ok(false);
		}

		if self.skipped < self.offset {
			self.skipped += 1;
			return Ok(true);
		}

		if self.collect_matches {
			let raw_line = bytes_to_trimmed_string(mat.bytes());
			let (line, truncated) = truncate_line(&raw_line, self.max_columns);
			let line_number = mat.line_number().unwrap_or(0);

			let (context_before, context_after) = if self.before_count > 0 || self.after_count > 0 {
				extract_context_lines(
					mat.buffer(),
					mat.bytes_range_in_buffer(),
					self.before_count,
					self.after_count,
					line_number,
					self.max_columns,
				)
			} else {
				(SmallVec::new(), SmallVec::new())
			};

			self.matches.push(CollectedMatch {
				line_number,
				line,
				context_before,
				context_after,
				truncated,
			});
		}

		self.collected_count += 1;

		if let Some(max) = self.max_count
			&& self.collected_count >= max
		{
			self.limit_reached = true;
		}

		Ok(true)
	}
}

// ---------------------------------------------------------------------------
// Option resolution
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Search engine
// ---------------------------------------------------------------------------

#[derive(Clone, Copy)]
struct SearchParams {
	context_before: u32,
	context_after:  u32,
	max_columns:    Option<u32>,
	mode:           OutputMode,
	max_count:      Option<u64>,
	offset:         u64,
	multiline:      bool,
}

fn run_search(
	searcher: &Searcher,
	matcher: &grep_regex::RegexMatcher,
	content: &[u8],
	params: SearchParams,
) -> io::Result<SearchResultInternal> {
	let collect_matches = params.mode == OutputMode::Content;
	let (before, after) = if collect_matches {
		(params.context_before as usize, params.context_after as usize)
	} else {
		(0, 0)
	};

	let mut collector = MatchCollector::new(
		params.max_count,
		params.offset,
		params.max_columns.map(|v| v as usize),
		collect_matches,
		before,
		after,
	);

	searcher.search_slice(matcher, content, &mut collector)?;

	Ok(SearchResultInternal {
		matches:       collector.matches,
		match_count:   collector.match_count,
		collected:     collector.collected_count,
		limit_reached: collector.limit_reached,
	})
}

fn build_searcher(multiline: bool) -> Searcher {
	SearcherBuilder::new()
		.line_number(true)
		.multi_line(multiline)
		.build()
}

/// Read file bytes, returning `None` for oversized or binary files.
fn read_file_bytes(path: &Path, prefer_text_fast_path: bool) -> io::Result<Option<FileBytes>> {
	let metadata = std::fs::symlink_metadata(path)?;
	let resolved_metadata = if metadata.file_type().is_symlink() {
		let target_metadata = std::fs::metadata(path)?;
		if !target_metadata.is_file() {
			return Ok(None);
		}
		target_metadata
	} else if metadata.is_file() {
		metadata
	} else {
		return Ok(None);
	};
	if resolved_metadata.len() > MAX_FILE_BYTES {
		return Ok(None);
	} else if resolved_metadata.len() == 0 {
		return Ok(Some(FileBytes::Owned(Vec::new())));
	}
	let file = File::open(path)?;

	let mapping = unsafe {
		// SAFETY: The mapping is read-only and tied to the opened file handle.
		// We do not mutate through this view; the map is dropped immediately
		// after search for each file.
		memmap2::Mmap::map(&file)
	};

	let bytes = if let Ok(mapped) = mapping {
		FileBytes::Mapped(mapped)
	} else {
		FileBytes::Owned(std::fs::read(path)?)
	};

	// For known text-like source/config paths in picker-backed searches, use a
	// small binary probe (first 512 bytes). Unknown file kinds keep the strict
	// full-buffer NUL scan.
	if prefer_text_fast_path && is_known_text_path(path) {
		let slice = bytes.as_slice();
		let probe_len = slice.len().min(512);
		if slice[..probe_len].contains(&0) {
			return Ok(None);
		}
	} else if bytes.as_slice().contains(&0) {
		return Ok(None);
	}
	Ok(Some(bytes))
}

// ---------------------------------------------------------------------------
// Result conversion
// ---------------------------------------------------------------------------

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
		line_number: crate::utils::clamp_u32(matched.line_number),
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
		line_number: crate::utils::clamp_u32(matched.line_number),
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
	gitignore:      Option<bool>,
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
		entries.push(FileEntry {
			path,
			relative_path: entry.path.clone(),
			prefer_text_fast_path: false,
		});
	}
	entries
}

/// Returns true if any path component starts with `.` (hidden file/dir).
fn has_hidden_component(path: &str) -> bool {
	path.split('/').any(|c| c.starts_with('.'))
}

/// Collect files from the `SearchDb` picker, applying glob and type filters.
///
/// Used in place of `collect_files` when a live picker index is available.
/// The picker already respects gitignore; hidden-file filtering is applied
/// here when `include_hidden` is false.
fn collect_files_from_picker(
	root: &Path,
	db: &SearchDb,
	glob_set: Option<&GlobSet>,
	type_filter: Option<&TypeFilter>,
	include_hidden: bool,
	ct: &task::CancelToken,
) -> Result<Vec<FileEntry>> {
	let shared_picker = db.get_or_init_picker(root)?;
	ct.heartbeat()?;
	// Wait for the background scan to finish.  On repeated calls this is a
	// no-op (the signal is already cleared).  On first call it blocks until
	// the initial directory walk completes, which is equivalent in latency
	// to a fresh fs_cache::force_rescan but is then never repeated.
	wait_for_picker_scan(&shared_picker, ct)?;

	let guard = shared_picker
		.read()
		.map_err(|_| Error::from_reason("shared picker lock poisoned"))?;
	let Some(picker) = guard.as_ref() else {
		return Ok(Vec::new());
	};

	let mut entries = Vec::new();
	for file in picker.get_files() {
		if !include_hidden && has_hidden_component(&file.relative_path) {
			continue;
		}
		if let Some(glob_set) = glob_set
			&& !glob_set.is_match(Path::new(&file.relative_path))
		{
			continue;
		}
		let path = root.join(&file.relative_path);
		if let Some(filter) = type_filter
			&& !matches_type_filter(&path, filter)
		{
			continue;
		}
		entries.push(FileEntry {
			path,
			relative_path: file.relative_path.clone(),
			prefer_text_fast_path: true,
		});
	}
	Ok(entries)
}
// ---------------------------------------------------------------------------
// Regex brace sanitization
// ---------------------------------------------------------------------------

/// Check if `bytes[start]` (which must be `b'{'`) begins a valid repetition
/// quantifier: `{N}`, `{N,}`, or `{N,M}` where N and M are decimal digits.
/// Returns the byte index of the closing `}` if valid.
fn find_valid_repetition(bytes: &[u8], start: usize) -> Option<usize> {
	let len = bytes.len();
	let mut i = start + 1;
	// Must start with at least one digit.
	if i >= len || !bytes[i].is_ascii_digit() {
		return None;
	}
	while i < len && bytes[i].is_ascii_digit() {
		i += 1;
	}
	if i >= len {
		return None;
	}
	if bytes[i] == b'}' {
		return Some(i);
	}
	if bytes[i] != b',' {
		return None;
	}
	i += 1;
	if i >= len {
		return None;
	}
	// After comma: optional digits then `}`.
	while i < len && bytes[i].is_ascii_digit() {
		i += 1;
	}
	if i < len && bytes[i] == b'}' {
		return Some(i);
	}
	None
}

fn find_braced_escape_end(bytes: &[u8], start: usize) -> Option<usize> {
	let mut i = start + 1;
	while i < bytes.len() {
		if bytes[i] == b'}' {
			return Some(i);
		}
		i += 1;
	}
	None
}

/// Escape `{` and `}` that don't form valid repetition quantifiers.
///
/// Patterns like `${platform}` or `a{b}` contain braces the regex engine
/// rejects as malformed repetitions. Since such braces can never be valid
/// regex syntax, turning them into `\{` / `\}` is semantics-preserving
/// and avoids confusing error messages for callers who pass literal text
/// fragments (e.g. JS template strings).
fn sanitize_braces(pattern: &str) -> Cow<'_, str> {
	let bytes = pattern.as_bytes();
	if !bytes.contains(&b'{') && !bytes.contains(&b'}') {
		return Cow::Borrowed(pattern);
	}

	let len = bytes.len();
	let mut result = String::with_capacity(len + 8);
	let mut modified = false;
	let mut i = 0;

	while i < len {
		// Pass escaped characters through unchanged.
		if bytes[i] == b'\\' && i + 1 < len {
			result.push('\\');
			i += 1;
			// The next character is the escaped literal; push it regardless.
			// Safety: index is in bounds (checked above).
			let ch = pattern[i..]
				.chars()
				.next()
				.expect("non-empty slice has a char");
			result.push(ch);
			i += ch.len_utf8();
			if matches!(ch, 'p' | 'P' | 'x' | 'u') && i < len && bytes[i] == b'{' {
				if let Some(end) = find_braced_escape_end(bytes, i) {
					result.push_str(&pattern[i..=end]);
					i = end + 1;
				} else {
					result.push_str(&pattern[i..]);
					i = len;
				}
			}
			continue;
		}

		if bytes[i] == b'{' {
			if let Some(end) = find_valid_repetition(bytes, i) {
				result.push_str(&pattern[i..=end]);
				i = end + 1;
				continue;
			}
			result.push_str("\\{");
			i += 1;
			modified = true;
			continue;
		}

		if bytes[i] == b'}' {
			result.push_str("\\}");
			i += 1;
			modified = true;
			continue;
		}

		let ch = pattern[i..]
			.chars()
			.next()
			.expect("non-empty slice has a char");
		result.push(ch);
		i += ch.len_utf8();
	}

	if modified {
		Cow::Owned(result)
	} else {
		Cow::Borrowed(pattern)
	}
}

/// Escape unescaped parentheses after a group-syntax regex error.
///
/// Search patterns like `fetchAnthropicProvider(` are common literal snippets,
/// but the regex engine parses the trailing `(` as the start of a capture
/// group. When the parser already reported invalid group syntax, escaping any
/// remaining literal parentheses preserves useful search behavior without
/// changing valid regexes.
fn escape_unescaped_parentheses(pattern: &str) -> Cow<'_, str> {
	let bytes = pattern.as_bytes();
	if !bytes.contains(&b'(') && !bytes.contains(&b')') {
		return Cow::Borrowed(pattern);
	}

	let mut result = String::with_capacity(pattern.len() + 4);
	let mut modified = false;
	let mut i = 0;

	while i < bytes.len() {
		if bytes[i] == b'\\' && i + 1 < bytes.len() {
			result.push('\\');
			i += 1;
			let ch = pattern[i..]
				.chars()
				.next()
				.expect("non-empty slice has a char");
			result.push(ch);
			i += ch.len_utf8();
			continue;
		}

		let ch = pattern[i..]
			.chars()
			.next()
			.expect("non-empty slice has a char");
		if matches!(ch, '(' | ')') {
			result.push('\\');
			modified = true;
		}
		result.push(ch);
		i += ch.len_utf8();
	}

	if modified {
		Cow::Owned(result)
	} else {
		Cow::Borrowed(pattern)
	}
}

fn build_regex_matcher(
	pattern: &str,
	ignore_case: bool,
	multiline: bool,
) -> std::result::Result<grep_regex::RegexMatcher, grep_regex::Error> {
	RegexMatcherBuilder::new()
		.case_insensitive(ignore_case)
		.multi_line(multiline)
		.build(pattern)
}

#[cfg(test)]
mod tests {
	#[cfg(unix)]
	use std::{ffi::CString, os::unix::ffi::OsStrExt};
	use std::{
		fs,
		path::{Path, PathBuf},
		time::{SystemTime, UNIX_EPOCH},
	};

	use super::{GrepConfig, escape_unescaped_parentheses, grep_sync, sanitize_braces};
	use crate::task;

	struct TempDirGuard(PathBuf);

	impl TempDirGuard {
		fn new() -> Self {
			let unique = SystemTime::now()
				.duration_since(UNIX_EPOCH)
				.expect("system time is after UNIX_EPOCH")
				.as_nanos();
			let path = std::env::temp_dir().join(format!("pi-grep-test-{unique}"));
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

	#[cfg(unix)]
	fn make_fifo(path: &Path) {
		let fifo_path =
			CString::new(path.as_os_str().as_bytes()).expect("fifo path has no NUL bytes");
		// SAFETY: `fifo_path` is a valid CString (NUL-terminated, no interior NULs),
		// so `as_ptr()` yields a valid C string pointer. `0o600` is a valid mode.
		// The CString is alive for the duration of the call.
		let rc = unsafe { libc::mkfifo(fifo_path.as_ptr(), 0o600) };
		assert_eq!(rc, 0, "create fifo: {}", std::io::Error::last_os_error());
	}

	#[cfg(unix)]
	fn base_grep_config(path: &Path) -> GrepConfig {
		GrepConfig {
			pattern:        "needle".to_string(),
			path:           path.to_string_lossy().into_owned(),
			glob:           None,
			type_filter:    None,
			ignore_case:    None,
			multiline:      None,
			hidden:         None,
			gitignore:      Some(false),
			cache:          Some(false),
			max_count:      None,
			offset:         None,
			context_before: None,
			context_after:  None,
			context:        None,
			max_columns:    None,
			mode:           None,
		}
	}

	#[test]
	fn preserves_unicode_property_escapes() {
		assert_eq!(sanitize_braces(r"\p{Greek}").as_ref(), r"\p{Greek}");
	}

	#[test]
	fn preserves_hex_brace_escapes() {
		assert_eq!(sanitize_braces(r"\x{41}").as_ref(), r"\x{41}");
	}

	#[test]
	fn preserves_malformed_braced_escapes() {
		assert_eq!(sanitize_braces(r"\p{Greek").as_ref(), r"\p{Greek");
	}

	#[test]
	fn escapes_non_quantifier_braces() {
		assert_eq!(sanitize_braces("${platform}").as_ref(), "$\\{platform\\}");
	}

	#[test]
	fn preserves_valid_quantifiers() {
		assert_eq!(sanitize_braces("a{2,4}").as_ref(), "a{2,4}");
	}

	#[test]
	fn preserves_escaped_parentheses() {
		assert_eq!(escape_unescaped_parentheses(r"foo\(bar\)").as_ref(), r"foo\(bar\)");
	}

	#[test]
	fn escapes_literal_parentheses() {
		assert_eq!(
			escape_unescaped_parentheses("fetchAnthropicProvider(").as_ref(),
			r"fetchAnthropicProvider\("
		);
		assert_eq!(
			escape_unescaped_parentheses("fetchAnthropicProvider()").as_ref(),
			r"fetchAnthropicProvider\(\)"
		);
	}

	#[cfg(unix)]
	#[test]
	fn grep_directory_skips_fifo_entries() {
		let root = TempDirGuard::new();
		write_file(&root.path().join("regular.txt"), "needle\n");
		make_fifo(&root.path().join("skip-me.fifo"));

		let result =
			grep_sync(base_grep_config(root.path()), None, None, task::CancelToken::default())
				.expect("directory grep should succeed");

		assert_eq!(result.total_matches, 1);
		assert_eq!(result.files_with_matches, 1);
		assert_eq!(result.files_searched, 1);
		assert_eq!(result.matches.len(), 1);
		assert_eq!(result.matches[0].path, "regular.txt");
	}

	#[cfg(unix)]
	#[test]
	fn grep_special_root_path_returns_empty_result() {
		let root = TempDirGuard::new();
		let fifo = root.path().join("direct.fifo");
		make_fifo(&fifo);

		let result = grep_sync(base_grep_config(&fifo), None, None, task::CancelToken::default())
			.expect("special-file grep should return an empty result");

		assert!(result.matches.is_empty());
		assert_eq!(result.total_matches, 0);
		assert_eq!(result.files_with_matches, 0);
		assert_eq!(result.files_searched, 0);
		assert_eq!(result.limit_reached, None);
	}
}

fn build_matcher(
	pattern: &str,
	ignore_case: bool,
	multiline: bool,
) -> Result<grep_regex::RegexMatcher> {
	let sanitized = sanitize_braces(pattern);
	match build_regex_matcher(sanitized.as_ref(), ignore_case, multiline) {
		Ok(matcher) => Ok(matcher),
		Err(err) => {
			let message = err.to_string();
			if message.contains("unclosed group") || message.contains("unopened group") {
				let escaped = escape_unescaped_parentheses(sanitized.as_ref());
				if escaped.as_ref() != sanitized.as_ref() {
					return build_regex_matcher(escaped.as_ref(), ignore_case, multiline)
						.map_err(|retry_err| Error::from_reason(format!("Regex error: {retry_err}")));
				}
			}
			Err(Error::from_reason(format!("Regex error: {message}")))
		},
	}
}

// ---------------------------------------------------------------------------
// File / directory search orchestration
// ---------------------------------------------------------------------------

fn run_parallel_search(
	entries: &[FileEntry],
	matcher: &grep_regex::RegexMatcher,
	params: SearchParams,
) -> Vec<FileSearchResult> {
	let file_params = SearchParams { max_count: None, offset: 0, ..params };
	let mut results: Vec<FileSearchResult> = entries
		.par_iter()
		.map_init(
			|| build_searcher(file_params.multiline),
			|searcher, entry| {
				let bytes = read_file_bytes(&entry.path, entry.prefer_text_fast_path).ok()??;
				let search = run_search(searcher, matcher, bytes.as_slice(), file_params).ok()?;
				Some(FileSearchResult {
					relative_path: entry.relative_path.clone(),
					matches:       search.matches,
					match_count:   search.match_count,
				})
			},
		)
		.filter_map(std::convert::identity)
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
	let searcher = build_searcher(params.multiline);
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

		let Ok(Some(bytes)) = read_file_bytes(&entry.path, entry.prefer_text_fast_path) else {
			continue;
		};
		files_searched = files_searched.saturating_add(1);

		let file_params = SearchParams { max_count: remaining, offset: file_offset, ..params };
		let Ok(search) = run_search(&searcher, matcher, bytes.as_slice(), file_params) else {
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
					match_count:    Some(crate::utils::clamp_u32(search.match_count)),
				});
			},
		}

		if search.limit_reached || max_count.is_some_and(|max| collected >= max) {
			limit_reached = true;
		}
	}

	(matches, total_matches, files_with_matches, files_searched, limit_reached)
}

// ---------------------------------------------------------------------------
// Sync entry points
// ---------------------------------------------------------------------------

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
	let params = SearchParams {
		context_before,
		context_after,
		max_columns,
		mode,
		max_count,
		offset,
		multiline,
	};
	let searcher = build_searcher(multiline);

	let result = match run_search(&searcher, &matcher, content, params) {
		Ok(result) => result,
		Err(err) => return empty_search_result(Some(err.to_string())),
	};

	SearchResult {
		matches:       result.matches.into_iter().map(to_public_match).collect(),
		match_count:   crate::utils::clamp_u32(result.match_count),
		limit_reached: result.limit_reached,
		error:         None,
	}
}

fn grep_sync(
	options: GrepConfig,
	db: Option<SearchDb>,
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
	let use_gitignore = options.gitignore.unwrap_or(true);
	let use_cache = options.cache.unwrap_or(false);
	let glob_set = glob_util::try_compile_glob(options.glob.as_deref(), true)?;
	let type_filter = resolve_type_filter(options.type_filter.as_deref());

	let params = SearchParams {
		context_before,
		context_after,
		max_columns,
		mode: output_mode,
		max_count,
		offset,
		multiline,
	};
	let searcher = build_searcher(multiline);

	if !metadata.is_file() && !metadata.is_dir() {
		return Ok(GrepResult {
			matches:            Vec::new(),
			total_matches:      0,
			files_with_matches: 0,
			files_searched:     0,
			limit_reached:      None,
		});
	}

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

		let Ok(Some(bytes)) = read_file_bytes(&search_path, false) else {
			return Ok(GrepResult {
				matches:            Vec::new(),
				total_matches:      0,
				files_with_matches: 0,
				files_searched:     0,
				limit_reached:      None,
			});
		};

		let search = run_search(&searcher, &matcher, bytes.as_slice(), params)
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

		let path_string = search_path.to_string_lossy().into_owned();
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
					match_count:    Some(crate::utils::clamp_u32(search.match_count)),
				});
			},
		}

		let limit_reached =
			search.limit_reached || max_count.is_some_and(|max| search.collected >= max);

		return Ok(GrepResult {
			matches,
			total_matches: crate::utils::clamp_u32(search.match_count),
			files_with_matches: 1,
			files_searched: 1,
			limit_reached: if limit_reached { Some(true) } else { None },
		});
	}

	// Use the live picker index when db is provided and gitignore is respected.
	// The picker scans with hidden=true, so it covers both hidden and non-hidden
	// requests.  When gitignore is disabled the picker's index would miss files
	// that the picker excluded via gitignore, so we fall back to fs_cache.
	let entries = if let Some(db) = &db
		&& use_gitignore
	{
		collect_files_from_picker(
			&search_path,
			db,
			glob_set.as_ref(),
			type_filter.as_ref(),
			include_hidden,
			&ct,
		)?
	} else if use_cache {
		let scan = fs_cache::get_or_scan(&search_path, include_hidden, use_gitignore, &ct)?;
		let mut entries =
			collect_files(&search_path, &scan.entries, glob_set.as_ref(), type_filter.as_ref());
		if entries.is_empty() && scan.cache_age_ms >= fs_cache::empty_recheck_ms() {
			let fresh =
				fs_cache::force_rescan(&search_path, include_hidden, use_gitignore, true, &ct)?;
			entries = collect_files(&search_path, &fresh, glob_set.as_ref(), type_filter.as_ref());
		}
		entries
	} else {
		let fresh = fs_cache::force_rescan(&search_path, include_hidden, use_gitignore, false, &ct)?;
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
		let results = run_parallel_search(&entries, &matcher, params);
		let mut matches = Vec::new();
		let mut total_matches = 0u64;
		let mut files_with_matches = 0u32;
		let files_searched = crate::utils::clamp_u32(results.len() as u64);

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
						match_count:    Some(crate::utils::clamp_u32(result.match_count)),
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
			total_matches: crate::utils::clamp_u32(total_matches),
			files_with_matches,
			files_searched,
			limit_reached: None,
		});
	}

	let (matches, total_matches, files_with_matches, files_searched, limit_reached) =
		run_sequential_search(&entries, &matcher, params);

	// Fire callbacks for sequential search results
	if let Some(callback) = on_match {
		for grep_match in &matches {
			callback.call(Ok(grep_match.clone()), ThreadsafeFunctionCallMode::NonBlocking);
		}
	}

	Ok(GrepResult {
		matches,
		total_matches: crate::utils::clamp_u32(total_matches),
		files_with_matches,
		files_searched,
		limit_reached: if limit_reached { Some(true) } else { None },
	})
}

// ---------------------------------------------------------------------------
// N-API exports
// ---------------------------------------------------------------------------

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
	db: Option<&crate::search_db::SearchDb>,
) -> task::Async<GrepResult> {
	let GrepOptions {
		pattern,
		path,
		glob,
		type_filter,
		ignore_case,
		multiline,
		hidden,
		gitignore,
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
		gitignore,
		cache,
		max_count,
		offset,
		context_before,
		context_after,
		context,
		max_columns,
		mode,
	};
	let db = db.cloned();
	let ct = task::CancelToken::new(timeout_ms, signal);
	task::blocking("grep", ct, move |ct| grep_sync(config, db, on_match.as_ref(), ct))
}
