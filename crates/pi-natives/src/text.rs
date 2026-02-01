//! ANSI-aware text measurement and slicing utilities (UTF-16 optimized).
//!
//! Works directly on JS string's internal UTF-16 representation to avoid
//! UTF-8↔UTF-16 conversion overhead. ANSI codes are ASCII and process
//! identically in UTF-16. Text segments convert to UTF-8 only for grapheme
//! iteration (unavoidable - unicode libraries work on &str).

use napi::{Env, JsString, JsStringUtf16, bindgen_prelude::*};
use napi_derive::napi;
use unicode_segmentation::UnicodeSegmentation;
use unicode_width::UnicodeWidthStr;

const TAB_WIDTH: usize = 3;
const ESC: u16 = 0x1b;

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

#[inline]
fn clamp_u32(value: usize) -> u32 {
	value.min(u32::MAX as usize) as u32
}

#[inline]
fn ascii_cell_width(b: u16) -> usize {
	match b {
		0x09 => TAB_WIDTH, // '\t'
		0x20..=0x7e => 1,  // printable ASCII
		_ => 0,            // control chars, high values
	}
}

#[inline]
fn grapheme_width(g: &str) -> usize {
	if g == "\t" {
		return TAB_WIDTH;
	}
	// Fast path for single ASCII char
	let bytes = g.as_bytes();
	if bytes.len() == 1 {
		return ascii_cell_width(bytes[0] as u16);
	}
	UnicodeWidthStr::width(g)
}

// ============================================================================
// ANSI Detection (UTF-16)
// ============================================================================

/// Find the next ESC (0x1B) in the slice starting at `start`.
#[inline]
fn find_esc(data: &[u16], start: usize) -> Option<usize> {
	data[start..]
		.iter()
		.position(|&c| c == ESC)
		.map(|i| start + i)
}

/// Parse an ANSI escape sequence starting at `pos`.
/// Returns the length in u16 units if valid.
#[inline]
fn ansi_len(data: &[u16], pos: usize) -> Option<usize> {
	if *data.get(pos)? != ESC {
		return None;
	}
	let next = *data.get(pos + 1)?;

	match next {
		0x5b => {
			// '[' - CSI sequence: ESC [ ... final-byte (0x40-0x7E)
			let mut j = pos + 2;
			while j < data.len() {
				let b = data[j];
				if (0x40..=0x7e).contains(&b) {
					return Some(j + 1 - pos);
				}
				j += 1;
			}
			None
		},
		0x5d => {
			// ']' - OSC sequence: ESC ] ... BEL or ESC \
			let mut j = pos + 2;
			while j < data.len() {
				match data[j] {
					0x07 => return Some(j + 1 - pos), // BEL
					ESC if data.get(j + 1) == Some(&0x5c) => return Some(j + 2 - pos), // ESC \
					_ => j += 1,
				}
			}
			None
		},
		_ => None,
	}
}

// ============================================================================
// Chunk Processing
// ============================================================================

/// Check if a UTF-16 slice is pure ASCII (all values < 0x80).
#[inline]
fn is_ascii_u16(chunk: &[u16]) -> bool {
	chunk.iter().all(|&c| c < 0x80)
}

/// Iterate graphemes in a UTF-16 chunk, calling `f(grapheme_str, u16_slice,
/// width)`. Only converts to UTF-8 if non-ASCII.
#[inline]
fn for_each_grapheme<F>(chunk: &[u16], mut f: F)
where
	F: FnMut(&str, &[u16], usize) -> bool, // return false to stop
{
	// Convert chunk to String for grapheme iteration
	let s = String::from_utf16_lossy(chunk);
	let mut u16_pos = 0;

	for grapheme in s.graphemes(true) {
		let width = grapheme_width(grapheme);
		let u16_len: usize = grapheme.chars().map(|c| c.len_utf16()).sum();
		let grapheme_u16 = &chunk[u16_pos..u16_pos + u16_len];

		if !f(grapheme, grapheme_u16, width) {
			return;
		}
		u16_pos += u16_len;
	}
}

// ============================================================================
// Width Calculation
// ============================================================================

/// Measure visible width, stopping early if it exceeds `limit`.
/// Returns (width_so_far, exceeded_limit).
fn visible_width_up_to(data: &[u16], limit: usize) -> (usize, bool) {
	let mut w = 0usize;
	let mut i = 0usize;

	while i < data.len() {
		if data[i] == ESC {
			if let Some(len) = ansi_len(data, i) {
				i += len;
				continue;
			}
			// Not a valid ANSI sequence, treat as control char (width 0)
		}

		let next_esc = find_esc(data, i + 1).unwrap_or(data.len());
		let end = if next_esc == i { i + 1 } else { next_esc };
		let chunk = &data[i..end];

		if is_ascii_u16(chunk) {
			for &c in chunk {
				w += ascii_cell_width(c);
				if w > limit {
					return (w, true);
				}
			}
		} else {
			for_each_grapheme(chunk, |_, _, gw| {
				w += gw;
				w <= limit // continue while not exceeded
			});
			if w > limit {
				return (w, true);
			}
		}

		i = end;
	}

	(w, false)
}

#[inline]
fn visible_width_full(data: &[u16]) -> usize {
	visible_width_up_to(data, usize::MAX).0
}

/// Copy a prefix (including ANSI codes) while visible width stays <=
/// `target_width`. Returns (visible_width_copied, saw_any_ansi).
fn push_prefix_with_ansi(text: &[u16], target_width: usize, out: &mut Vec<u16>) -> (usize, bool) {
	let mut w = 0usize;
	let mut i = 0usize;
	let mut saw_ansi = false;

	while i < text.len() {
		if text[i] == ESC {
			if let Some(len) = ansi_len(text, i) {
				out.extend_from_slice(&text[i..i + len]);
				saw_ansi = true;
				i += len;
				continue;
			}
		}

		let next_esc = find_esc(text, i + 1).unwrap_or(text.len());
		let end = if next_esc == i { i + 1 } else { next_esc };
		let chunk = &text[i..end];

		if is_ascii_u16(chunk) {
			for &c in chunk {
				let cw = ascii_cell_width(c);
				if w + cw > target_width {
					return (w, saw_ansi);
				}
				out.push(c);
				w += cw;
			}
		} else {
			let mut stopped = false;
			for_each_grapheme(chunk, |_, gu16, gw| {
				if w + gw > target_width {
					stopped = true;
					return false;
				}
				out.extend_from_slice(gu16);
				w += gw;
				true
			});
			if stopped {
				return (w, saw_ansi);
			}
		}

		i = end;
	}

	(w, saw_ansi)
}

// ============================================================================
// SGR State Tracker (zero allocations)
// ============================================================================

#[derive(Clone, Copy, Default)]
struct SgrState {
	flags: u16,
	fg:    Option<ColorCode>,
	bg:    Option<ColorCode>,
}

#[derive(Clone, Copy)]
enum ColorCode {
	Basic(u16),
	Indexed { is_fg: bool, idx: u8 },
	Rgb { is_fg: bool, r: u8, g: u8, b: u8 },
}

impl Default for ColorCode {
	fn default() -> Self {
		ColorCode::Basic(39)
	}
}

impl SgrState {
	#[inline]
	fn reset(&mut self) {
		self.flags = 0;
		self.fg = None;
		self.bg = None;
	}

	#[inline]
	fn process_ansi(&mut self, code: &[u16]) {
		// Only handle CSI ... m
		if code.len() < 3 || code[0] != ESC || code[1] != 0x5b || *code.last().unwrap() != 0x6d {
			return;
		}
		let params = &code[2..code.len() - 1];
		self.process_sgr_params(params);
	}

	fn process_sgr_params(&mut self, params: &[u16]) {
		if params.is_empty() {
			self.reset();
			return;
		}

		let mut it = ParamIterU16::new(params);
		while let Some(p) = it.next_u16() {
			match p {
				0 => self.reset(),
				1 => self.flags |= 1 << 0,
				2 => self.flags |= 1 << 1,
				3 => self.flags |= 1 << 2,
				4 => self.flags |= 1 << 3,
				5 => self.flags |= 1 << 4,
				7 => self.flags |= 1 << 5,
				8 => self.flags |= 1 << 6,
				9 => self.flags |= 1 << 7,

				21 => self.flags &= !(1 << 0),
				22 => self.flags &= !((1 << 0) | (1 << 1)),
				23 => self.flags &= !(1 << 2),
				24 => self.flags &= !(1 << 3),
				25 => self.flags &= !(1 << 4),
				27 => self.flags &= !(1 << 5),
				28 => self.flags &= !(1 << 6),
				29 => self.flags &= !(1 << 7),

				39 => self.fg = None,
				49 => self.bg = None,

				30..=37 | 90..=97 => self.fg = Some(ColorCode::Basic(p)),
				40..=47 | 100..=107 => self.bg = Some(ColorCode::Basic(p)),

				38 | 48 => {
					let is_fg = p == 38;
					match it.next_u16() {
						Some(5) => {
							if let Some(n) = it.next_u16() {
								let idx = (n & 0xff) as u8;
								if is_fg {
									self.fg = Some(ColorCode::Indexed { is_fg: true, idx });
								} else {
									self.bg = Some(ColorCode::Indexed { is_fg: false, idx });
								}
							}
						},
						Some(2) => {
							let r = it.next_u16().unwrap_or(0) as u8;
							let g = it.next_u16().unwrap_or(0) as u8;
							let b = it.next_u16().unwrap_or(0) as u8;
							if is_fg {
								self.fg = Some(ColorCode::Rgb { is_fg: true, r, g, b });
							} else {
								self.bg = Some(ColorCode::Rgb { is_fg: false, r, g, b });
							}
						},
						_ => {},
					}
				},

				_ => {},
			}
		}
	}

	fn write_active_codes(&self, out: &mut Vec<u16>) {
		if self.flags == 0 && self.fg.is_none() && self.bg.is_none() {
			return;
		}

		out.extend_from_slice(&[ESC, 0x5b]); // ESC [
		let mut first = true;

		macro_rules! push_code {
			($code:expr) => {{
				if !first {
					out.push(0x3b);
				} // ';'
				first = false;
				push_u16_decimal(out, $code);
			}};
		}

		if (self.flags & (1 << 0)) != 0 {
			push_code!(1);
		}
		if (self.flags & (1 << 1)) != 0 {
			push_code!(2);
		}
		if (self.flags & (1 << 2)) != 0 {
			push_code!(3);
		}
		if (self.flags & (1 << 3)) != 0 {
			push_code!(4);
		}
		if (self.flags & (1 << 4)) != 0 {
			push_code!(5);
		}
		if (self.flags & (1 << 5)) != 0 {
			push_code!(7);
		}
		if (self.flags & (1 << 6)) != 0 {
			push_code!(8);
		}
		if (self.flags & (1 << 7)) != 0 {
			push_code!(9);
		}

		if let Some(c) = self.fg {
			write_color_u16(out, &mut first, c);
		}
		if let Some(c) = self.bg {
			write_color_u16(out, &mut first, c);
		}

		out.push(0x6d); // 'm'
	}
}

struct ParamIterU16<'a> {
	data: &'a [u16],
	i:    usize,
}

impl<'a> ParamIterU16<'a> {
	#[inline]
	fn new(data: &'a [u16]) -> Self {
		Self { data, i: 0 }
	}

	#[inline]
	fn next_u16(&mut self) -> Option<u16> {
		if self.i >= self.data.len() {
			return None;
		}

		let mut n: u16 = 0;
		let mut has_digit = false;

		while self.i < self.data.len() && self.data[self.i] != 0x3b {
			// ';'
			let c = self.data[self.i];
			if (0x30..=0x39).contains(&c) {
				// '0'-'9'
				has_digit = true;
				n = n.saturating_mul(10).saturating_add((c - 0x30) as u16);
			}
			self.i += 1;
		}

		if self.i < self.data.len() && self.data[self.i] == 0x3b {
			self.i += 1;
		}

		if has_digit { Some(n) } else { Some(0) }
	}
}

#[inline]
fn push_u16_decimal(out: &mut Vec<u16>, mut n: u16) {
	if n == 0 {
		out.push(0x30); // '0'
		return;
	}

	let mut buf = [0u16; 5];
	let mut i = buf.len();

	while n > 0 {
		i -= 1;
		buf[i] = 0x30 + (n % 10) as u16;
		n /= 10;
	}

	out.extend_from_slice(&buf[i..]);
}

#[inline]
fn write_color_u16(out: &mut Vec<u16>, first: &mut bool, c: ColorCode) {
	macro_rules! sep {
		() => {
			if !*first {
				out.push(0x3b);
			}
			*first = false;
		};
	}

	match c {
		ColorCode::Basic(code) => {
			sep!();
			push_u16_decimal(out, code);
		},
		ColorCode::Indexed { is_fg, idx } => {
			sep!();
			push_u16_decimal(out, if is_fg { 38 } else { 48 });
			out.push(0x3b);
			push_u16_decimal(out, 5);
			out.push(0x3b);
			push_u16_decimal(out, idx as u16);
		},
		ColorCode::Rgb { is_fg, r, g, b } => {
			sep!();
			push_u16_decimal(out, if is_fg { 38 } else { 48 });
			out.push(0x3b);
			push_u16_decimal(out, 2);
			out.push(0x3b);
			push_u16_decimal(out, r as u16);
			out.push(0x3b);
			push_u16_decimal(out, g as u16);
			out.push(0x3b);
			push_u16_decimal(out, b as u16);
		},
	}
}

// ============================================================================
// JsString Helpers
// ============================================================================

#[inline]
fn js_string_from_u16<'e>(env: &'e Env, data: &[u16]) -> Result<JsString<'e>> {
	unsafe { env.create_string_utf16(data) }
}

/// Convert Vec<u16> to String for struct fields.
/// Uses from_utf16_lossy which handles surrogates gracefully.
#[inline]
fn u16_to_string(data: Vec<u16>) -> String {
	String::from_utf16_lossy(&data)
}

// ============================================================================
// truncateToWidth
// ============================================================================

/// Truncate text to a visible width, preserving ANSI codes.
#[napi(js_name = "truncateToWidth")]
pub fn truncate_to_width<'e>(
	env: &'e Env,
	text: JsString,
	max_width: u32,
	ellipsis: JsString,
	pad: bool,
) -> Result<JsString<'e>> {
	let text_u16 = text.into_utf16()?;
	let text_data = text_u16.as_slice();
	let max_width = max_width as usize;

	// 1) Quick width check with early exit
	let (w, exceeded) = visible_width_up_to(text_data, max_width);

	if !exceeded {
		if !pad {
			// Best case: return original string (but we consumed it with into_utf16)
			// Recreate from the same data - this is still cheaper than full processing
			return js_string_from_u16(&env, text_data);
		}

		// Padding required
		let pad_spaces = max_width.saturating_sub(w);
		let mut out = Vec::with_capacity(text_data.len() + pad_spaces);
		out.extend_from_slice(text_data);
		out.resize(out.len() + pad_spaces, 0x20); // ' '
		return js_string_from_u16(&env, &out);
	}

	// 2) Truncation needed - now measure ellipsis (lazy)
	let ellipsis_u16 = ellipsis.into_utf16()?;
	let ellipsis_data = ellipsis_u16.as_slice();
	let ellipsis_w = visible_width_full(ellipsis_data);
	let target_w = max_width.saturating_sub(ellipsis_w);

	// If ellipsis alone doesn't fit
	if target_w == 0 {
		let mut out = Vec::with_capacity(ellipsis_data.len().min(32));
		let _ = push_prefix_with_ansi(ellipsis_data, max_width, &mut out);
		return js_string_from_u16(&env, &out);
	}

	// 3) Build truncated prefix + reset + ellipsis
	let mut out = Vec::with_capacity(text_data.len().min(max_width * 2) + ellipsis_data.len() + 8);
	let (prefix_w, saw_ansi) = push_prefix_with_ansi(text_data, target_w, &mut out);

	if saw_ansi {
		out.extend_from_slice(&[ESC, 0x5b, 0x30, 0x6d]); // \x1b[0m
	}
	out.extend_from_slice(ellipsis_data);

	if pad {
		let out_w = prefix_w + ellipsis_w;
		if out_w < max_width {
			out.resize(out.len() + max_width - out_w, 0x20);
		}
	}

	js_string_from_u16(&env, &out)
}

// ============================================================================
// sliceWithWidth
// ============================================================================

fn slice_with_width_impl(
	line: &[u16],
	start_col: usize,
	length: usize,
	strict: bool,
) -> (Vec<u16>, usize) {
	let end_col = start_col + length;

	let mut out = Vec::<u16>::new();
	let mut out_width = 0usize;
	let mut current_col = 0usize;

	// Store ANSI ranges (offset, len) that occurred before start_col
	let mut pending_ansi: Vec<(usize, usize)> = Vec::new();

	let mut i = 0usize;
	while i < line.len() {
		if line[i] == ESC {
			if let Some(len) = ansi_len(line, i) {
				if current_col >= start_col && current_col < end_col {
					out.extend_from_slice(&line[i..i + len]);
				} else if current_col < start_col {
					pending_ansi.push((i, len));
				}
				i += len;
				continue;
			}
		}

		let next_esc = find_esc(line, i + 1).unwrap_or(line.len());
		let end = if next_esc == i { i + 1 } else { next_esc };
		let chunk = &line[i..end];

		if is_ascii_u16(chunk) {
			for (idx, &c) in chunk.iter().enumerate() {
				let w = ascii_cell_width(c);
				let in_range = current_col >= start_col && current_col < end_col;
				let fits = !strict || current_col + w <= end_col;

				if in_range && fits {
					if !pending_ansi.is_empty() {
						for &(p, l) in &pending_ansi {
							out.extend_from_slice(&line[p..p + l]);
						}
						pending_ansi.clear();
					}
					out.push(c);
					out_width += w;
				}

				current_col += w;
				if current_col >= end_col {
					break;
				}
			}
		} else {
			for_each_grapheme(chunk, |_, gu16, gw| {
				let in_range = current_col >= start_col && current_col < end_col;
				let fits = !strict || current_col + gw <= end_col;

				if in_range && fits {
					if !pending_ansi.is_empty() {
						for &(p, l) in &pending_ansi {
							out.extend_from_slice(&line[p..p + l]);
						}
						pending_ansi.clear();
					}
					out.extend_from_slice(gu16);
					out_width += gw;
				}

				current_col += gw;
				current_col < end_col // continue while not past end
			});
		}

		i = end;
		if current_col >= end_col {
			break;
		}
	}

	(out, out_width)
}

/// Slice a range of visible columns from a line.
#[napi(js_name = "sliceWithWidth")]
pub fn slice_with_width(
	line: JsString,
	start_col: u32,
	length: u32,
	strict: bool,
) -> Result<SliceResult> {
	let line_u16 = line.into_utf16()?;
	let line_data = line_u16.as_slice();

	let (out, out_w) = slice_with_width_impl(line_data, start_col as usize, length as usize, strict);

	Ok(SliceResult { text: u16_to_string(out), width: clamp_u32(out_w) })
}

// ============================================================================
// extractSegments
// ============================================================================

fn extract_segments_impl(
	line: &[u16],
	before_end: usize,
	after_start: usize,
	after_len: usize,
	strict_after: bool,
) -> (Vec<u16>, usize, Vec<u16>, usize) {
	let after_end = after_start + after_len;

	let mut before = Vec::<u16>::new();
	let mut before_width = 0usize;
	let mut after = Vec::<u16>::new();
	let mut after_width = 0usize;

	let mut pending_before_ansi: Vec<(usize, usize)> = Vec::new();
	let mut tracker = SgrState::default();
	tracker.reset();
	let mut after_started = false;

	let mut current_col = 0usize;
	let mut i = 0usize;

	while i < line.len() {
		if line[i] == ESC {
			if let Some(len) = ansi_len(line, i) {
				let code = &line[i..i + len];
				tracker.process_ansi(code);

				if current_col < before_end {
					pending_before_ansi.push((i, len));
				} else if current_col >= after_start && current_col < after_end && after_started {
					after.extend_from_slice(code);
				}

				i += len;
				continue;
			}
		}

		let next_esc = find_esc(line, i + 1).unwrap_or(line.len());
		let end = if next_esc == i { i + 1 } else { next_esc };
		let chunk = &line[i..end];

		if is_ascii_u16(chunk) {
			for &c in chunk {
				let w = ascii_cell_width(c);

				if current_col < before_end {
					if !pending_before_ansi.is_empty() {
						for &(p, l) in &pending_before_ansi {
							before.extend_from_slice(&line[p..p + l]);
						}
						pending_before_ansi.clear();
					}
					before.push(c);
					before_width += w;
				} else if current_col >= after_start && current_col < after_end {
					let fits = !strict_after || current_col + w <= after_end;
					if fits {
						if !after_started {
							tracker.write_active_codes(&mut after);
							after_started = true;
						}
						after.push(c);
						after_width += w;
					}
				}

				current_col += w;

				let done = if after_len == 0 {
					current_col >= before_end
				} else {
					current_col >= after_end
				};
				if done {
					break;
				}
			}
		} else {
			let mut should_break = false;
			for_each_grapheme(chunk, |_, gu16, gw| {
				if current_col < before_end {
					if !pending_before_ansi.is_empty() {
						for &(p, l) in &pending_before_ansi {
							before.extend_from_slice(&line[p..p + l]);
						}
						pending_before_ansi.clear();
					}
					before.extend_from_slice(gu16);
					before_width += gw;
				} else if current_col >= after_start && current_col < after_end {
					let fits = !strict_after || current_col + gw <= after_end;
					if fits {
						if !after_started {
							tracker.write_active_codes(&mut after);
							after_started = true;
						}
						after.extend_from_slice(gu16);
						after_width += gw;
					}
				}

				current_col += gw;

				let done = if after_len == 0 {
					current_col >= before_end
				} else {
					current_col >= after_end
				};
				if done {
					should_break = true;
					return false;
				}
				true
			});

			if should_break {
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

	(before, before_width, after, after_width)
}

/// Extract the before/after slices around an overlay region.
#[napi(js_name = "extractSegments")]
pub fn extract_segments(
	line: JsString,
	before_end: u32,
	after_start: u32,
	after_len: u32,
	strict_after: bool,
) -> Result<ExtractSegmentsResult> {
	let line_u16 = line.into_utf16()?;
	let line_data = line_u16.as_slice();

	let (before_out, before_w, after_out, after_w) = extract_segments_impl(
		line_data,
		before_end as usize,
		after_start as usize,
		after_len as usize,
		strict_after,
	);

	Ok(ExtractSegmentsResult {
		before:       u16_to_string(before_out),
		before_width: clamp_u32(before_w),
		after:        u16_to_string(after_out),
		after_width:  clamp_u32(after_w),
	})
}

#[cfg(test)]
mod tests {
	use super::*;

	fn to_u16(s: &str) -> Vec<u16> {
		s.encode_utf16().collect()
	}

	#[test]
	fn test_visible_width() {
		assert_eq!(visible_width_full(&to_u16("hello")), 5);
		assert_eq!(visible_width_full(&to_u16("\x1b[31mhello\x1b[0m")), 5);
		assert_eq!(visible_width_full(&to_u16("\x1b[38;5;196mred\x1b[0m")), 3);
		assert_eq!(visible_width_full(&to_u16("a\tb")), 1 + TAB_WIDTH + 1);
	}

	#[test]
	fn test_ansi_detection() {
		let data = to_u16("\x1b[31mred\x1b[0m");
		assert_eq!(ansi_len(&data, 0), Some(5)); // \x1b[31m
		assert_eq!(ansi_len(&data, 8), Some(4)); // \x1b[0m
	}

	#[test]
	fn test_slice_basic() {
		let data = to_u16("hello world");
		let (out, width) = slice_with_width_impl(&data, 0, 5, false);
		assert_eq!(String::from_utf16_lossy(&out), "hello");
		assert_eq!(width, 5);
	}

	#[test]
	fn test_slice_with_ansi() {
		let data = to_u16("\x1b[31mhello\x1b[0m world");
		let (out, width) = slice_with_width_impl(&data, 0, 5, false);
		assert_eq!(String::from_utf16_lossy(&out), "\x1b[31mhello\x1b[0m");
		assert_eq!(width, 5);
	}

	#[test]
	fn test_ascii_fast_path() {
		let ascii = to_u16("hello world 12345");
		assert!(is_ascii_u16(&ascii));

		let non_ascii = to_u16("hello 世界");
		assert!(!is_ascii_u16(&non_ascii));
	}

	#[test]
	fn test_early_exit() {
		let data = to_u16("a]b".repeat(1000).as_str());
		let (w, exceeded) = visible_width_up_to(&data, 10);
		assert!(exceeded);
		assert!(w > 10);
	}
}
