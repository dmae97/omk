//! WASM module for regex matching using ripgrep's engine.
//!
//! This module provides pure regex matching - no filesystem access.
//! The JS side handles directory walking and file reading, then passes
//! content here for matching.

pub mod html;
pub mod highlight;
pub mod image;
pub mod text;

use std::io::{self, Cursor};

use grep_matcher::Matcher;
use grep_regex::RegexMatcherBuilder;
use grep_searcher::{
	BinaryDetection, Searcher, SearcherBuilder, Sink, SinkContext, SinkContextKind, SinkMatch,
};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

#[cfg(feature = "console_error_panic_hook")]
fn set_panic_hook() {
	console_error_panic_hook::set_once();
}

/// Options for searching file content.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOptions {
	/// Regex pattern to search for.
	pub pattern:     String,
	/// Case-insensitive search.
	#[serde(default)]
	pub ignore_case: bool,
	/// Enable multiline matching.
	#[serde(default)]
	pub multiline:   bool,
	/// Maximum number of matches to return.
	#[serde(default)]
	pub max_count:   Option<u64>,
	/// Skip first N matches.
	#[serde(default)]
	pub offset:      Option<u64>,
	/// Lines of context before/after matches.
	#[serde(default)]
	pub context:     Option<usize>,
	/// Truncate lines longer than this (characters).
	#[serde(default)]
	pub max_columns: Option<usize>,
	/// Output mode (content or count).
	#[serde(default)]
	pub mode:        SearchMode,
}

#[derive(Debug, Deserialize, Default, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SearchMode {
	#[default]
	Content,
	Count,
}

/// A context line (before or after a match).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextLine {
	pub line_number: u64,
	pub line:        String,
}

/// A single match in the content.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Match {
	/// 1-indexed line number.
	pub line_number:    u64,
	/// The matched line content.
	pub line:           String,
	/// Context lines before the match.
	#[serde(skip_serializing_if = "Vec::is_empty")]
	pub context_before: Vec<ContextLine>,
	/// Context lines after the match.
	#[serde(skip_serializing_if = "Vec::is_empty")]
	pub context_after:  Vec<ContextLine>,
	/// Whether the line was truncated.
	#[serde(skip_serializing_if = "std::ops::Not::not")]
	pub truncated:      bool,
}

/// Result of searching content.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
	/// All matches found.
	pub matches:       Vec<Match>,
	/// Total number of matches (may exceed `matches.len()` due to offset/limit).
	pub match_count:   u64,
	/// Whether the limit was reached.
	#[serde(skip_serializing_if = "std::ops::Not::not")]
	pub limit_reached: bool,
}

/// Error result.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorResult {
	pub error: String,
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
				let truncated = format!("{}...", &line[..max.saturating_sub(3)]);
				(truncated, true)
			},
			_ => (line.to_string(), false),
		}
	}
}

impl Sink for MatchCollector {
	type Error = io::Error;

	fn matched(&mut self, _searcher: &Searcher, mat: &SinkMatch<'_>) -> Result<bool, Self::Error> {
		self.match_count += 1;

		// If we already hit the limit, stop now (after-context for previous match was
		// collected)
		if self.limit_reached {
			return Ok(false);
		}

		if self.skipped < self.offset {
			self.skipped += 1;
			self.context_before.clear();
			return Ok(true);
		}

		if self.collect_matches {
			let raw_line = String::from_utf8_lossy(mat.bytes()).trim_end().to_string();
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

		// Mark limit reached but don't stop yet - allow after-context to be collected
		if let Some(max) = self.max_count
			&& self.collected_count >= max
		{
			self.limit_reached = true;
		}

		Ok(true)
	}

	fn context(&mut self, _searcher: &Searcher, ctx: &SinkContext<'_>) -> Result<bool, Self::Error> {
		if !self.collect_matches {
			return Ok(true);
		}

		let raw_line = String::from_utf8_lossy(ctx.bytes()).trim_end().to_string();
		let (line, _) = self.truncate_line(&raw_line);
		let line_number = ctx.line_number().unwrap_or(0);

		match ctx.kind() {
			SinkContextKind::Before => {
				self.context_before.push(ContextLine { line_number, line });
			},
			SinkContextKind::After => {
				if let Some(last_match) = self.matches.last_mut() {
					last_match
						.context_after
						.push(ContextLine { line_number, line });
				}
			},
			SinkContextKind::Other => {},
		}

		Ok(true)
	}
}

/// A compiled regex matcher that can be reused across multiple searches.
#[wasm_bindgen]
pub struct CompiledPattern {
	matcher:     grep_regex::RegexMatcher,
	context:     usize,
	max_columns: Option<usize>,
	mode:        SearchMode,
}

#[wasm_bindgen]
impl CompiledPattern {
	/// Compile a regex pattern for reuse.
	#[wasm_bindgen(constructor)]
	pub fn new(options: JsValue) -> Result<Self, JsValue> {
		#[cfg(feature = "console_error_panic_hook")]
		set_panic_hook();

		let opts: SearchOptions = serde_wasm_bindgen::from_value(options)
			.map_err(|e| JsValue::from_str(&format!("Invalid options: {e}")))?;

		let matcher = RegexMatcherBuilder::new()
			.case_insensitive(opts.ignore_case)
			.multi_line(opts.multiline)
			.build(&opts.pattern)
			.map_err(|e| JsValue::from_str(&format!("Regex error: {e}")))?;

		Ok(Self {
			matcher,
			context: opts.context.unwrap_or(0),
			max_columns: opts.max_columns,
			mode: opts.mode,
		})
	}

	/// Search content using this compiled pattern.
	/// Returns matches as a JS object.
	pub fn search(&self, content: &str, max_count: Option<u32>, offset: Option<u32>) -> JsValue {
		let context_lines = self.context;
		let mut searcher = SearcherBuilder::new()
			.binary_detection(BinaryDetection::quit(b'\x00'))
			.line_number(true)
			.before_context(context_lines)
			.after_context(context_lines)
			.build();

		let mut collector = MatchCollector::new(
			max_count.map(|n| n as u64),
			offset.unwrap_or(0) as u64,
			self.max_columns,
			self.mode == SearchMode::Content,
		);

		let cursor = Cursor::new(content.as_bytes());
		if let Err(e) = searcher.search_reader(&self.matcher, cursor, &mut collector) {
			return serde_wasm_bindgen::to_value(&ErrorResult { error: e.to_string() })
				.unwrap_or(JsValue::NULL);
		}

		let result = SearchResult {
			matches:       collector
				.matches
				.into_iter()
				.map(|m| Match {
					line_number:    m.line_number,
					line:           m.line,
					context_before: m.context_before,
					context_after:  m.context_after,
					truncated:      m.truncated,
				})
				.collect(),
			match_count:   collector.match_count,
			limit_reached: collector.limit_reached,
		};

		serde_wasm_bindgen::to_value(&result).unwrap_or(JsValue::NULL)
	}

	/// Check if content has any matches (faster than full search).
	pub fn has_match(&self, content: &str) -> bool {
		self.matcher.is_match(content.as_bytes()).unwrap_or(false)
	}

	/// Search bytes directly (avoids UTF-16 to UTF-8 conversion).
	/// Use with `Bun.mmap()` for best performance.
	pub fn search_bytes(
		&self,
		content: &[u8],
		max_count: Option<u32>,
		offset: Option<u32>,
	) -> JsValue {
		let context_lines = self.context;
		let mut searcher = SearcherBuilder::new()
			.binary_detection(BinaryDetection::quit(b'\x00'))
			.line_number(true)
			.before_context(context_lines)
			.after_context(context_lines)
			.build();

		let mut collector = MatchCollector::new(
			max_count.map(|n| n as u64),
			offset.unwrap_or(0) as u64,
			self.max_columns,
			self.mode == SearchMode::Content,
		);

		let cursor = Cursor::new(content);
		if let Err(e) = searcher.search_reader(&self.matcher, cursor, &mut collector) {
			return serde_wasm_bindgen::to_value(&ErrorResult { error: e.to_string() })
				.unwrap_or(JsValue::NULL);
		}

		let result = SearchResult {
			matches:       collector
				.matches
				.into_iter()
				.map(|m| Match {
					line_number:    m.line_number,
					line:           m.line,
					context_before: m.context_before,
					context_after:  m.context_after,
					truncated:      m.truncated,
				})
				.collect(),
			match_count:   collector.match_count,
			limit_reached: collector.limit_reached,
		};

		serde_wasm_bindgen::to_value(&result).unwrap_or(JsValue::NULL)
	}

	/// Check if bytes have any matches (faster than full search).
	pub fn has_match_bytes(&self, content: &[u8]) -> bool {
		self.matcher.is_match(content).unwrap_or(false)
	}
}

/// Search content for a pattern (one-shot, compiles pattern each time).
/// For repeated searches with the same pattern, use [`CompiledPattern`].
#[wasm_bindgen]
pub fn search(content: &str, options: JsValue) -> JsValue {
	#[cfg(feature = "console_error_panic_hook")]
	set_panic_hook();

	let opts: SearchOptions = match serde_wasm_bindgen::from_value(options) {
		Ok(o) => o,
		Err(e) => {
			return serde_wasm_bindgen::to_value(&ErrorResult {
				error: format!("Invalid options: {e}"),
			})
			.unwrap_or(JsValue::NULL);
		},
	};

	let matcher = match RegexMatcherBuilder::new()
		.case_insensitive(opts.ignore_case)
		.multi_line(opts.multiline)
		.build(&opts.pattern)
	{
		Ok(m) => m,
		Err(e) => {
			return serde_wasm_bindgen::to_value(&ErrorResult { error: format!("Regex error: {e}") })
				.unwrap_or(JsValue::NULL);
		},
	};

	let context_lines = opts.context.unwrap_or(0);
	let mut searcher = SearcherBuilder::new()
		.binary_detection(BinaryDetection::quit(b'\x00'))
		.line_number(true)
		.before_context(context_lines)
		.after_context(context_lines)
		.build();

	let mut collector = MatchCollector::new(
		opts.max_count,
		opts.offset.unwrap_or(0),
		opts.max_columns,
		opts.mode == SearchMode::Content,
	);

	let cursor = Cursor::new(content.as_bytes());
	if let Err(e) = searcher.search_reader(&matcher, cursor, &mut collector) {
		return serde_wasm_bindgen::to_value(&ErrorResult { error: e.to_string() })
			.unwrap_or(JsValue::NULL);
	}

	let result = SearchResult {
		matches:       collector
			.matches
			.into_iter()
			.map(|m| Match {
				line_number:    m.line_number,
				line:           m.line,
				context_before: m.context_before,
				context_after:  m.context_after,
				truncated:      m.truncated,
			})
			.collect(),
		match_count:   collector.match_count,
		limit_reached: collector.limit_reached,
	};

	serde_wasm_bindgen::to_value(&result).unwrap_or(JsValue::NULL)
}

/// Quick check if content matches a pattern.
#[wasm_bindgen]
pub fn has_match(
	content: &str,
	pattern: &str,
	ignore_case: bool,
	multiline: bool,
) -> Result<bool, JsValue> {
	#[cfg(feature = "console_error_panic_hook")]
	set_panic_hook();

	let matcher = RegexMatcherBuilder::new()
		.case_insensitive(ignore_case)
		.multi_line(multiline)
		.build(pattern)
		.map_err(|e| JsValue::from_str(&format!("Regex error: {e}")))?;

	Ok(matcher.is_match(content.as_bytes()).unwrap_or(false))
}
