//! Minimal image processing API for resizing and format conversion.
//!
//! Provides only the subset of functionality needed:
//! - Load image from bytes (PNG, JPEG, WebP, GIF)
//! - Get dimensions
//! - Resize with Lanczos3 filter
//! - Export as PNG, JPEG, WebP, or GIF

use std::{io::Cursor, sync::Arc};

use image::{
	DynamicImage, ImageFormat, ImageReader,
	codecs::{jpeg::JpegEncoder, webp::WebPEncoder},
	imageops::FilterType,
};
use napi::{bindgen_prelude::*, tokio::task::spawn_blocking};
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
	img: Arc<DynamicImage>,
}

#[napi]
impl PhotonImage {
	/// Create a new `PhotonImage` from encoded image bytes (PNG, JPEG, WebP,
	/// GIF).
	///
	/// # Errors
	/// Returns an error if the image format cannot be detected or decoded.
	#[napi(factory, js_name = "newFromByteslice")]
	pub async fn new_from_byteslice(bytes: Uint8Array) -> Result<Self> {
		let bytes = bytes.as_ref().to_vec();
		let img = spawn_blocking(move || -> Result<DynamicImage> {
			let reader = ImageReader::new(Cursor::new(bytes))
				.with_guessed_format()
				.map_err(|e| Error::from_reason(format!("Failed to detect image format: {e}")))?;

			let img = reader
				.decode()
				.map_err(|e| Error::from_reason(format!("Failed to decode image: {e}")))?;

			Ok(img)
		})
		.await
		.map_err(|e| Error::from_reason(format!("Image decode task failed: {e}")))??;

		Ok(Self { img: Arc::new(img) })
	}

	/// Get the width of the image.
	#[napi(js_name = "getWidth")]
	pub fn get_width(&self) -> u32 {
		self.img.width()
	}

	/// Get the height of the image.
	#[napi(js_name = "getHeight")]
	pub fn get_height(&self) -> u32 {
		self.img.height()
	}

	/// Export image as PNG bytes.
	///
	/// # Errors
	/// Returns an error if PNG encoding fails.
	#[napi(js_name = "getBytes")]
	pub async fn get_bytes(&self) -> Result<Uint8Array> {
		let img = Arc::clone(&self.img);
		let buffer = spawn_blocking(move || -> Result<Vec<u8>> {
			let mut buffer = Vec::new();
			img.write_to(&mut Cursor::new(&mut buffer), ImageFormat::Png)
				.map_err(|e| Error::from_reason(format!("Failed to encode PNG: {e}")))?;
			Ok(buffer)
		})
		.await
		.map_err(|e| Error::from_reason(format!("PNG encode task failed: {e}")))??;
		Ok(Uint8Array::from(buffer))
	}

	/// Export image as JPEG bytes with specified quality (0-100).
	///
	/// # Errors
	/// Returns an error if JPEG encoding fails.
	#[napi(js_name = "getBytesJpeg")]
	pub async fn get_bytes_jpeg(&self, quality: u8) -> Result<Uint8Array> {
		let img = Arc::clone(&self.img);
		let buffer = spawn_blocking(move || -> Result<Vec<u8>> {
			let mut buffer = Vec::new();
			let encoder = JpegEncoder::new_with_quality(&mut buffer, quality);
			img.write_with_encoder(encoder)
				.map_err(|e| Error::from_reason(format!("Failed to encode JPEG: {e}")))?;
			Ok(buffer)
		})
		.await
		.map_err(|e| Error::from_reason(format!("JPEG encode task failed: {e}")))??;
		Ok(Uint8Array::from(buffer))
	}

	/// Export image as lossless WebP bytes.
	///
	/// # Errors
	/// Returns an error if WebP encoding fails.
	#[napi(js_name = "getBytesWebp")]
	pub async fn get_bytes_webp(&self) -> Result<Uint8Array> {
		let img = Arc::clone(&self.img);
		let buffer = spawn_blocking(move || -> Result<Vec<u8>> {
			let mut buffer = Vec::new();
			let encoder = WebPEncoder::new_lossless(&mut buffer);
			img.write_with_encoder(encoder)
				.map_err(|e| Error::from_reason(format!("Failed to encode WebP: {e}")))?;
			Ok(buffer)
		})
		.await
		.map_err(|e| Error::from_reason(format!("WebP encode task failed: {e}")))??;
		Ok(Uint8Array::from(buffer))
	}

	/// Export image as GIF bytes.
	///
	/// # Errors
	/// Returns an error if GIF encoding fails.
	#[napi(js_name = "getBytesGif")]
	pub async fn get_bytes_gif(&self) -> Result<Uint8Array> {
		let img = Arc::clone(&self.img);
		let buffer = spawn_blocking(move || -> Result<Vec<u8>> {
			let mut buffer = Vec::new();
			img.write_to(&mut Cursor::new(&mut buffer), ImageFormat::Gif)
				.map_err(|e| Error::from_reason(format!("Failed to encode GIF: {e}")))?;
			Ok(buffer)
		})
		.await
		.map_err(|e| Error::from_reason(format!("GIF encode task failed: {e}")))??;
		Ok(Uint8Array::from(buffer))
	}

	/// Resize the image to the specified dimensions.
	#[napi(js_name = "resize")]
	pub async fn resize(&self, width: u32, height: u32, filter: SamplingFilter) -> Result<Self> {
		let img = Arc::clone(&self.img);
		let resized = spawn_blocking(move || img.resize_exact(width, height, filter.into()))
			.await
			.map_err(|e| Error::from_reason(format!("Resize task failed: {e}")))?;
		Ok(Self { img: Arc::new(resized) })
	}
}
