//! Per-language chunk classification trait.
//!
//! Languages now provide semantic tables plus a narrow override hook for
//! genuinely custom behavior.

use tree_sitter::Node;

use super::{
	common::{
		ChunkContext, NameStyle, RawChunkCandidate, extract_identifier, is_absorbable_attribute,
		is_trivia_node, make_candidate, named_children, recurse_self, resolve_recurse,
		resolve_value_container, sanitize_node_kind, signature_for_node,
		try_promote_call_with_callback,
	},
	defaults,
	kind::ChunkKind,
	schema,
};
use crate::chunk::types::ChunkNode;

#[derive(Clone, Copy, Debug)]
pub enum RuleStyle {
	Named,
	Group,
	Positional,
}

#[derive(Clone, Copy, Debug)]
pub enum NamingMode {
	AutoIdentifier,
	None,
	SanitizedKind,
}

#[derive(Clone, Copy, Debug)]
pub enum RecurseMode {
	None,
	Auto(ChunkContext),
	SelfNode(ChunkContext),
	ValueContainer,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum WrapperSignature {
	#[default]
	Child,
	Wrapper,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct WrapperTransform {
	pub kind:             Option<ChunkKind>,
	pub name_style:       Option<NameStyle>,
	pub clear_identifier: bool,
	pub signature:        WrapperSignature,
}

#[derive(Clone, Copy, Debug)]
pub struct SemanticRule {
	pub ts_kind:    &'static str,
	pub chunk_kind: ChunkKind,
	pub style:      RuleStyle,
	pub naming:     NamingMode,
	pub recurse:    RecurseMode,
}

pub const fn semantic_rule(
	ts_kind: &'static str,
	chunk_kind: ChunkKind,
	style: RuleStyle,
	naming: NamingMode,
	recurse: RecurseMode,
) -> SemanticRule {
	SemanticRule { ts_kind, chunk_kind, style, naming, recurse }
}

#[derive(Clone, Copy, Debug)]
pub struct StructuralOverrides {
	pub extra_trivia:            &'static [&'static str],
	pub preserved_trivia:        &'static [&'static str],
	pub extra_root_wrappers:     &'static [&'static str],
	pub preserved_root_wrappers: &'static [&'static str],
	pub absorbable_attrs:        &'static [&'static str],
}

impl StructuralOverrides {
	pub const EMPTY: Self = Self {
		extra_trivia:            &[],
		preserved_trivia:        &[],
		extra_root_wrappers:     &[],
		preserved_root_wrappers: &[],
		absorbable_attrs:        &[],
	};

	pub fn is_extra_trivia(&self, kind: &str) -> bool {
		self.extra_trivia.contains(&kind)
	}

	pub fn preserves_trivia(&self, kind: &str) -> bool {
		self.preserved_trivia.contains(&kind)
	}

	pub fn is_extra_root_wrapper(&self, kind: &str) -> bool {
		self.extra_root_wrappers.contains(&kind)
	}

	pub fn preserves_root_wrapper(&self, kind: &str) -> bool {
		self.preserved_root_wrappers.contains(&kind)
	}

	pub fn is_absorbable_attr(&self, kind: &str) -> bool {
		self.absorbable_attrs.contains(&kind)
	}
}

#[derive(Clone, Copy, Debug)]
pub struct ClassifierTables {
	pub root:                 &'static [SemanticRule],
	pub class:                &'static [SemanticRule],
	pub function:             &'static [SemanticRule],
	pub structural_overrides: StructuralOverrides,
}

pub const EMPTY_CLASSIFIER_TABLES: ClassifierTables = ClassifierTables {
	root:                 &[],
	class:                &[],
	function:             &[],
	structural_overrides: StructuralOverrides::EMPTY,
};

pub trait LangClassifier {
	fn tables(&self) -> &'static ClassifierTables {
		&EMPTY_CLASSIFIER_TABLES
	}

	fn classify_root<'t>(&self, _node: Node<'t>, _source: &str) -> Option<RawChunkCandidate<'t>> {
		None
	}

	fn classify_class<'t>(&self, _node: Node<'t>, _source: &str) -> Option<RawChunkCandidate<'t>> {
		None
	}

	fn classify_function<'t>(
		&self,
		_node: Node<'t>,
		_source: &str,
	) -> Option<RawChunkCandidate<'t>> {
		None
	}

	fn is_root_wrapper(&self, _kind: &str) -> bool {
		false
	}

	fn preserve_root_wrapper(&self, _kind: &str) -> bool {
		false
	}

	fn preserve_trivia(&self, _kind: &str) -> bool {
		false
	}

	fn is_trivia(&self, _kind: &str) -> bool {
		false
	}

	fn is_absorbable_attr(&self, _kind: &str) -> bool {
		false
	}

	fn classify_override<'t>(
		&self,
		_context: ChunkContext,
		_node: Node<'t>,
		_source: &str,
	) -> Option<RawChunkCandidate<'t>> {
		None
	}

	fn preserve_children(
		&self,
		_parent: &RawChunkCandidate<'_>,
		_children: &[RawChunkCandidate<'_>],
	) -> bool {
		false
	}

	fn post_process(
		&self,
		_chunks: &mut Vec<ChunkNode>,
		_root_children: &mut Vec<String>,
		_source: &str,
	) {
	}
}

pub fn structural_overrides(classifier: &dyn LangClassifier) -> StructuralOverrides {
	classifier.tables().structural_overrides
}

pub fn classify_with_tables<'tree>(
	classifier: &dyn LangClassifier,
	context: ChunkContext,
	node: Node<'tree>,
	source: &str,
) -> Option<RawChunkCandidate<'tree>> {
	if let Some(candidate) = classifier.classify_override(context, node, source) {
		return Some(candidate);
	}

	find_rule(classifier.tables(), context, node.kind())
		.map(|rule| build_candidate_from_rule(node, source, *rule))
		.or_else(|| match context {
			ChunkContext::Root => classifier.classify_root(node, source),
			ChunkContext::ClassBody => classifier.classify_class(node, source),
			ChunkContext::FunctionBody => classifier.classify_function(node, source),
		})
}

pub fn classify_with_defaults<'tree>(
	classifier: &dyn LangClassifier,
	context: ChunkContext,
	node: Node<'tree>,
	source: &str,
) -> RawChunkCandidate<'tree> {
	if node.is_error() || node.kind() == "ERROR" {
		return make_candidate(node, ChunkKind::Error, None, NameStyle::Error, None, None, source);
	}

	let candidate = match context {
		ChunkContext::Root => classify_with_tables(classifier, context, node, source)
			.unwrap_or_else(|| defaults::classify_root_default(node, source)),
		ChunkContext::ClassBody => classify_with_tables(classifier, context, node, source)
			.unwrap_or_else(|| defaults::classify_class_default(node, source)),
		ChunkContext::FunctionBody => classify_with_tables(classifier, context, node, source)
			.unwrap_or_else(|| defaults::classify_function_default(node, source)),
	};

	// If the classifier produced a groupable leaf (no recurse), try to
	// promote call-with-trailing-callback patterns into named container
	// chunks. This handles `describe(...)`, `t.Run(...)`, etc. across
	// all languages without per-language opt-in.
	if candidate.recurse.is_none()
		&& candidate.groupable
		&& let Some(promoted) = try_promote_call_with_callback(node, source)
	{
		return promoted;
	}

	candidate
}

pub fn first_wrapper_content_child<'tree>(
	classifier: &dyn LangClassifier,
	node: Node<'tree>,
) -> Option<Node<'tree>> {
	if let Some(child) = schema_wrapper_child(node) {
		return Some(child);
	}

	let overrides = structural_overrides(classifier);
	named_children(node)
		.into_iter()
		.find(|child| !is_wrapper_metadata_child(*child, classifier, overrides))
}

pub fn promote_wrapper_candidate<'tree>(
	classifier: &dyn LangClassifier,
	context: ChunkContext,
	node: Node<'tree>,
	source: &str,
	transform: WrapperTransform,
) -> Option<RawChunkCandidate<'tree>> {
	let (child, candidate) = promotable_wrapper_child(classifier, context, node, source)?;
	let signature_node = match transform.signature {
		WrapperSignature::Child => child,
		WrapperSignature::Wrapper => node,
	};
	let kind = transform.kind.unwrap_or(candidate.kind);
	let name_style = transform.name_style.unwrap_or(candidate.name_style);
	let identifier = if transform.clear_identifier {
		None
	} else {
		candidate.identifier
	};

	Some(make_candidate(
		node,
		kind,
		identifier,
		name_style,
		signature_for_node(signature_node, source),
		candidate.recurse,
		source,
	))
}

pub fn build_candidate_from_rule<'tree>(
	node: Node<'tree>,
	source: &str,
	rule: SemanticRule,
) -> RawChunkCandidate<'tree> {
	let identifier = match rule.naming {
		NamingMode::AutoIdentifier => extract_identifier(node, source),
		NamingMode::None => None,
		NamingMode::SanitizedKind => Some(sanitize_node_kind(node.kind()).to_string()),
	};

	let recurse = match rule.recurse {
		RecurseMode::None => None,
		RecurseMode::Auto(context) => resolve_recurse(node, context),
		RecurseMode::SelfNode(context) => Some(recurse_self(node, context)),
		RecurseMode::ValueContainer => resolve_value_container(node),
	};

	match rule.style {
		RuleStyle::Named => make_candidate(
			node,
			rule.chunk_kind,
			identifier,
			NameStyle::Named,
			signature_for_node(node, source),
			recurse,
			source,
		),
		RuleStyle::Group => {
			make_candidate(node, rule.chunk_kind, identifier, NameStyle::Group, None, recurse, source)
		},
		RuleStyle::Positional => make_candidate(
			node,
			rule.chunk_kind,
			None::<String>,
			NameStyle::Named,
			None,
			recurse,
			source,
		),
	}
}

fn find_rule(
	tables: &ClassifierTables,
	context: ChunkContext,
	kind: &str,
) -> Option<&'static SemanticRule> {
	let rules = match context {
		ChunkContext::Root => tables.root,
		ChunkContext::ClassBody => tables.class,
		ChunkContext::FunctionBody => tables.function,
	};

	rules.iter().find(|rule| rule.ts_kind == kind)
}

fn promotable_wrapper_child<'tree>(
	classifier: &dyn LangClassifier,
	context: ChunkContext,
	node: Node<'tree>,
	source: &str,
) -> Option<(Node<'tree>, RawChunkCandidate<'tree>)> {
	if let Some(child) = schema_wrapper_child(node) {
		let candidate = classify_with_defaults(classifier, context, child, source);
		if is_promotable_wrapper_candidate(child, &candidate) {
			return Some((child, candidate));
		}
	}

	let overrides = structural_overrides(classifier);
	let mut promoted = named_children(node).into_iter().filter_map(|child| {
		if is_wrapper_metadata_child(child, classifier, overrides) {
			return None;
		}

		let candidate = classify_with_defaults(classifier, context, child, source);
		is_promotable_wrapper_candidate(child, &candidate).then_some((child, candidate))
	});

	let promoted_child = promoted.next()?;
	if promoted.next().is_some() {
		return None;
	}
	Some(promoted_child)
}

fn is_wrapper_metadata_child(
	node: Node<'_>,
	classifier: &dyn LangClassifier,
	overrides: StructuralOverrides,
) -> bool {
	let kind = node.kind();
	((is_trivia_node(node) || classifier.is_trivia(kind))
		&& !overrides.preserves_trivia(kind)
		&& !classifier.preserve_trivia(kind))
		|| (overrides.is_extra_trivia(kind)
			&& !overrides.preserves_trivia(kind)
			&& !classifier.preserve_trivia(kind))
		|| is_absorbable_attribute(kind)
		|| overrides.is_absorbable_attr(kind)
		|| classifier.is_absorbable_attr(kind)
}

fn is_promotable_wrapper_candidate(node: Node<'_>, candidate: &RawChunkCandidate<'_>) -> bool {
	if matches!(candidate.kind, ChunkKind::Error | ChunkKind::Chunk | ChunkKind::Statements) {
		return false;
	}

	candidate.identifier.is_some()
		|| candidate.recurse.is_some()
		|| candidate.kind.traits().container
		|| node.kind().ends_with("_definition")
		|| node.kind().ends_with("_declaration")
}

fn schema_wrapper_child(node: Node<'_>) -> Option<Node<'_>> {
	let schema = schema::schema_for_current(node.kind())?;
	for field in &schema.promotion_fields {
		if let Some(child) = node.child_by_field_name(field) {
			return Some(child);
		}
	}
	None
}

/// Resolve a [`LangClassifier`] for the given language.
pub fn classifier_for(lang: &str) -> &'static dyn LangClassifier {
	match lang {
		"astro" => &super::ast_astro::AstroClassifier,
		// JS / TS family
		"javascript" | "js" | "jsx" | "typescript" | "ts" | "tsx" => {
			&super::ast_js_ts::JsTsClassifier
		},
		// Python / Starlark
		"python" | "starlark" => &super::ast_python::PythonClassifier,
		// Rust
		"rust" => &super::ast_rust::RustClassifier,
		// Go
		"go" | "golang" => &super::ast_go::GoClassifier,
		// C / C++ / Objective-C
		"c" | "cpp" | "c++" | "objc" | "objective-c" => &super::ast_c_cpp_objc::CCppClassifier,
		// C# / Java
		"csharp" | "java" => &super::ast_csharp_java::CSharpJavaClassifier,
		// Clojure
		"clojure" => &super::ast_clojure::ClojureClassifier,
		// CMake
		"cmake" => &super::ast_cmake::CMakeClassifier,
		// CSS
		"css" => &super::ast_css::CssClassifier,
		// Data formats
		"json" | "toml" | "yaml" => &super::ast_data_formats::DataFormatsClassifier,
		// Dockerfile
		"dockerfile" => &super::ast_dockerfile::DockerfileClassifier,
		// Elixir
		"elixir" => &super::ast_elixir::ElixirClassifier,
		// Erlang
		"erlang" => &super::ast_erlang::ErlangClassifier,
		// GraphQL
		"graphql" => &super::ast_graphql::GraphqlClassifier,
		// Haskell / Scala
		"haskell" | "scala" => &super::ast_haskell_scala::HaskellScalaClassifier,
		// HTML / XML
		"html" | "xml" => &super::ast_html_xml::HtmlXmlClassifier,
		// INI
		"ini" => &super::ast_ini::IniClassifier,
		// Just
		"just" => &super::ast_just::JustClassifier,
		// Markdown / Handlebars
		"markdown" | "handlebars" => &super::ast_markup::MarkupClassifier,
		// Nix / HCL
		"nix" | "hcl" => &super::ast_nix_hcl::NixHclClassifier,
		// OCaml
		"ocaml" => &super::ast_ocaml::OcamlClassifier,
		// Perl
		"perl" => &super::ast_perl::PerlClassifier,
		// PowerShell
		"powershell" => &super::ast_powershell::PowershellClassifier,
		// Protobuf
		"protobuf" | "proto" => &super::ast_proto::ProtoClassifier,
		// R
		"r" => &super::ast_r::RClassifier,
		// Ruby / Lua
		"ruby" | "lua" => &super::ast_ruby_lua::RubyLuaClassifier,
		// SQL
		"sql" => &super::ast_sql::SqlClassifier,
		// Svelte
		"svelte" => &super::ast_svelte::SvelteClassifier,
		// TLA+ / PlusCal
		"tlaplus" | "pluscal" | "pcal" | "tla" | "tla+" => &super::ast_tlaplus::TlaplusClassifier,
		// Bash / Make / Diff
		"bash" | "make" | "diff" => &super::ast_bash_make_diff::ShellBuildClassifier,
		// Vue
		"vue" => &super::ast_vue::VueClassifier,
		// Everything else (Kotlin, Swift, PHP, Solidity, etc.)
		_ => &super::ast_misc::MiscClassifier,
	}
}
