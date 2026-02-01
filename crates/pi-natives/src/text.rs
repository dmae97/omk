//! ANSI-aware text measurement and slicing utilities.

use napi::{JsString, JsStringUtf8, bindgen_prelude::*};
use napi_derive::napi;
use unicode_segmentation::UnicodeSegmentation;
use unicode_width::UnicodeWidthStr;

const TAB_WIDTH: usize = 3;

/// Result of slicing a line by visible width.
#[napi(object)]
pub struct SliceResult {
	/// The sliced text, including any ANSI codes.
	pub text:  String,
	/// Visible width of the slice in columns.
	pub width: u32,
}

/// Before/after segments extracted around an overlay region.
#[napi(object)]
pub struct ExtractSegmentsResult {
	/// Text before the overlay region.
	pub before:       String,
	/// Visible width of `before` in columns.
	#[napi(js_name = "beforeWidth")]
	pub before_width: u32,
	/// Text after the overlay region.
	pub after:        String,
	/// Visible width of `after` in columns.
	#[napi(js_name = "afterWidth")]
	pub after_width:  u32,
}

struct AnsiCodeTracker {
	bold:          bool,
	dim:           bool,
	italic:        bool,
	underline:     bool,
	blink:         bool,
	inverse:       bool,
	hidden:        bool,
	strikethrough: bool,
	fg_color:      Option<String>,
	bg_color:      Option<String>,
}

impl AnsiCodeTracker {
	const fn new() -> Self {
		Self {
			bold:          false,
			dim:           false,
			italic:        false,
			underline:     false,
			blink:         false,
			inverse:       false,
			hidden:        false,
			strikethrough: false,
			fg_color:      None,
			bg_color:      None,
		}
	}

	fn reset(&mut self) {
		self.bold = false;
		self.dim = false;
		self.italic = false;
		self.underline = false;
		self.blink = false;
		self.inverse = false;
		self.hidden = false;
		self.strikethrough = false;
		self.fg_color = None;
		self.bg_color = None;
	}

	fn clear(&mut self) {
		self.reset();
	}

	fn process(&mut self, ansi_code: &str) {
		if !ansi_code.ends_with('m') {
			return;
		}

		let params = ansi_code
			.strip_prefix("\x1b[")
			.and_then(|code| code.strip_suffix('m'));
		let Some(params) = params else {
			return;
		};

		if params.is_empty() || params == "0" {
			self.reset();
			return;
		}

		let parts: Vec<&str> = params.split(';').collect();
		let mut i = 0;
		while i < parts.len() {
			let Ok(code) = parts[i].parse::<u32>() else {
				i += 1;
				continue;
			};

			if code == 38 || code == 48 {
				if parts.get(i + 1) == Some(&"5") && parts.get(i + 2).is_some() {
					let color_code = format!("{};{};{}", parts[i], parts[i + 1], parts[i + 2]);
					if code == 38 {
						self.fg_color = Some(color_code);
					} else {
						self.bg_color = Some(color_code);
					}
					i += 3;
					continue;
				} else if parts.get(i + 1) == Some(&"2") && parts.get(i + 4).is_some() {
					let color_code = format!(
						"{};{};{};{};{}",
						parts[i],
						parts[i + 1],
						parts[i + 2],
						parts[i + 3],
						parts[i + 4],
					);
					if code == 38 {
						self.fg_color = Some(color_code);
					} else {
						self.bg_color = Some(color_code);
					}
					i += 5;
					continue;
				}
			}

			match code {
				0 => self.reset(),
				1 => self.bold = true,
				2 => self.dim = true,
				3 => self.italic = true,
				4 => self.underline = true,
				5 => self.blink = true,
				7 => self.inverse = true,
				8 => self.hidden = true,
				9 => self.strikethrough = true,
				21 => self.bold = false,
				22 => {
					self.bold = false;
					self.dim = false;
				},
				23 => self.italic = false,
				24 => self.underline = false,
				25 => self.blink = false,
				27 => self.inverse = false,
				28 => self.hidden = false,
				29 => self.strikethrough = false,
				39 => self.fg_color = None,
				49 => self.bg_color = None,
				_ => {
					if (30..=37).contains(&code) || (90..=97).contains(&code) {
						self.fg_color = Some(code.to_string());
					} else if (40..=47).contains(&code) || (100..=107).contains(&code) {
						self.bg_color = Some(code.to_string());
					}
				},
			}

			i += 1;
		}
	}

	fn get_active_codes(&self) -> String {
		let mut codes = Vec::new();
		if self.bold {
			codes.push("1".to_string());
		}
		if self.dim {
			codes.push("2".to_string());
		}
		if self.italic {
			codes.push("3".to_string());
		}
		if self.underline {
			codes.push("4".to_string());
		}
		if self.blink {
			codes.push("5".to_string());
		}
		if self.inverse {
			codes.push("7".to_string());
		}
		if self.hidden {
			codes.push("8".to_string());
		}
		if self.strikethrough {
			codes.push("9".to_string());
		}
		if let Some(color) = &self.fg_color {
			codes.push(color.clone());
		}
		if let Some(color) = &self.bg_color {
			codes.push(color.clone());
		}

		if codes.is_empty() {
			return String::new();
		}

		format!("\x1b[{}m", codes.join(";"))
	}
}

fn extract_ansi_code(text: &str, pos: usize) -> Option<usize> {
	let bytes = text.as_bytes();
	if pos >= bytes.len() || bytes[pos] != 0x1b {
		return None;
	}
	if pos + 1 >= bytes.len() {
		return None;
	}

	match bytes[pos + 1] {
		b'[' => {
			let mut j = pos + 2;
			while j < bytes.len() {
				match bytes[j] {
					b'm' | b'G' | b'K' | b'H' | b'J' => return Some(j + 1 - pos),
					_ => j += 1,
				}
			}
			None
		},
		b']' => {
			let mut j = pos + 2;
			while j < bytes.len() {
				if bytes[j] == 0x07 {
					return Some(j + 1 - pos);
				}
				if bytes[j] == 0x1b && j + 1 < bytes.len() && bytes[j + 1] == b'\\' {
					return Some(j + 2 - pos);
				}
				j += 1;
			}
			None
		},
		_ => None,
	}
}

fn next_ansi_start(text: &str, mut pos: usize) -> Option<usize> {
	let bytes = text.as_bytes();
	while pos < bytes.len() {
		if bytes[pos] == 0x1b && extract_ansi_code(text, pos).is_some() {
			return Some(pos);
		}
		pos += 1;
	}
	None
}

fn grapheme_width(grapheme: &str) -> usize {
	if grapheme == "\t" {
		return TAB_WIDTH;
	}
	UnicodeWidthStr::width(grapheme)
}

fn clamp_u32(value: usize) -> u32 {
	value.min(u32::MAX as usize) as u32
}

enum TextInput {
	Utf8(JsStringUtf8),
	Bytes(Uint8Array),
}

impl TextInput {
	fn new(value: Either<JsString, Uint8Array>) -> Result<Self> {
		match value {
			Either::A(value) => Ok(Self::Utf8(value.into_utf8()?)),
			Either::B(value) => Ok(Self::Bytes(value)),
		}
	}

	fn as_str(&self) -> Result<&str> {
		match self {
			Self::Utf8(text) => text.as_str(),
			Self::Bytes(bytes) => std::str::from_utf8(bytes.as_ref())
				.map_err(|err| Error::from_reason(format!("Invalid UTF-8: {err}"))),
		}
	}
}

fn visible_width_impl(text: &str) -> usize {
	if text.is_empty() {
		return 0;
	}

	let is_pure_ascii = text.bytes().all(|byte| (0x20..=0x7e).contains(&byte));
	if is_pure_ascii {
		return text.len();
	}

	let mut ansi_ranges = Vec::new();
	let bytes = text.as_bytes();
	let mut i = 0;
	while i < bytes.len() {
		if bytes[i] == 0x1b
			&& let Some(len) = extract_ansi_code(text, i)
		{
			ansi_ranges.push((i, i + len));
			i += len;
			continue;
		}
		i += 1;
	}

	let mut width = 0;
	let mut cursor = 0;
	for (start, end) in ansi_ranges {
		if start > cursor {
			for grapheme in text[cursor..start].graphemes(true) {
				width += grapheme_width(grapheme);
			}
		}
		cursor = end;
	}
	if cursor < text.len() {
		for grapheme in text[cursor..].graphemes(true) {
			width += grapheme_width(grapheme);
		}
	}

	width
}

/// Compute the visible width of a string, ignoring ANSI codes.
#[napi(js_name = "visibleWidth")]
pub fn visible_width(text: Either<JsString, Uint8Array>) -> Result<u32> {
	let text = TextInput::new(text)?;
	Ok(clamp_u32(visible_width_impl(text.as_str()?)))
}

/// Truncate text to a visible width, preserving ANSI codes.
#[napi(js_name = "truncateToWidth")]
pub fn truncate_to_width(
	text: Either<JsString, Uint8Array>,
	max_width: u32,
	ellipsis: Either<JsString, Uint8Array>,
	pad: bool,
) -> Result<String> {
	let text = TextInput::new(text)?;
	let text = text.as_str()?;
	let ellipsis = TextInput::new(ellipsis)?;
	let ellipsis = ellipsis.as_str()?;
	let max_width = max_width as usize;
	let text_visible_width = visible_width_impl(text);
	if text_visible_width <= max_width {
		if pad {
			return Ok(format!("{}{}", text, " ".repeat(max_width - text_visible_width)));
		}
		return Ok(text.to_owned());
	}

	let ellipsis_width = visible_width_impl(ellipsis);
	let target_width = max_width.saturating_sub(ellipsis_width);
	if target_width == 0 {
		return Ok(ellipsis.graphemes(true).take(max_width).collect());
	}

	let mut segments: Vec<(bool, &str)> = Vec::new();
	let mut i = 0;
	while i < text.len() {
		if let Some(len) = extract_ansi_code(text, i) {
			segments.push((true, &text[i..i + len]));
			i += len;
			continue;
		}

		let next_ansi = next_ansi_start(text, i);
		let end = next_ansi.unwrap_or(text.len());
		for grapheme in text[i..end].graphemes(true) {
			segments.push((false, grapheme));
		}
		i = end;
	}

	let mut result = String::new();
	let mut current_width = 0;
	for (is_ansi, value) in segments {
		if is_ansi {
			result.push_str(value);
			continue;
		}

		if value.is_empty() {
			continue;
		}

		let width = grapheme_width(value);
		if current_width + width > target_width {
			break;
		}
		result.push_str(value);
		current_width += width;
	}

	let mut truncated = format!("{result}\x1b[0m{ellipsis}");
	if pad {
		let truncated_width = visible_width_impl(&truncated);
		if truncated_width < max_width {
			truncated.push_str(&" ".repeat(max_width - truncated_width));
		}
	}

	Ok(truncated)
}

fn slice_with_width_impl(line: &str, start_col: usize, length: usize, strict: bool) -> SliceResult {
	if length == 0 {
		return SliceResult { text: String::new(), width: 0 };
	}

	let end_col = start_col + length;
	let mut result = String::new();
	let mut result_width = 0;
	let mut current_col = 0;
	let mut i = 0;
	let mut pending_ansi = String::new();

	while i < line.len() {
		if let Some(len) = extract_ansi_code(line, i) {
			let code = &line[i..i + len];
			if current_col >= start_col && current_col < end_col {
				result.push_str(code);
			} else if current_col < start_col {
				pending_ansi.push_str(code);
			}
			i += len;
			continue;
		}

		let next_ansi = next_ansi_start(line, i);
		let end = next_ansi.unwrap_or(line.len());
		for grapheme in line[i..end].graphemes(true) {
			let width = grapheme_width(grapheme);
			let in_range = current_col >= start_col && current_col < end_col;
			let fits = !strict || current_col + width <= end_col;

			if in_range && fits {
				if !pending_ansi.is_empty() {
					result.push_str(&pending_ansi);
					pending_ansi.clear();
				}
				result.push_str(grapheme);
				result_width += width;
			}

			current_col += width;
			if current_col >= end_col {
				break;
			}
		}
		i = end;
		if current_col >= end_col {
			break;
		}
	}

	SliceResult { text: result, width: clamp_u32(result_width) }
}

/// Slice a range of visible columns from a line.
#[napi(js_name = "sliceWithWidth")]
pub fn slice_with_width(
	line: Either<JsString, Uint8Array>,
	start_col: u32,
	length: u32,
	strict: bool,
) -> Result<SliceResult> {
	let line = TextInput::new(line)?;
	Ok(slice_with_width_impl(line.as_str()?, start_col as usize, length as usize, strict))
}

fn extract_segments_impl(
	line: &str,
	before_end: usize,
	after_start: usize,
	after_len: usize,
	strict_after: bool,
) -> ExtractSegmentsResult {
	let mut before = String::new();
	let mut before_width = 0;
	let mut after = String::new();
	let mut after_width = 0;
	let mut current_col = 0;
	let mut i = 0;
	let mut pending_ansi_before = String::new();
	let mut after_started = false;
	let after_end = after_start + after_len;

	let mut tracker = AnsiCodeTracker::new();
	tracker.clear();

	while i < line.len() {
		if let Some(len) = extract_ansi_code(line, i) {
			let code = &line[i..i + len];
			tracker.process(code);
			if current_col < before_end {
				pending_ansi_before.push_str(code);
			} else if current_col >= after_start && current_col < after_end && after_started {
				after.push_str(code);
			}
			i += len;
			continue;
		}

		let next_ansi = next_ansi_start(line, i);
		let end = next_ansi.unwrap_or(line.len());
		for grapheme in line[i..end].graphemes(true) {
			let width = grapheme_width(grapheme);

			if current_col < before_end {
				if !pending_ansi_before.is_empty() {
					before.push_str(&pending_ansi_before);
					pending_ansi_before.clear();
				}
				before.push_str(grapheme);
				before_width += width;
			} else if current_col >= after_start && current_col < after_end {
				let fits = !strict_after || current_col + width <= after_end;
				if fits {
					if !after_started {
						after.push_str(&tracker.get_active_codes());
						after_started = true;
					}
					after.push_str(grapheme);
					after_width += width;
				}
			}

			current_col += width;
			let done = if after_len == 0 {
				current_col >= before_end
			} else {
				current_col >= after_end
			};
			if done {
				break;
			}
		}
		i = end;
		let done = if after_len == 0 {
			current_col >= before_end
		} else {
			current_col >= after_end
		};
		if done {
			break;
		}
	}

	ExtractSegmentsResult {
		before,
		before_width: clamp_u32(before_width),
		after,
		after_width: clamp_u32(after_width),
	}
}

/// Extract the before/after slices around an overlay region.
#[napi(js_name = "extractSegments")]
pub fn extract_segments(
	line: Either<JsString, Uint8Array>,
	before_end: u32,
	after_start: u32,
	after_len: u32,
	strict_after: bool,
) -> Result<ExtractSegmentsResult> {
	let line = TextInput::new(line)?;
	Ok(extract_segments_impl(
		line.as_str()?,
		before_end as usize,
		after_start as usize,
		after_len as usize,
		strict_after,
	))
}
