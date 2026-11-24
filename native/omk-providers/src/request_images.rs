//! Header guard ported from packages/ai/src/providers/anthropic-image-guard.ts (MIT).
fn header(data: &str) -> Vec<u8> {
    let mut bytes = Vec::new();
    let (mut value, mut bits) = (0u32, 0);
    // Buffer.from(base64) uses low UTF-16 bytes; slice by code units before decoding.
    for unit in data.encode_utf16().take(87384) {
        let digit = match unit as u8 {
            b'A'..=b'Z' => (unit as u8 - b'A') as u32,
            b'a'..=b'z' => (unit as u8 - b'a' + 26) as u32,
            b'0'..=b'9' => (unit as u8 - b'0' + 52) as u32,
            b'+' | b'-' => 62,
            b'/' | b'_' => 63,
            b'=' => break,
            _ => continue,
        };
        value = (value << 6) | digit;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            bytes.push((value >> bits) as u8);
            value &= (1 << bits) - 1;
        }
    }
    bytes
}
fn dimensions(b: &[u8]) -> Option<(u32, u32)> {
    if b.len() < 10 {
        return None;
    }
    let be16 = |i| u16::from_be_bytes([b[i], b[i + 1]]) as u32;
    let le16 = |i| u16::from_le_bytes([b[i], b[i + 1]]) as u32;
    if b.starts_with(&[0x89, 0x50, 0x4e, 0x47]) {
        return (b.len() >= 24).then(|| {
            (
                u32::from_be_bytes(b[16..20].try_into().unwrap()),
                u32::from_be_bytes(b[20..24].try_into().unwrap()),
            )
        });
    }
    if b.starts_with(b"GIF8") {
        return Some((le16(6), le16(8)));
    }
    if b.starts_with(&[0xff, 0xd8]) {
        let mut offset = 2;
        while offset + 9 < b.len() {
            if b[offset] != 0xff {
                offset += 1;
                continue;
            }
            let marker = b[offset + 1];
            if (0xc0..=0xcf).contains(&marker) && ![0xc4, 0xc8, 0xcc].contains(&marker) {
                return Some((be16(offset + 7), be16(offset + 5)));
            }
            let size = be16(offset + 2) as usize;
            if size < 2 {
                break;
            }
            offset += 2 + size;
        }
        return None;
    }
    if b.len() >= 30 && b.starts_with(b"RIFF") && &b[8..12] == b"WEBP" {
        return match &b[12..16] {
            b"VP8X" => Some((
                1 + b[24] as u32 + ((b[25] as u32) << 8) + ((b[26] as u32) << 16),
                1 + b[27] as u32 + ((b[28] as u32) << 8) + ((b[29] as u32) << 16),
            )),
            b"VP8 " => Some((le16(26) & 0x3fff, le16(28) & 0x3fff)),
            b"VP8L" => Some((
                1 + (((b[22] as u32 & 0x3f) << 8) | b[21] as u32),
                1 + (((b[24] as u32 & 0x0f) << 10)
                    | ((b[23] as u32) << 2)
                    | ((b[22] as u32 & 0xc0) >> 6)),
            )),
            _ => None,
        };
    }
    None
}
pub(crate) fn omission(data: &str) -> Option<String> {
    let (width, height) = dimensions(&header(data))?;
    (width > 1900 || height > 1900).then(|| format!(
        "[image omitted: {width}x{height} exceeds the Anthropic 1900px dimension limit. The image was replaced to keep the request valid — ask the user to resize and re-attach it if its content is needed.]"
    ))
}

#[cfg(test)]
mod tests {
    use super::header;
    #[test]
    fn bounded_base64_matches_observed_node_utf16_rules() {
        assert_eq!(header("ŁAAA"), [0, 0, 0]);
        assert!(header("ĽAAAA").is_empty());
        assert_eq!(header("🌏AAAA"), [0, 0, 0]);
        assert!(header(&format!("{}AAAA", "!".repeat(87384))).is_empty());
    }
}
