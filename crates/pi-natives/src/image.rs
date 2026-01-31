//! Minimal image processing API for resizing and format conversion.
//!
//! Provides only the subset of functionality needed:
//! - Load image from bytes (PNG, JPEG, WebP, GIF)
//! - Get dimensions
//! - Resize with Lanczos3 filter
//! - Export as PNG, JPEG, WebP, or GIF

use std::io::Cursor;

use image::{imageops::FilterType, DynamicImage, ImageFormat, ImageReader};
use napi::bindgen_prelude::*;
use napi_derive::napi;

/// Sampling filter for resize operations.
#[napi]
pub enum SamplingFilter {
	Nearest    = 1,
	Triangle   = 2,
	CatmullRom = 3,
	Gaussian   = 4,
	Lanczos3   = 5,
}

impl From<SamplingFilter> for FilterType {
	fn from(filter: SamplingFilter) -> Self {
		match filter {
			SamplingFilter::Nearest => Self::Nearest,
			SamplingFilter::Triangle => Self::Triangle,
			SamplingFilter::CatmullRom => Self::CatmullRom,
			SamplingFilter::Gaussian => Self::Gaussian,
			SamplingFilter::Lanczos3 => Self::Lanczos3,
		}
	}
}

/// Image container for native interop.
#[napi]
pub struct PhotonImage {
	img: DynamicImage,
}

#[napi]
impl PhotonImage {
	/// Create a new `PhotonImage` from encoded image bytes (PNG, JPEG, WebP,
	/// GIF).
	///
	/// # Errors
	/// Returns an error if the image format cannot be detected or decoded.
	#[napi(factory, js_name = "new_from_byteslice")]
	pub fn new_from_byteslice(bytes: Uint8Array) -> Result<Self> {
		let reader = ImageReader::new(Cursor::new(bytes.as_ref()))
			.with_guessed_format()
			.map_err(|e| Error::from_reason(format!("Failed to detect image format: {e}")))?;

		let img = reader
			.decode()
			.map_err(|e| Error::from_reason(format!("Failed to decode image: {e}")))?;

		Ok(Self { img })
	}

	/// Get the width of the image.
	#[napi(js_name = "get_width")]
	pub fn get_width(&self) -> u32 {
		self.img.width()
	}

	/// Get the height of the image.
	#[napi(js_name = "get_height")]
	pub fn get_height(&self) -> u32 {
		self.img.height()
	}

	/// Export image as PNG bytes.
	///
	/// # Errors
	/// Returns an error if PNG encoding fails.
	#[napi(js_name = "get_bytes")]
	pub fn get_bytes(&self) -> Result<Uint8Array> {
		let mut buffer = Vec::new();
		self
			.img
			.write_to(&mut Cursor::new(&mut buffer), ImageFormat::Png)
			.map_err(|e| Error::from_reason(format!("Failed to encode PNG: {e}")))?;
		Ok(Uint8Array::from(buffer))
	}

	/// Export image as JPEG bytes with specified quality (0-100).
	///
	/// # Errors
	/// Returns an error if JPEG encoding fails.
	#[napi(js_name = "get_bytes_jpeg")]
	pub fn get_bytes_jpeg(&self, quality: u8) -> Result<Uint8Array> {
		let mut buffer = Vec::new();
		let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buffer, quality);
		self
			.img
			.write_with_encoder(encoder)
			.map_err(|e| Error::from_reason(format!("Failed to encode JPEG: {e}")))?;
		Ok(Uint8Array::from(buffer))
	}

	/// Export image as lossless WebP bytes.
	///
	/// # Errors
	/// Returns an error if WebP encoding fails.
	#[napi(js_name = "get_bytes_webp")]
	pub fn get_bytes_webp(&self) -> Result<Uint8Array> {
		let mut buffer = Vec::new();
		let encoder = image::codecs::webp::WebPEncoder::new_lossless(&mut buffer);
		self
			.img
			.write_with_encoder(encoder)
			.map_err(|e| Error::from_reason(format!("Failed to encode WebP: {e}")))?;
		Ok(Uint8Array::from(buffer))
	}

	/// Export image as GIF bytes.
	///
	/// # Errors
	/// Returns an error if GIF encoding fails.
	#[napi(js_name = "get_bytes_gif")]
	pub fn get_bytes_gif(&self) -> Result<Uint8Array> {
		let mut buffer = Vec::new();
		self
			.img
			.write_to(&mut Cursor::new(&mut buffer), ImageFormat::Gif)
			.map_err(|e| Error::from_reason(format!("Failed to encode GIF: {e}")))?;
		Ok(Uint8Array::from(buffer))
	}

	/// Resize the image to the specified dimensions.
	#[napi(js_name = "resize")]
	pub fn resize(&self, width: u32, height: u32, filter: SamplingFilter) -> PhotonImage {
		let resized = self.img.resize_exact(width, height, filter.into());
		PhotonImage { img: resized }
	}
}
