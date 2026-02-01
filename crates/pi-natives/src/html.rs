//! HTML to Markdown conversion.

use html_to_markdown_rs::{ConversionOptions, PreprocessingOptions, PreprocessingPreset, convert};
use napi::bindgen_prelude::*;
use napi_derive::napi;

use crate::work::launch_blocking;

/// Options for HTML to Markdown conversion.
#[napi(object)]
#[derive(Debug, Default)]
pub struct HtmlToMarkdownOptions {
	/// Remove navigation elements, forms, headers, footers.
	#[napi(js_name = "cleanContent")]
	pub clean_content: Option<bool>,
	/// Skip images during conversion.
	#[napi(js_name = "skipImages")]
	pub skip_images:   Option<bool>,
}

/// Convert HTML source to Markdown with optional preprocessing.
///
/// # Errors
/// Returns an error if the conversion fails or the worker task aborts.
#[napi(js_name = "htmlToMarkdown")]
pub async fn html_to_markdown(
	html: String,
	options: Option<HtmlToMarkdownOptions>,
) -> Result<String> {
	let options = options.unwrap_or_default();
	let clean_content = options.clean_content.unwrap_or(false);
	let skip_images = options.skip_images.unwrap_or(false);

	launch_blocking("html_to_markdown", move || {
		let conversion_opts = ConversionOptions {
			skip_images,
			preprocessing: PreprocessingOptions {
				enabled:           clean_content,
				preset:            PreprocessingPreset::Aggressive,
				remove_navigation: true,
				remove_forms:      true,
			},
			..Default::default()
		};

		convert(html.as_str(), Some(conversion_opts))
			.map_err(|err| Error::from_reason(format!("Conversion error: {err}")))
	})
	.wait()
	.await
}
