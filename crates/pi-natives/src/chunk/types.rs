//! Shared types for the chunk-tree system.

use napi_derive::napi;

#[derive(Clone)]
#[napi(object)]
pub struct ChunkNode {
	pub path:        String,
	pub name:        String,
	pub kind:        String,
	#[napi(js_name = "parentPath")]
	pub parent_path: Option<String>,
	pub children:    Vec<String>,
	pub signature:   Option<String>,
	#[napi(js_name = "startLine")]
	pub start_line:  u32,
	#[napi(js_name = "endLine")]
	pub end_line:    u32,
	#[napi(js_name = "lineCount")]
	pub line_count:  u32,
	#[napi(js_name = "startByte")]
	pub start_byte:  u32,
	#[napi(js_name = "endByte")]
	pub end_byte:    u32,
	pub checksum:    String,
	pub error:       bool,
	pub indent:      u32,
	#[napi(js_name = "indentChar")]
	pub indent_char: String,
}

#[derive(Clone)]
#[napi(object)]
pub struct ChunkTree {
	pub language:      String,
	pub checksum:      String,
	#[napi(js_name = "lineCount")]
	pub line_count:    u32,
	#[napi(js_name = "parseErrors")]
	pub parse_errors:  u32,
	pub fallback:      bool,
	#[napi(js_name = "rootPath")]
	pub root_path:     String,
	#[napi(js_name = "rootChildren")]
	pub root_children: Vec<String>,
	pub chunks:        Vec<ChunkNode>,
}

#[derive(Clone)]
#[napi(object)]
pub struct VisibleLineRange {
	#[napi(js_name = "startLine")]
	pub start_line: u32,
	#[napi(js_name = "endLine")]
	pub end_line:   u32,
}

#[derive(Clone)]
#[napi(object)]
pub struct RenderChunkTreeParams {
	pub tree:                 ChunkTree,
	#[napi(js_name = "chunkPath")]
	pub chunk_path:           Option<String>,
	pub source:               String,
	pub title:                String,
	#[napi(js_name = "languageTag")]
	pub language_tag:         Option<String>,
	pub checksum:             String,
	#[napi(js_name = "visibleRange")]
	pub visible_range:        Option<VisibleLineRange>,
	#[napi(js_name = "renderChildrenOnly")]
	pub render_children_only: bool,
	#[napi(js_name = "omitChecksum")]
	pub omit_checksum:        bool,
	#[napi(js_name = "anchorStyle")]
	pub anchor_style:         Option<String>,
	#[napi(js_name = "showLeafPreview")]
	pub show_leaf_preview:    bool,
	#[napi(js_name = "tabReplacement")]
	pub tab_replacement:      Option<String>,
}
