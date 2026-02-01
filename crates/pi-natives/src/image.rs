//! Minimal image processing API for resizing and format conversion.
//!
//! Provides only the subset of functionality needed:
//! - Load image from bytes (PNG, JPEG, WebP, GIF)
//! - Get dimensions
//! - Resize with configurable filter
//! - Export as PNG, JPEG, WebP, or GIF

use std::{io::Cursor, sync::Arc};

use image::{
	DynamicImage, ImageFormat, ImageReader,
	codecs::{jpeg::JpegEncoder, webp::WebPEncoder},
	imageops::FilterType,
};
use napi::bindgen_prelude::*;
use napi_derive::napi;

use crate::work::launch_blocking;

/// Sampling filter for resize operations.
#[napi]
pub enum SamplingFilter {
	/// Nearest-neighbor sampling (fast, low quality).
	Nearest    = 1,
	/// Triangle filter (linear interpolation).
	Triangle   = 2,
	/// Catmull-Rom filter with sharper edges.
	CatmullRom = 3,
	/// Gaussian filter for smoother results.
	Gaussian   = 4,
	/// Lanczos3 filter for high-quality downscaling.
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
	/// Shared decoded image data.
	img: Arc<DynamicImage>,
}

#[napi]
impl PhotonImage {
	/// Create a new `PhotonImage` from encoded image bytes (PNG, JPEG, WebP,
	/// GIF). Returns the decoded image handle on success.
	///
	/// # Errors
	/// Returns an error if the image format cannot be detected or decoded.
	#[napi(factory, js_name = "parse")]
	pub async fn parse(bytes: Uint8Array) -> Result<Self> {
		let bytes = bytes.as_ref().to_vec();
		let img = launch_blocking("image.decode", move || -> Result<DynamicImage> {
			let reader = ImageReader::new(Cursor::new(bytes))
				.with_guessed_format()
				.map_err(|e| Error::from_reason(format!("Failed to detect image format: {e}")))?;

			let img = reader
				.decode()
				.map_err(|e| Error::from_reason(format!("Failed to decode image: {e}")))?;

			Ok(img)
		})
		.wait()
		.await?;

		Ok(Self { img: Arc::new(img) })
	}

	/// Get the image width in pixels.
	#[napi(getter, js_name = "width")]
	pub fn get_width(&self) -> u32 {
		self.img.width()
	}

	/// Get the image height in pixels.
	#[napi(getter, js_name = "height")]
	pub fn get_height(&self) -> u32 {
		self.img.height()
	}

	/// Encode the image to bytes in the specified format.
	///
	/// Format values (matching `ImageFormat` enum in TS):
	/// - 0: PNG (quality ignored)
	/// - 1: JPEG (quality 0-100)
	/// - 2: WebP (lossless, quality ignored)
	/// - 3: GIF (quality ignored)
	///
	/// # Errors
	/// Returns an error if encoding fails or format is invalid.
	#[napi(js_name = "encode")]
	pub async fn encode(&self, format: u8, quality: u8) -> Result<Uint8Array> {
		let img = Arc::clone(&self.img);
		let buffer: Vec<u8> =
			launch_blocking("image.encode", move || encode_image(&img, format, quality))
				.wait()
				.await?;
		Ok(Uint8Array::from(buffer))
	}

	/// Resize the image to the specified pixel dimensions using the filter.
	/// Returns a new `PhotonImage` containing the resized image.
	#[napi(js_name = "resize")]
	pub async fn resize(&self, width: u32, height: u32, filter: SamplingFilter) -> Result<Self> {
		let img = Arc::clone(&self.img);
		let resized = launch_blocking("image.resize", move || {
			Ok(img.resize_exact(width, height, filter.into()))
		})
		.wait()
		.await?;
		Ok(Self { img: Arc::new(resized) })
	}
}

fn encode_image(img: &DynamicImage, format: u8, quality: u8) -> Result<Vec<u8>> {
	let (w, h) = (img.width(), img.height());

	match format {
		0 => {
			let mut buffer = Vec::with_capacity((w * h * 4) as usize);
			img.write_to(&mut Cursor::new(&mut buffer), ImageFormat::Png)
				.map_err(|e| Error::from_reason(format!("Failed to encode PNG: {e}")))?;
			Ok(buffer)
		},
		1 => {
			let mut buffer = Vec::with_capacity((w * h * 3) as usize);
			let encoder = JpegEncoder::new_with_quality(&mut buffer, quality);
			img.write_with_encoder(encoder)
				.map_err(|e| Error::from_reason(format!("Failed to encode JPEG: {e}")))?;
			Ok(buffer)
		},
		2 => {
			let mut buffer = Vec::with_capacity((w * h * 4) as usize);
			let encoder = WebPEncoder::new_lossless(&mut buffer);
			img.write_with_encoder(encoder)
				.map_err(|e| Error::from_reason(format!("Failed to encode WebP: {e}")))?;
			Ok(buffer)
		},
		3 => {
			let mut buffer = Vec::with_capacity((w * h) as usize);
			img.write_to(&mut Cursor::new(&mut buffer), ImageFormat::Gif)
				.map_err(|e| Error::from_reason(format!("Failed to encode GIF: {e}")))?;
			Ok(buffer)
		},
		_ => Err(Error::from_reason(format!("Invalid image format: {format}"))),
	}
}
