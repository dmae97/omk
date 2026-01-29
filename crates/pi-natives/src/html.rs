//! HTML to Markdown conversion.

use html_to_markdown_rs::{convert, ConversionOptions, PreprocessingOptions, PreprocessingPreset};
use serde::Deserialize;
use wasm_bindgen::prelude::*;

/// Options for HTML to Markdown conversion.
#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct HtmlToMarkdownOptions {
	/// Remove navigation elements, forms, headers, footers.
	#[serde(default)]
	pub clean_content: bool,
	/// Skip images during conversion.
	#[serde(default)]
	pub skip_images: bool,
}

/// Convert HTML to Markdown.
#[wasm_bindgen]
pub fn html_to_markdown(html: &str, options: JsValue) -> Result<String, JsValue> {
	let opts: HtmlToMarkdownOptions = if options.is_undefined() || options.is_null() {
		HtmlToMarkdownOptions::default()
	} else {
		serde_wasm_bindgen::from_value(options)
			.map_err(|e| JsValue::from_str(&format!("Invalid options: {e}")))?
	};

	let conversion_opts = ConversionOptions {
		skip_images: opts.skip_images,
		preprocessing: PreprocessingOptions {
			enabled: opts.clean_content,
			preset: PreprocessingPreset::Aggressive,
			remove_navigation: true,
			remove_forms: true,
		},
		..Default::default()
	};

	convert(html, Some(conversion_opts)).map_err(|e| JsValue::from_str(&format!("Conversion error: {e}")))
}
