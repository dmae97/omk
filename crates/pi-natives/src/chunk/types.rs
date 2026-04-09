//! Shared types for the chunk-tree system.

use napi_derive::napi;

use crate::chunk::{kind::ChunkKind, state::ChunkState};

#[derive(Clone)]
pub struct ChunkNode {
	pub path:                String,
	pub identifier:          Option<String>,
	pub kind:                ChunkKind,
	pub leaf:                bool,
	pub parent_path:         Option<String>,
	pub children:            Vec<String>,
	pub signature:           Option<String>,
	pub start_line:          u32,
	pub end_line:            u32,
	pub line_count:          u32,
	pub start_byte:          u32,
	pub end_byte:            u32,
	/// Start byte of the semantic declaration used for checksums. This can be
	/// later than `start_byte` when the chunk absorbs attached leading trivia
	/// such as doc comments or attributes.
	pub checksum_start_byte: u32,

	/// End byte of the prologue region. `None` means the chunk does not expose
	/// regions.
	pub prologue_end_byte:   Option<u32>,
	/// Start byte of the epilogue region. `None` means the chunk does not expose
	/// regions.
	pub epilogue_start_byte: Option<u32>,

	pub checksum:    String,
	pub error:       bool,
	pub indent:      u32,
	pub indent_char: String,
	/// True for group-candidate chunks (e.g. `stmts`, `imports`, `decls`) that
	/// represent an ordered list of similar items. Append/prepend is valid on
	/// these even when they are leaf nodes.
	pub group:       bool,
}

#[derive(Clone)]
pub struct ChunkTree {
	pub language:      String,
	pub checksum:      String,
	pub line_count:    u32,
	pub parse_errors:  u32,
	pub fallback:      bool,
	pub root_path:     String,
	pub root_children: Vec<String>,
	pub chunks:        Vec<ChunkNode>,
}

/// Summary of a single chunk node for tool output and navigation.
#[derive(Clone)]
#[napi(object)]
pub struct ChunkInfo {
	/// Chunk selector path within the tree.
	pub path:       String,
	/// Bare chunk identifier (without kind prefix), if available.
	pub identifier: Option<String>,
	/// Stable checksum anchor for this chunk.
	pub checksum:   String,
	/// 1-based start line in the source file (inclusive).
	pub start_line: u32,
	/// 1-based end line in the source file (inclusive).
	pub end_line:   u32,
	/// Whether this node is a leaf (no child chunks).
	pub leaf:       bool,
}

/// Result of resolving a chunk read request against the tree.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[napi(string_enum)]
pub enum ChunkReadStatus {
	/// Selector matched a chunk and content was produced.
	#[napi(value = "ok")]
	Ok,
	/// No chunk matched the requested selector.
	#[napi(value = "not_found")]
	NotFound,
	/// Chunk matched but does not support the requested region.
	#[napi(value = "unsupported_region")]
	UnsupportedRegion,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[napi(string_enum)]
pub enum ChunkRegion {
	#[napi(value = "head")]
	Head,
	#[napi(value = "body")]
	Body,
	#[napi(value = "tail")]
	Tail,
	/// The semantic declaration without leading trivia (comments, attributes).
	/// Spans from `checksum_start_byte` to `end_byte`.
	#[napi(value = "decl")]
	Decl,
}

impl ChunkRegion {
	pub const fn as_str(self) -> &'static str {
		match self {
			Self::Head => "head",
			Self::Body => "body",
			Self::Tail => "tail",
			Self::Decl => "decl",
		}
	}
}

/// Structural edit to apply relative to a chunk anchor.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[napi(string_enum)]
pub enum ChunkEditOp {
	/// Replace the targeted region, or a substring via `find`.
	#[napi(value = "replace")]
	Replace,
	/// Remove the targeted region.
	#[napi(value = "delete")]
	Delete,
	/// Insert `content` before the targeted region span.
	#[napi(value = "before")]
	Before,
	/// Insert `content` after the targeted region span.
	#[napi(value = "after")]
	After,
	/// Insert `content` at the start inside the targeted region.
	#[napi(value = "prepend")]
	Prepend,
	/// Insert `content` at the end inside the targeted region.
	#[napi(value = "append")]
	Append,
}

impl ChunkEditOp {
	pub const fn as_str(self) -> &'static str {
		match self {
			Self::Replace => "replace",
			Self::Delete => "delete",
			Self::Before => "before",
			Self::After => "after",
			Self::Prepend => "prepend",
			Self::Append => "append",
		}
	}
}

/// Outcome of resolving which chunk was read for a `renderRead`-style request.
#[derive(Clone)]
#[napi(object)]
pub struct ChunkReadTarget {
	/// Whether the selector matched.
	pub status:   ChunkReadStatus,
	/// Sanitized selector string that was applied.
	pub selector: String,
}

/// Inclusive 1-based line range within a source file (used for scoped chunk
/// rendering).
#[derive(Clone)]
#[napi(object)]
pub struct VisibleLineRange {
	/// First line to include.
	pub start_line: u32,
	/// Last line to include.
	pub end_line:   u32,
}

/// How chunk anchors are formatted in rendered output (name and checksum
/// visibility).
#[derive(Clone, Copy, Default)]
#[napi(string_enum)]
pub enum ChunkAnchorStyle {
	/// `[.name#crc]` style anchor.
	#[default]
	#[napi(value = "full")]
	Full,
	/// `[.kind#crc]` style anchor (kind is the name prefix before `_`).
	#[napi(value = "kind")]
	Kind,
	/// `[#crc]` style anchor.
	#[napi(value = "bare")]
	Bare,
	/// `[.name]` without checksum.
	#[napi(value = "full-omit")]
	FullOmit,
	/// `[.kind]` without checksum.
	#[napi(value = "kind-omit")]
	KindOmit,
	/// Minimal anchor without name or checksum.
	#[napi(value = "none")]
	None,
}

impl ChunkAnchorStyle {
	pub const fn with_omit_checksum(self, omit: bool) -> Self {
		if !omit {
			return self;
		}
		match self {
			Self::Full => Self::FullOmit,
			Self::Kind => Self::KindOmit,
			Self::Bare => Self::None,
			Self::FullOmit => Self::FullOmit,
			Self::KindOmit => Self::KindOmit,
			Self::None => Self::None,
		}
	}

	fn render_i(&self, marker: (&str, &str), indent: &str, name: &str, crc: &str) -> String {
		fn extract_kind(name: &str) -> &str {
			name.find('_').map_or_else(|| name, |index| &name[..index])
		}
		let (open, close) = marker;
		match self {
			Self::Full => format!("{indent}{open}{name}#{crc}{close}"),
			Self::Kind => {
				format!("{indent}{open}{kind}#{crc}{close}", kind = extract_kind(name))
			},
			Self::Bare => format!("{indent}{open}#{crc}{close}"),
			Self::FullOmit => format!("{indent}{open}{name}{close}"),
			Self::KindOmit => format!("{indent}{open}{kind}{close}", kind = extract_kind(name)),
			Self::None => String::new(),
		}
	}

	/// Render an opening anchor tag: `[< name#crc ]`.
	/// Returns empty string for `None` style.
	pub fn render(&self, indent: &str, name: &str, crc: &str) -> String {
		self.render_i(("[<", ">]"), indent, name, crc)
	}

	/// Render a closing anchor tag: `[</ name#crc ]`.
	/// Returns empty string for `None` style.
	pub fn render_close(&self, indent: &str, name: &str, crc: &str) -> String {
		self.render_i(("[</", ">]"), indent, name, crc)
	}
}

/// How a chunk participates in a focus-scoped render pass.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[napi(string_enum)]
pub enum ChunkFocusMode {
	/// Emit full content and recurse normally.
	#[napi(value = "expanded")]
	Expanded,
	/// Emit just the opening anchor; do not recurse or emit body.
	#[napi(value = "collapsed")]
	Collapsed,
	/// Emit opening + closing anchors; recurse into focused children only.
	/// Interior gap lines between children are suppressed.
	#[napi(value = "container")]
	Container,
}

/// Path + focus mode pair for the N-API boundary (`HashMap` doesn't cross FFI).
#[derive(Clone, Debug)]
#[napi(object)]
pub struct FocusedPath {
	pub path: String,
	pub mode: ChunkFocusMode,
}

/// Options for `ChunkState.render`: which subtree to show and how anchors
/// appear.
#[derive(Clone)]
#[napi(object)]
pub struct RenderParams {
	/// Path of the chunk to render; `None` uses the tree root.
	pub chunk_path:           Option<String>,
	/// Title line shown above the tree (often the file path).
	pub title:                String,
	/// Optional language label for the header block.
	pub language_tag:         Option<String>,
	/// Restrict output to an inclusive line range of the file.
	pub visible_range:        Option<VisibleLineRange>,
	/// When true, list only direct children instead of a full subtree.
	pub render_children_only: bool,
	/// Hide checksums in anchors when true.
	pub omit_checksum:        bool,
	/// Anchor formatting style for chunk headers.
	pub anchor_style:         Option<ChunkAnchorStyle>,
	/// Include a one-line preview for leaf chunks.
	pub show_leaf_preview:    bool,
	/// Replace tab characters in displayed previews (e.g. two spaces).
	pub tab_replacement:      Option<String>,
	/// When true, normalize displayed indentation to canonical tabs.
	pub normalize_indent:     Option<bool>,

	/// When set, restrict rendering to these chunks with their specified focus
	/// modes. Everything not in this list is skipped.
	pub focused_paths: Option<Vec<FocusedPath>>,
}

/// Options for `ChunkState.renderRead`: selector path, display path, and
/// optional line scoping.
#[derive(Clone)]
#[napi(object)]
pub struct ReadRenderParams {
	/// Read selector (`sel=...` path, line range, or empty for whole tree).
	pub read_path:           String,
	/// Path shown in titles and error messages (often the file path).
	pub display_path:        String,
	/// Optional language label for the rendered block.
	pub language_tag:        Option<String>,
	/// Hide checksums in rendered anchors.
	pub omit_checksum:       bool,
	/// Anchor formatting style.
	pub anchor_style:        Option<ChunkAnchorStyle>,
	/// Optional absolute file line range to intersect with the resolved chunk.
	pub absolute_line_range: Option<VisibleLineRange>,
	/// Replace tabs in embedded previews.
	pub tab_replacement:     Option<String>,
	/// When true, normalize displayed indentation to canonical tabs.
	pub normalize_indent:    Option<bool>,
}

/// Rendered chunk text plus optional resolution metadata for the read request.
#[derive(Clone)]
#[napi(object)]
pub struct ReadResult {
	/// Rendered UTF-8 text (chunk tree, notice, or error message).
	pub text:  String,
	/// When a selector was used, whether it matched and which selector applied.
	pub chunk: Option<ChunkReadTarget>,
}

/// One edit in a batch; targets a chunk via `sel`/`crc` (with params-level
/// defaults).
#[derive(Clone)]
#[napi(object)]
pub struct EditOperation {
	/// Edit kind (replace, delete, insert relative to anchor).
	pub op:      ChunkEditOp,
	/// Chunk selector path; falls back to `EditParams.defaultSelector` when
	/// omitted.
	pub sel:     Option<String>,
	/// Optional checksum anchor; falls back to `EditParams.defaultCrc` when
	/// omitted.
	pub crc:     Option<String>,
	/// Region to target. When omitted, targets the full chunk.
	pub region:  Option<ChunkRegion>,
	/// Replacement or inserted text (meaning depends on `op`).
	pub content: Option<String>,
	/// For scoped find/replace: literal substring to locate inside the target
	/// chunk. Must match exactly once. Pairs with `content` as the replacement.
	pub find:    Option<String>,
}

/// Arguments for applying a batch of chunk edits to a file.
#[derive(Clone)]
#[napi(object)]
pub struct EditParams {
	/// Edits to apply in order.
	pub operations:       Vec<EditOperation>,
	/// Default chunk selector when an `EditOperation` omits `sel`.
	pub default_selector: Option<String>,
	/// Default checksum when an `EditOperation` omits `crc`.
	pub default_crc:      Option<String>,
	/// Anchor formatting for rendered response text.
	pub anchor_style:     Option<ChunkAnchorStyle>,
	/// Working directory used to resolve `filePath` and display paths.
	pub cwd:              String,
	/// Path to the source file to edit (often relative to `cwd`).
	pub file_path:        String,
}

/// Result of applying edits: new parse state plus before/after source and
/// messaging.
#[derive(Clone)]
#[napi(object, object_from_js = false)]
pub struct EditResult {
	/// Chunk tree state after applying edits and re-parsing.
	pub state:         ChunkState,
	/// Full file text before edits.
	pub diff_before:   String,
	/// Full file text after edits.
	pub diff_after:    String,
	/// Rendered summary for tooling (hunks, anchors), driven by `anchorStyle`.
	pub response_text: String,
	/// Whether the on-disk source changed.
	pub changed:       bool,
	/// Whether the updated source re-parsed without fatal issues.
	pub parse_valid:   bool,
	/// Absolute or normalized paths that were written or touched.
	pub touched_paths: Vec<String>,
	/// Non-fatal issues (e.g. selector warnings) collected during apply.
	pub warnings:      Vec<String>,
}
