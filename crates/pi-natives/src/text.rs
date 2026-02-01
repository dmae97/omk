//! ANSI-aware text measurement and slicing utilities.
//!
//! Optimized for JS string interop (UTF-16).
//! - Single-pass ANSI scanning (no O(n²) `next_ansi` rescans)
//! - ASCII fast-path (no grapheme segmentation, no UTF-8 conversion)
//! - Non-ASCII uses a reused scratch String for grapheme segmentation
//! - Width checks early-exit
//! - Ellipsis decoded lazily
//! - truncateToWidth returns the original `JsString` when possible

use napi::{JsString, bindgen_prelude::*};
use napi_derive::napi;
use unicode_segmentation::UnicodeSegmentation;
use unicode_width::{UnicodeWidthChar, UnicodeWidthStr};

const TAB_WIDTH: usize = 3;
const ESC: u16 = 0x1b;

fn build_utf16_string(data: Vec<u16>) -> Utf16String {
	// SAFETY: we know Utf16String == struct(Vec<u16>)
	unsafe { std::mem::transmute(data) }
}

// ============================================================================
// Results
// ============================================================================

#[napi(object)]
pub struct SliceResult {
	pub text:  Utf16String,
	pub width: u32,
}

#[napi(object)]
pub struct ExtractSegmentsResult {
	pub before:       Utf16String,
	#[napi(js_name = "beforeWidth")]
	pub before_width: u32,
	pub after:        Utf16String,
	#[napi(js_name = "afterWidth")]
	pub after_width:  u32,
}

#[inline]
fn clamp_u32(x: usize) -> u32 {
	x.min(u32::MAX as usize) as u32
}

// ============================================================================
// ANSI State Tracking - Zero Allocation
// ============================================================================

const ATTR_BOLD: u16 = 1 << 0;
const ATTR_DIM: u16 = 1 << 1;
const ATTR_ITALIC: u16 = 1 << 2;
const ATTR_UNDERLINE: u16 = 1 << 3;
const ATTR_BLINK: u16 = 1 << 4;
const ATTR_INVERSE: u16 = 1 << 6;
const ATTR_HIDDEN: u16 = 1 << 7;
const ATTR_STRIKE: u16 = 1 << 8;

type ColorVal = u32;
const COLOR_NONE: ColorVal = 0;

#[derive(Clone, Copy, Default)]
struct AnsiState {
	attrs: u16,
	fg:    ColorVal,
	bg:    ColorVal,
}

impl AnsiState {
	#[inline]
	const fn new() -> Self {
		Self { attrs: 0, fg: COLOR_NONE, bg: COLOR_NONE }
	}

	#[inline]
	const fn is_empty(&self) -> bool {
		self.attrs == 0 && self.fg == COLOR_NONE && self.bg == COLOR_NONE
	}

	#[inline]
	const fn reset(&mut self) {
		*self = Self::new();
	}

	fn apply_sgr_u16(&mut self, params: &[u16]) {
		if params.is_empty() {
			self.reset();
			return;
		}

		let mut i = 0;
		while i < params.len() {
			let (code, next_i) = parse_sgr_num_u16(params, i);
			i = next_i;

			match code {
				0 => self.reset(),
				1 => self.attrs |= ATTR_BOLD,
				2 => self.attrs |= ATTR_DIM,
				3 => self.attrs |= ATTR_ITALIC,
				4 => self.attrs |= ATTR_UNDERLINE,
				5 => self.attrs |= ATTR_BLINK,
				7 => self.attrs |= ATTR_INVERSE,
				8 => self.attrs |= ATTR_HIDDEN,
				9 => self.attrs |= ATTR_STRIKE,

				21 => self.attrs &= !ATTR_BOLD,
				22 => self.attrs &= !(ATTR_BOLD | ATTR_DIM),
				23 => self.attrs &= !ATTR_ITALIC,
				24 => self.attrs &= !ATTR_UNDERLINE,
				25 => self.attrs &= !ATTR_BLINK,
				27 => self.attrs &= !ATTR_INVERSE,
				28 => self.attrs &= !ATTR_HIDDEN,
				29 => self.attrs &= !ATTR_STRIKE,

				30..=37 => self.fg = (code - 29) as ColorVal,
				39 => self.fg = COLOR_NONE,
				40..=47 => self.bg = (code - 39) as ColorVal,
				49 => self.bg = COLOR_NONE,
				90..=97 => self.fg = (code - 81) as ColorVal,
				100..=107 => self.bg = (code - 91) as ColorVal,

				38 | 48 => {
					let (mode, ni) = parse_sgr_num_u16(params, i);
					i = ni;

					let color = match mode {
						5 => {
							let (idx, ni) = parse_sgr_num_u16(params, i);
							i = ni;
							0x100 | (idx as ColorVal & 0xff)
						},
						2 => {
							let (r, ni) = parse_sgr_num_u16(params, i);
							let (g, ni) = parse_sgr_num_u16(params, ni);
							let (b, ni) = parse_sgr_num_u16(params, ni);
							i = ni;
							0x1000000
								| ((r as ColorVal & 0xff) << 16)
								| ((g as ColorVal & 0xff) << 8)
								| (b as ColorVal & 0xff)
						},
						_ => continue,
					};

					if code == 38 {
						self.fg = color;
					} else {
						self.bg = color;
					}
				},

				_ => {},
			}
		}
	}

	fn write_restore_u16(&self, out: &mut Vec<u16>) {
		if self.is_empty() {
			return;
		}

		out.extend_from_slice(&[ESC, b'[' as u16]);
		let mut first = true;

		macro_rules! push_code {
			($code:expr) => {{
				if !first {
					out.push(b';' as u16);
				}
				first = false;
				write_u32_u16(out, $code);
			}};
		}

		if self.attrs & ATTR_BOLD != 0 {
			push_code!(1);
		}
		if self.attrs & ATTR_DIM != 0 {
			push_code!(2);
		}
		if self.attrs & ATTR_ITALIC != 0 {
			push_code!(3);
		}
		if self.attrs & ATTR_UNDERLINE != 0 {
			push_code!(4);
		}
		if self.attrs & ATTR_BLINK != 0 {
			push_code!(5);
		}
		if self.attrs & ATTR_INVERSE != 0 {
			push_code!(7);
		}
		if self.attrs & ATTR_HIDDEN != 0 {
			push_code!(8);
		}
		if self.attrs & ATTR_STRIKE != 0 {
			push_code!(9);
		}

		write_color_u16(out, self.fg, 38, &mut first);
		write_color_u16(out, self.bg, 48, &mut first);

		out.push(b'm' as u16);
	}
}

#[inline]
fn write_color_u16(out: &mut Vec<u16>, color: ColorVal, base: u32, first: &mut bool) {
	if color == COLOR_NONE {
		return;
	}

	if !*first {
		out.push(b';' as u16);
	}
	*first = false;

	if color < 0x100 {
		let code = if color <= 8 { color + 29 } else { color + 81 };
		let code = if base == 48 { code + 10 } else { code };
		write_u32_u16(out, code);
	} else if color < 0x1000000 {
		write_u32_u16(out, base);
		out.extend_from_slice(&[b';' as u16, b'5' as u16, b';' as u16]);
		write_u32_u16(out, color & 0xff);
	} else {
		write_u32_u16(out, base);
		out.extend_from_slice(&[b';' as u16, b'2' as u16, b';' as u16]);
		write_u32_u16(out, (color >> 16) & 0xff);
		out.push(b';' as u16);
		write_u32_u16(out, (color >> 8) & 0xff);
		out.push(b';' as u16);
		write_u32_u16(out, color & 0xff);
	}
}

#[inline]
fn parse_sgr_num_u16(params: &[u16], mut i: usize) -> (u32, usize) {
	while i < params.len() && params[i] == b';' as u16 {
		i += 1;
	}

	let mut val: u32 = 0;
	while i < params.len() {
		let b = params[i];
		if b == b';' as u16 {
			i += 1;
			break;
		}
		if (b'0' as u16..=b'9' as u16).contains(&b) {
			val = val
				.saturating_mul(10)
				.saturating_add((b - b'0' as u16) as u32);
		}
		i += 1;
	}
	(val, i)
}

#[inline]
fn write_u32_u16(out: &mut Vec<u16>, mut val: u32) {
	if val == 0 {
		out.push(b'0' as u16);
		return;
	}
	let start = out.len();
	while val > 0 {
		out.push(b'0' as u16 + (val % 10) as u16);
		val /= 10;
	}
	out[start..].reverse();
}

// ============================================================================
// ANSI Sequence Detection - UTF-16
// ============================================================================

#[inline]
fn ansi_seq_len_u16(data: &[u16], pos: usize) -> Option<usize> {
	if pos >= data.len() || data[pos] != ESC {
		return None;
	}
	if pos + 1 >= data.len() {
		return None;
	}

	match data[pos + 1] {
		0x5b => {
			// '[' CSI
			for (i, b) in data[pos + 2..].iter().enumerate() {
				if (0x40..=0x7e).contains(b) {
					return Some(i + 1 - pos);
				}
			}
			None
		},
		0x5d => {
			// ']' OSC
			for (i, &b) in data[pos + 2..].iter().enumerate() {
				if b == 0x07 {
					return Some(i + 1 - pos);
				}
				if b == ESC && data.get(i + 1) == Some(&0x5c) {
					return Some(i + 2 - pos);
				}
			}
			None
		},
		_ => None,
	}
}

#[inline]
fn is_sgr_u16(seq: &[u16]) -> bool {
	seq.len() >= 3 && seq[1] == b'[' as u16 && *seq.last().unwrap() == b'm' as u16
}

// ============================================================================
// Grapheme / Width
// ============================================================================

#[inline]
const fn ascii_cell_width_u16(u: u16) -> usize {
	let b = u as u8;
	match b {
		b'\t' => TAB_WIDTH,
		0x20..=0x7e => 1,
		_ => 0,
	}
}

#[inline]
fn segment_is_ascii_u16(seg: &[u16]) -> bool {
	seg.iter().all(|&u| u <= 0x7f)
}

#[inline]
fn grapheme_width_str(g: &str) -> usize {
	if g == "\t" {
		return TAB_WIDTH;
	}
	if g.len() == 1 {
		return g
			.chars()
			.next()
			.and_then(UnicodeWidthChar::width)
			.unwrap_or(0);
	}
	UnicodeWidthStr::width(g)
}

/// Iterate graphemes in a UTF-16 segment with:
/// - ASCII fast path (no UTF-8 conversion)
/// - non-ASCII slow path using a reused scratch String
///
/// Callback returns `true` to continue, `false` to stop early.
#[inline]
fn for_each_grapheme_u16<F>(segment: &[u16], scratch: &mut String, mut f: F) -> bool
where
	F: FnMut(&[u16], usize) -> bool,
{
	if segment.is_empty() {
		return true;
	}

	if segment_is_ascii_u16(segment) {
		for i in 0..segment.len() {
			let w = ascii_cell_width_u16(segment[i]);
			if !f(&segment[i..=i], w) {
				return false;
			}
		}
		return true;
	}

	// Slow path: decode into scratch once, reuse allocation
	scratch.clear();
	scratch.reserve(segment.len());

	for r in std::char::decode_utf16(segment.iter().copied()) {
		scratch.push(r.unwrap_or('\u{FFFD}'));
	}

	let mut utf16_pos = 0usize;
	for g in scratch.graphemes(true) {
		let w = grapheme_width_str(g);

		let g_u16_len: usize = g.chars().map(|c| c.len_utf16()).sum();
		let u16_slice = &segment[utf16_pos..utf16_pos + g_u16_len];
		utf16_pos += g_u16_len;

		if !f(u16_slice, w) {
			return false;
		}
	}

	true
}

/// Visible width, with early-exit if width exceeds `limit`.
fn visible_width_u16_up_to(data: &[u16], limit: usize, scratch: &mut String) -> (usize, bool) {
	let mut width = 0usize;
	let mut i = 0usize;

	while i < data.len() {
		if data[i] == ESC {
			if let Some(len) = ansi_seq_len_u16(data, i) {
				i += len;
				continue;
			}
			// invalid ESC: treat as width 0 and continue
			i += 1;
			continue;
		}

		// plain run until next ESC (or end)
		let start = i;
		while i < data.len() && data[i] != ESC {
			i += 1;
		}
		let seg = &data[start..i];

		let ok = for_each_grapheme_u16(seg, scratch, |_, w| {
			width += w;
			width <= limit
		});
		if !ok {
			return (width, true);
		}
	}

	(width, width > limit)
}

fn visible_width_u16(data: &[u16], scratch: &mut String) -> usize {
	visible_width_u16_up_to(data, usize::MAX, scratch).0
}

// ============================================================================
// truncateToWidth
// ============================================================================

/// Truncate text to a visible width, preserving ANSI codes.
///
/// `ellipsis_kind`: 0 = "…", 1 = "...", 2 = "" (omit)
#[napi(js_name = "truncateToWidth")]
pub fn truncate_to_width(
	text: JsString<'_>,
	max_width: u32,
	ellipsis_kind: u8,
	pad: bool,
) -> Result<Either<JsString<'_>, Utf16String>> {
	let max_width = max_width as usize;

	// Keep original handle so we can return it without allocating.
	let original = text;

	let text_u16 = text.into_utf16()?;
	let text = text_u16.as_slice();

	let mut scratch = String::new();

	// Fast path: early-exit width check
	let (text_w, exceeded) = visible_width_u16_up_to(text, max_width, &mut scratch);
	if !exceeded {
		if !pad {
			// Return original JsString handle: zero output allocation.
			return Ok(Either::A(original));
		}

		if text_w < max_width {
			let mut out = Vec::with_capacity(text.len() + (max_width - text_w));
			out.extend_from_slice(text);
			out.resize(out.len() + (max_width - text_w), b' ' as u16);
			return Ok(Either::B(build_utf16_string(out)));
		}

		// Exactly fits and padding requested: return original is still fine.
		return Ok(Either::A(original));
	}

	// Map ellipsis kind to UTF-16 data and width
	const ELLIPSIS_UNICODE: &[u16] = &[0x2026]; // "…"
	const ELLIPSIS_ASCII: &[u16] = &[0x2e, 0x2e, 0x2e]; // "..."
	const ELLIPSIS_OMIT: &[u16] = &[];

	let (ellipsis, ellipsis_w): (&[u16], usize) = match ellipsis_kind {
		0 => (ELLIPSIS_UNICODE, 1),
		1 => (ELLIPSIS_ASCII, 3),
		2 => (ELLIPSIS_OMIT, 0),
		_ => (ELLIPSIS_UNICODE, 1), // Default to Unicode for invalid values
	};

	let target_w = max_width.saturating_sub(ellipsis_w);

	// If ellipsis alone doesn't fit, return ellipsis cut to max_width
	if target_w == 0 {
		let mut out = Vec::with_capacity(ellipsis.len().min(max_width * 2));
		let mut w = 0usize;
		let _ = for_each_grapheme_u16(ellipsis, &mut scratch, |gu16, gw| {
			if w + gw > max_width {
				return false;
			}
			out.extend_from_slice(gu16);
			w += gw;
			true
		});

		if pad && w < max_width {
			out.resize(out.len() + (max_width - w), b' ' as u16);
		}
		return Ok(Either::B(build_utf16_string(out)));
	}

	// Main truncation
	let mut out = Vec::with_capacity(text.len().min(max_width * 2) + ellipsis.len() + 8);
	let mut w = 0usize;
	let mut i = 0usize;

	let mut saw_any_ansi = false;

	while i < text.len() {
		if text[i] == ESC {
			if let Some(len) = ansi_seq_len_u16(text, i) {
				out.extend_from_slice(&text[i..i + len]);
				saw_any_ansi = true;
				i += len;
				continue;
			}
			// invalid ESC; preserve it as literal width-0
			out.push(ESC);
			i += 1;
			continue;
		}

		let start = i;
		while i < text.len() && text[i] != ESC {
			i += 1;
		}
		let seg = &text[start..i];

		let keep_going = for_each_grapheme_u16(seg, &mut scratch, |gu16, gw| {
			if w + gw > target_w {
				return false;
			}
			out.extend_from_slice(gu16);
			w += gw;
			true
		});

		if !keep_going {
			break;
		}
	}

	// Only reset if we actually copied ANSI codes into the output.
	if saw_any_ansi {
		out.extend_from_slice(&[ESC, b'[' as u16, b'0' as u16, b'm' as u16]);
	}
	out.extend_from_slice(ellipsis);

	if pad {
		let out_w = w + ellipsis_w;
		if out_w < max_width {
			out.resize(out.len() + (max_width - out_w), b' ' as u16);
		}
	}

	Ok(Either::B(build_utf16_string(out)))
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
	let end_col = start_col.saturating_add(length);

	let mut out = Vec::with_capacity(length * 2);
	let mut out_w = 0usize;

	let mut current_col = 0usize;
	let mut i = 0usize;

	// store pending ANSI ranges (pos,len) to avoid copying until needed
	let mut pending_ansi: Vec<(usize, usize)> = Vec::new();

	let mut scratch = String::new();

	while i < line.len() && current_col < end_col {
		if line[i] == ESC {
			if let Some(len) = ansi_seq_len_u16(line, i) {
				if current_col >= start_col {
					out.extend_from_slice(&line[i..i + len]);
				} else {
					pending_ansi.push((i, len));
				}
				i += len;
				continue;
			}
			// invalid ESC literal width 0
			if current_col >= start_col {
				out.push(ESC);
			}
			i += 1;
			continue;
		}

		let start = i;
		while i < line.len() && line[i] != ESC {
			i += 1;
		}
		let seg = &line[start..i];

		let _ = for_each_grapheme_u16(seg, &mut scratch, |gu16, gw| {
			if current_col >= end_col {
				return false;
			}

			let in_range = current_col >= start_col;
			let fits = !strict || current_col + gw <= end_col;

			if in_range && fits {
				if !pending_ansi.is_empty() {
					for &(p, l) in &pending_ansi {
						out.extend_from_slice(&line[p..p + l]);
					}
					pending_ansi.clear();
				}
				out.extend_from_slice(gu16);
				out_w += gw;
			}

			current_col += gw;
			current_col < end_col
		});
	}

	// Include trailing ANSI sequences (e.g., reset codes) that immediately follow
	while i < line.len() {
		if line[i] == ESC
			&& let Some(len) = ansi_seq_len_u16(line, i)
		{
			out.extend_from_slice(&line[i..i + len]);
			i += len;
			continue;
		}
		break;
	}

	(out, out_w)
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
	let line = line_u16.as_slice();

	let (out, w) = slice_with_width_impl(line, start_col as usize, length as usize, strict);

	Ok(SliceResult { text: build_utf16_string(out), width: clamp_u32(w) })
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
	let after_end = after_start.saturating_add(after_len);

	let mut before = Vec::with_capacity(before_end * 2);
	let mut before_w = 0usize;

	let mut after = Vec::with_capacity(after_len * 2);
	let mut after_w = 0usize;

	let mut current_col = 0usize;
	let mut i = 0usize;

	// Store pending ANSI ranges for "before"
	let mut pending_before_ansi: Vec<(usize, usize)> = Vec::new();

	let mut after_started = false;
	let mut state = AnsiState::new();

	let mut scratch = String::new();

	while i < line.len() {
		let done = if after_len == 0 {
			current_col >= before_end
		} else {
			current_col >= after_end
		};
		if done {
			break;
		}

		if line[i] == ESC {
			if let Some(len) = ansi_seq_len_u16(line, i) {
				let seq = &line[i..i + len];
				if is_sgr_u16(seq) {
					// between ESC[ and 'm'
					state.apply_sgr_u16(&seq[2..len - 1]);
				}

				if current_col < before_end {
					pending_before_ansi.push((i, len));
				} else if current_col >= after_start && current_col < after_end && after_started {
					after.extend_from_slice(seq);
				}

				i += len;
				continue;
			}

			// invalid ESC literal width 0
			if current_col < before_end {
				before.push(ESC);
			} else if current_col >= after_start && current_col < after_end && after_started {
				after.push(ESC);
			}
			i += 1;
			continue;
		}

		let start = i;
		while i < line.len() && line[i] != ESC {
			i += 1;
		}
		let seg = &line[start..i];

		let _ = for_each_grapheme_u16(seg, &mut scratch, |gu16, gw| {
			let done_inner = if after_len == 0 {
				current_col >= before_end
			} else {
				current_col >= after_end
			};
			if done_inner {
				return false;
			}

			if current_col < before_end {
				if !pending_before_ansi.is_empty() {
					for &(p, l) in &pending_before_ansi {
						before.extend_from_slice(&line[p..p + l]);
					}
					pending_before_ansi.clear();
				}
				before.extend_from_slice(gu16);
				before_w += gw;
			} else if current_col >= after_start && current_col < after_end {
				let fits = !strict_after || current_col + gw <= after_end;
				if fits {
					if !after_started {
						state.write_restore_u16(&mut after);
						after_started = true;
					}
					after.extend_from_slice(gu16);
					after_w += gw;
				}
			}

			current_col += gw;
			true
		});
	}

	(before, before_w, after, after_w)
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
	let line = line_u16.as_slice();

	let (before, bw, after, aw) = extract_segments_impl(
		line,
		before_end as usize,
		after_start as usize,
		after_len as usize,
		strict_after,
	);

	Ok(ExtractSegmentsResult {
		before:       build_utf16_string(before),
		before_width: clamp_u32(bw),
		after:        build_utf16_string(after),
		after_width:  clamp_u32(aw),
	})
}

// ============================================================================
// visibleWidth
// ============================================================================

/// Calculate visible width of text, excluding ANSI escape sequences.
#[napi(js_name = "visibleWidth")]
pub fn visible_width_napi(text: JsString) -> Result<u32> {
	let text_u16 = text.into_utf16()?;
	let mut scratch = String::new();
	Ok(clamp_u32(visible_width_u16(text_u16.as_slice(), &mut scratch)))
}

#[cfg(test)]
mod tests {
	use super::*;

	fn to_u16(s: &str) -> Vec<u16> {
		s.encode_utf16().collect()
	}

	#[test]
	fn test_visible_width() {
		let mut scratch = String::new();
		assert_eq!(visible_width_u16(&to_u16("hello"), &mut scratch), 5);
		assert_eq!(visible_width_u16(&to_u16("\x1b[31mhello\x1b[0m"), &mut scratch), 5);
		assert_eq!(visible_width_u16(&to_u16("\x1b[38;5;196mred\x1b[0m"), &mut scratch), 3);
		assert_eq!(visible_width_u16(&to_u16("a\tb"), &mut scratch), 1 + TAB_WIDTH + 1);
	}

	#[test]
	fn test_ansi_detection() {
		let data = to_u16("\x1b[31mred\x1b[0m");
		assert_eq!(ansi_seq_len_u16(&data, 0), Some(5)); // \x1b[31m
		assert_eq!(ansi_seq_len_u16(&data, 8), Some(4)); // \x1b[0m
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
		assert!(segment_is_ascii_u16(&ascii));

		let non_ascii = to_u16("hello 世界");
		assert!(!segment_is_ascii_u16(&non_ascii));
	}

	#[test]
	fn test_early_exit() {
		let data = to_u16(&"a]b".repeat(1000));
		let mut scratch = String::new();
		let (w, exceeded) = visible_width_u16_up_to(&data, 10, &mut scratch);
		assert!(exceeded);
		assert!(w > 10);
	}
}
