//! Clipboard utilities backed by arboard.
//!
//! # Overview
//! Provides text copy and image read support across Linux, macOS, and Windows
//! without shelling out to platform-specific commands.
//!
//! # Example
//! ```ignore
//! use pi_natives::clipboard::copy_to_clipboard;
//!
//! # async fn demo() -> napi::Result<()> {
//! copy_to_clipboard("hello".to_string()).await?;
//! # Ok(())
//! # }
//! ```

use std::io::Cursor;

use arboard::{Clipboard, Error as ClipboardError, ImageData};
use image::{DynamicImage, ImageFormat, RgbaImage};
use napi::{bindgen_prelude::*, tokio::task::spawn_blocking};
use napi_derive::napi;

/// Clipboard image payload encoded as PNG bytes.
#[napi(object)]
pub struct ClipboardImage {
	pub data:      Uint8Array,
	#[napi(js_name = "mimeType")]
	pub mime_type: String,
}

fn encode_png(image: ImageData<'_>) -> Result<Vec<u8>> {
	let width = u32::try_from(image.width)
		.map_err(|_| Error::from_reason("Clipboard image width overflow"))?;
	let height = u32::try_from(image.height)
		.map_err(|_| Error::from_reason("Clipboard image height overflow"))?;
	let bytes = image.bytes.into_owned();
	let buffer = RgbaImage::from_raw(width, height, bytes)
		.ok_or_else(|| Error::from_reason("Clipboard image buffer size mismatch"))?;
	let capacity = width.saturating_mul(height).saturating_mul(4) as usize;
	let mut output = Vec::with_capacity(capacity);
	DynamicImage::ImageRgba8(buffer)
		.write_to(&mut Cursor::new(&mut output), ImageFormat::Png)
		.map_err(|err| Error::from_reason(format!("Failed to encode clipboard image: {err}")))?;
	Ok(output)
}

/// Copy plain text to the system clipboard.
///
/// # Errors
/// Returns an error if clipboard access fails.
#[napi(js_name = "copyToClipboard")]
pub async fn copy_to_clipboard(text: String) -> Result<()> {
	spawn_blocking(move || -> Result<()> {
		let mut clipboard = Clipboard::new()
			.map_err(|err| Error::from_reason(format!("Failed to access clipboard: {err}")))?;
		clipboard
			.set_text(text)
			.map_err(|err| Error::from_reason(format!("Failed to copy to clipboard: {err}")))?;
		Ok(())
	})
	.await
	.map_err(|err| Error::from_reason(format!("Clipboard task failed: {err}")))??;
	Ok(())
}

/// Read an image from the system clipboard.
///
/// # Errors
/// Returns an error if clipboard access fails or image encoding fails.
#[napi(js_name = "readImageFromClipboard")]
pub async fn read_image_from_clipboard() -> Result<Option<ClipboardImage>> {
	let result = spawn_blocking(move || -> Result<Option<ClipboardImage>> {
		let mut clipboard = Clipboard::new()
			.map_err(|err| Error::from_reason(format!("Failed to access clipboard: {err}")))?;
		match clipboard.get_image() {
			Ok(image) => {
				let bytes = encode_png(image)?;
				Ok(Some(ClipboardImage {
					data:      Uint8Array::from(bytes),
					mime_type: "image/png".to_string(),
				}))
			},
			Err(ClipboardError::ContentNotAvailable) => Ok(None),
			Err(err) => Err(Error::from_reason(format!("Failed to read clipboard image: {err}"))),
		}
	})
	.await
	.map_err(|err| Error::from_reason(format!("Clipboard task failed: {err}")))??;
	Ok(result)
}
