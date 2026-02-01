//! Kitty keyboard sequence matching utilities.
//!
//! # Overview
//! Parses Kitty keyboard protocol sequences and matches codepoints plus
//! modifiers.
//!
//! # Example
//! ```ignore
//! // JS: native.matchesKittySequence("\x1b[65;5u", 65, 4)
//! ```

use napi_derive::napi;

const LOCK_MASK: u32 = 64 + 128;

const ARROW_UP: i32 = -1;
const ARROW_DOWN: i32 = -2;
const ARROW_RIGHT: i32 = -3;
const ARROW_LEFT: i32 = -4;

const FUNC_DELETE: i32 = -10;
const FUNC_INSERT: i32 = -11;
const FUNC_PAGE_UP: i32 = -12;
const FUNC_PAGE_DOWN: i32 = -13;
const FUNC_HOME: i32 = -14;
const FUNC_END: i32 = -15;

struct ParsedKittySequence {
	codepoint:       i32,
	base_layout_key: Option<i32>,
	modifier:        u32,
}

/// Matches Kitty protocol keyboard sequences against a codepoint and modifier.
///
/// # Errors
/// Returns `false` when the input is not a Kitty sequence or does not match.
#[napi(js_name = "matchesKittySequence")]
pub fn matches_kitty_sequence(
	data: String,
	expected_codepoint: i32,
	expected_modifier: u32,
) -> bool {
	let Some(parsed) = parse_kitty_sequence(&data) else {
		return false;
	};

	let actual_mod = parsed.modifier & !LOCK_MASK;
	let expected_mod = expected_modifier & !LOCK_MASK;
	if actual_mod != expected_mod {
		return false;
	}

	if parsed.codepoint == expected_codepoint {
		return true;
	}

	if parsed.base_layout_key == Some(expected_codepoint) {
		return true;
	}

	false
}

fn parse_kitty_sequence(data: &str) -> Option<ParsedKittySequence> {
	parse_csi_u(data)
		.or_else(|| parse_arrow_sequence(data))
		.or_else(|| parse_functional_sequence(data))
		.or_else(|| parse_home_end_sequence(data))
}

fn parse_csi_u(data: &str) -> Option<ParsedKittySequence> {
	let bytes = data.as_bytes();
	if bytes.len() < 4 || !bytes.starts_with(b"\x1b[") || *bytes.last()? != b'u' {
		return None;
	}

	let end = bytes.len() - 1;
	let mut idx = 2;
	let (codepoint, next_idx) = parse_digits(bytes, idx, end)?;
	let codepoint = to_i32(codepoint)?;
	idx = next_idx;

	let mut base_layout_key = None;
	if idx < end && bytes[idx] == b':' {
		idx += 1;
		let (_, next_idx) = parse_optional_digits(bytes, idx, end);
		idx = next_idx;
		if idx < end && bytes[idx] == b':' {
			idx += 1;
			let (base_value, next_idx) = parse_digits(bytes, idx, end)?;
			base_layout_key = Some(to_i32(base_value)?);
			idx = next_idx;
		}
	}

	let mod_value = if idx < end && bytes[idx] == b';' {
		idx += 1;
		let (mod_value, next_idx) = parse_digits(bytes, idx, end)?;
		idx = next_idx;
		mod_value
	} else {
		1
	};

	if idx < end && bytes[idx] == b':' {
		idx += 1;
		let (_, next_idx) = parse_digits(bytes, idx, end)?;
		idx = next_idx;
	}

	if idx != end || mod_value == 0 {
		return None;
	}

	Some(ParsedKittySequence { codepoint, base_layout_key, modifier: mod_value - 1 })
}

fn parse_arrow_sequence(data: &str) -> Option<ParsedKittySequence> {
	let bytes = data.as_bytes();
	if !bytes.starts_with(b"\x1b[1;") {
		return None;
	}

	let end = bytes.len();
	let mut idx = 4;
	let (mod_value, next_idx) = parse_digits(bytes, idx, end)?;
	idx = next_idx;

	if idx < end && bytes[idx] == b':' {
		idx += 1;
		let (_, next_idx) = parse_digits(bytes, idx, end)?;
		idx = next_idx;
	}

	if idx + 1 != end || mod_value == 0 {
		return None;
	}

	let codepoint = match bytes[idx] {
		b'A' => ARROW_UP,
		b'B' => ARROW_DOWN,
		b'C' => ARROW_RIGHT,
		b'D' => ARROW_LEFT,
		_ => return None,
	};

	Some(ParsedKittySequence { codepoint, base_layout_key: None, modifier: mod_value - 1 })
}

fn parse_functional_sequence(data: &str) -> Option<ParsedKittySequence> {
	let bytes = data.as_bytes();
	if bytes.len() < 4 || !bytes.starts_with(b"\x1b[") || *bytes.last()? != b'~' {
		return None;
	}

	let end = bytes.len() - 1;
	let mut idx = 2;
	let (key_num, next_idx) = parse_digits(bytes, idx, end)?;
	idx = next_idx;

	let mod_value = if idx < end && bytes[idx] == b';' {
		idx += 1;
		let (mod_value, next_idx) = parse_digits(bytes, idx, end)?;
		idx = next_idx;
		mod_value
	} else {
		1
	};

	if idx < end && bytes[idx] == b':' {
		idx += 1;
		let (_, next_idx) = parse_digits(bytes, idx, end)?;
		idx = next_idx;
	}

	if idx != end || mod_value == 0 {
		return None;
	}

	let codepoint = match key_num {
		2 => FUNC_INSERT,
		3 => FUNC_DELETE,
		5 => FUNC_PAGE_UP,
		6 => FUNC_PAGE_DOWN,
		7 => FUNC_HOME,
		8 => FUNC_END,
		_ => return None,
	};

	Some(ParsedKittySequence { codepoint, base_layout_key: None, modifier: mod_value - 1 })
}

fn parse_home_end_sequence(data: &str) -> Option<ParsedKittySequence> {
	let bytes = data.as_bytes();
	if !bytes.starts_with(b"\x1b[1;") {
		return None;
	}

	let end = bytes.len();
	let mut idx = 4;
	let (mod_value, next_idx) = parse_digits(bytes, idx, end)?;
	idx = next_idx;

	if idx < end && bytes[idx] == b':' {
		idx += 1;
		let (_, next_idx) = parse_digits(bytes, idx, end)?;
		idx = next_idx;
	}

	if idx + 1 != end || mod_value == 0 {
		return None;
	}

	let codepoint = match bytes[idx] {
		b'H' => FUNC_HOME,
		b'F' => FUNC_END,
		_ => return None,
	};

	Some(ParsedKittySequence { codepoint, base_layout_key: None, modifier: mod_value - 1 })
}

fn parse_digits(bytes: &[u8], mut idx: usize, end: usize) -> Option<(u32, usize)> {
	if idx >= end || !bytes[idx].is_ascii_digit() {
		return None;
	}

	let mut value: u32 = 0;
	while idx < end && bytes[idx].is_ascii_digit() {
		value = value
			.checked_mul(10)?
			.checked_add(u32::from(bytes[idx] - b'0'))?;
		idx += 1;
	}

	Some((value, idx))
}

fn parse_optional_digits(bytes: &[u8], idx: usize, end: usize) -> (Option<u32>, usize) {
	if idx >= end || !bytes[idx].is_ascii_digit() {
		return (None, idx);
	}

	let Some((value, next_idx)) = parse_digits(bytes, idx, end) else {
		return (None, idx);
	};
	(Some(value), next_idx)
}

fn to_i32(value: u32) -> Option<i32> {
	i32::try_from(value).ok()
}
