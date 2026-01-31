//! HTML to Markdown conversion.

use html_to_markdown_rs::{convert, ConversionOptions, PreprocessingOptions, PreprocessingPreset};
use napi::bindgen_prelude::*;
use napi_derive::napi;

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

/// Convert HTML to Markdown.
#[napi(js_name = "html_to_markdown")]
pub fn html_to_markdown(html: String, options: Option<HtmlToMarkdownOptions>) -> Result<String> {
	let options = options.unwrap_or_default();
	let conversion_opts = ConversionOptions {
		skip_images: options.skip_images.unwrap_or(false),
		preprocessing: PreprocessingOptions {
			enabled:           options.clean_content.unwrap_or(false),
			preset:            PreprocessingPreset::Aggressive,
			remove_navigation: true,
			remove_forms:      true,
		},
		..Default::default()
	};

	convert(&html, Some(conversion_opts))
		.map_err(|err| Error::from_reason(format!("Conversion error: {err}")))
}
