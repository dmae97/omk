//! Minimal image processing API for resizing and format conversion.
//!
//! Provides only the subset of functionality needed:
//! - Load image from bytes (PNG, JPEG, WebP, GIF)
//! - Get dimensions
//! - Resize with Lanczos3 filter
//! - Export as PNG or JPEG

use std::io::Cursor;

use image::{DynamicImage, ImageFormat, ImageReader, imageops::FilterType};
use wasm_bindgen::prelude::*;

/// Sampling filter for resize operations.
#[wasm_bindgen]
#[derive(Clone, Copy)]
pub enum SamplingFilter {
	Nearest   = 1,
	Triangle  = 2,
	CatmullRom = 3,
	Gaussian  = 4,
	Lanczos3  = 5,
}

impl From<SamplingFilter> for FilterType {
	fn from(filter: SamplingFilter) -> Self {
		match filter {
			SamplingFilter::Nearest => FilterType::Nearest,
			SamplingFilter::Triangle => FilterType::Triangle,
			SamplingFilter::CatmullRom => FilterType::CatmullRom,
			SamplingFilter::Gaussian => FilterType::Gaussian,
			SamplingFilter::Lanczos3 => FilterType::Lanczos3,
		}
	}
}

/// Image container for WASM interop.
#[wasm_bindgen]
pub struct PhotonImage {
	img: DynamicImage,
}

#[wasm_bindgen]
impl PhotonImage {
	/// Create a new PhotonImage from encoded image bytes (PNG, JPEG, WebP, GIF).
	#[wasm_bindgen(js_name = new_from_byteslice)]
	pub fn new_from_byteslice(bytes: &[u8]) -> Result<PhotonImage, JsValue> {
		let reader = ImageReader::new(Cursor::new(bytes))
			.with_guessed_format()
			.map_err(|e| JsValue::from_str(&format!("Failed to detect image format: {e}")))?;

		let img = reader
			.decode()
			.map_err(|e| JsValue::from_str(&format!("Failed to decode image: {e}")))?;

		Ok(PhotonImage { img })
	}

	/// Get the width of the image.
	#[wasm_bindgen(js_name = get_width)]
	pub fn get_width(&self) -> u32 {
		self.img.width()
	}

	/// Get the height of the image.
	#[wasm_bindgen(js_name = get_height)]
	pub fn get_height(&self) -> u32 {
		self.img.height()
	}

	/// Export image as PNG bytes.
	#[wasm_bindgen(js_name = get_bytes)]
	pub fn get_bytes(&self) -> Result<Vec<u8>, JsValue> {
		let mut buffer = Vec::new();
		self.img
			.write_to(&mut Cursor::new(&mut buffer), ImageFormat::Png)
			.map_err(|e| JsValue::from_str(&format!("Failed to encode PNG: {e}")))?;
		Ok(buffer)
	}

	/// Export image as JPEG bytes with specified quality (0-100).
	#[wasm_bindgen(js_name = get_bytes_jpeg)]
	pub fn get_bytes_jpeg(&self, quality: u8) -> Result<Vec<u8>, JsValue> {
		let mut buffer = Vec::new();
		let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buffer, quality);
		self.img
			.write_with_encoder(encoder)
			.map_err(|e| JsValue::from_str(&format!("Failed to encode JPEG: {e}")))?;
		Ok(buffer)
	}
}

/// Resize an image to the specified dimensions.
#[wasm_bindgen]
pub fn resize(
	image: &PhotonImage,
	width: u32,
	height: u32,
	filter: SamplingFilter,
) -> PhotonImage {
	let resized = image.img.resize_exact(width, height, filter.into());
	PhotonImage { img: resized }
}
