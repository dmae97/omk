//! JavaScript / TypeScript / TSX chunk classifier.

use tree_sitter::Node;

use super::{
	classify::{
		ClassifierTables, LangClassifier, NamingMode, RecurseMode, RuleStyle, WrapperSignature,
		WrapperTransform, classify_with_defaults, first_wrapper_content_child,
		promote_wrapper_candidate, semantic_rule,
	},
	common::*,
	kind::ChunkKind,
};

pub struct JsTsClassifier;

fn recurse_internal_module(node: Node<'_>) -> Option<RecurseSpec<'_>> {
	recurse_into(node, ChunkContext::ClassBody, &["body"], &["statement_block"])
}

static JSTS_TABLES: ClassifierTables = ClassifierTables {
	root:                 &[
		semantic_rule(
			"import_statement",
			ChunkKind::Imports,
			RuleStyle::Group,
			NamingMode::None,
			RecurseMode::None,
		),
		semantic_rule(
			"import_declaration",
			ChunkKind::Imports,
			RuleStyle::Group,
			NamingMode::None,
			RecurseMode::None,
		),
		semantic_rule(
			"function_declaration",
			ChunkKind::Function,
			RuleStyle::Named,
			NamingMode::AutoIdentifier,
			RecurseMode::Auto(ChunkContext::FunctionBody),
		),
		semantic_rule(
			"function",
			ChunkKind::Function,
			RuleStyle::Named,
			NamingMode::AutoIdentifier,
			RecurseMode::Auto(ChunkContext::FunctionBody),
		),
		semantic_rule(
			"function_expression",
			ChunkKind::Function,
			RuleStyle::Named,
			NamingMode::AutoIdentifier,
			RecurseMode::Auto(ChunkContext::FunctionBody),
		),
		semantic_rule(
			"arrow_function",
			ChunkKind::Function,
			RuleStyle::Named,
			NamingMode::AutoIdentifier,
			RecurseMode::Auto(ChunkContext::FunctionBody),
		),
		semantic_rule(
			"generator_function",
			ChunkKind::Function,
			RuleStyle::Named,
			NamingMode::AutoIdentifier,
			RecurseMode::Auto(ChunkContext::FunctionBody),
		),
		semantic_rule(
			"generator_function_declaration",
			ChunkKind::Function,
			RuleStyle::Named,
			NamingMode::AutoIdentifier,
			RecurseMode::Auto(ChunkContext::FunctionBody),
		),
		semantic_rule(
			"class_declaration",
			ChunkKind::Class,
			RuleStyle::Named,
			NamingMode::AutoIdentifier,
			RecurseMode::Auto(ChunkContext::ClassBody),
		),
		semantic_rule(
			"class",
			ChunkKind::Class,
			RuleStyle::Named,
			NamingMode::AutoIdentifier,
			RecurseMode::Auto(ChunkContext::ClassBody),
		),
		semantic_rule(
			"class_expression",
			ChunkKind::Class,
			RuleStyle::Named,
			NamingMode::AutoIdentifier,
			RecurseMode::Auto(ChunkContext::ClassBody),
		),
		semantic_rule(
			"interface_declaration",
			ChunkKind::Interface,
			RuleStyle::Named,
			NamingMode::AutoIdentifier,
			RecurseMode::Auto(ChunkContext::ClassBody),
		),
		semantic_rule(
			"enum_declaration",
			ChunkKind::Enum,
			RuleStyle::Named,
			NamingMode::AutoIdentifier,
			RecurseMode::Auto(ChunkContext::ClassBody),
		),
		semantic_rule(
			"type_alias_declaration",
			ChunkKind::Type,
			RuleStyle::Named,
			NamingMode::AutoIdentifier,
			RecurseMode::None,
		),
	],
	class:                &[
		semantic_rule(
			"constructor",
			ChunkKind::Constructor,
			RuleStyle::Named,
			NamingMode::None,
			RecurseMode::Auto(ChunkContext::FunctionBody),
		),
		semantic_rule(
			"class_static_block",
			ChunkKind::StaticInit,
			RuleStyle::Named,
			NamingMode::None,
			RecurseMode::None,
		),
		semantic_rule(
			"type_alias_declaration",
			ChunkKind::Type,
			RuleStyle::Named,
			NamingMode::AutoIdentifier,
			RecurseMode::None,
		),
	],
	function:             &[],
	structural_overrides: super::classify::StructuralOverrides::EMPTY,
};

impl LangClassifier for JsTsClassifier {
	fn tables(&self) -> &'static ClassifierTables {
		&JSTS_TABLES
	}

	fn is_trivia(&self, kind: &str) -> bool {
		// Whitespace/text runs between JSX elements carry no structure and
		// should be absorbed as leading trivia of the next element (matching
		// the existing comment-absorption semantics).
		kind == "jsx_text"
	}

	fn should_skip_child(&self, kind: &str) -> bool {
		// JSX opening and closing elements are part of the enclosing
		// `jsx_element` chunk's framing, not children in their own right.
		// Skip them entirely when enumerating children so they don't pollute
		// the chunk tree with noisy 1‑line entries and, crucially, so they
		// don't get absorbed backward into the next real child.
		matches!(kind, "jsx_opening_element" | "jsx_closing_element")
	}

	fn classify_override<'t>(
		&self,
		context: ChunkContext,
		node: Node<'t>,
		source: &str,
	) -> Option<RawChunkCandidate<'t>> {
		match context {
			ChunkContext::Root => classify_root_custom(node, source),
			ChunkContext::ClassBody => classify_class_custom(node, source),
			ChunkContext::FunctionBody => Some(classify_function_js(node, source)),
		}
	}
}

fn classify_root_custom<'t>(node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
	match node.kind() {
		// ── Exports / decorators ──
		"export_statement" => Some(classify_export_statement(ChunkContext::Root, node, source)),
		"decorated_definition" => promote_wrapper_candidate(
			&JsTsClassifier,
			ChunkContext::Root,
			node,
			source,
			WrapperTransform { signature: WrapperSignature::Wrapper, ..WrapperTransform::default() },
		)
		.or_else(|| Some(positional_candidate(node, ChunkKind::Block, source))),

		// ── Variables ──
		"lexical_declaration" | "variable_declaration" => Some(classify_var_decl_js(node, source)),

		// ── Containers with custom recursion ──
		"internal_module" => {
			Some(container_candidate(node, ChunkKind::Module, source, recurse_internal_module(node)))
		},

		// ── Control flow at top level ──
		"if_statement" | "switch_statement" | "switch_expression" | "try_statement"
		| "for_statement" | "for_in_statement" | "for_of_statement" | "while_statement"
		| "do_statement" | "with_statement" => Some(classify_function_js(node, source)),

		// ── Statements ──
		"expression_statement" => {
			// Unwrap `expression_statement` wrapping an `internal_module` (namespace).
			let inner = named_children(node)
				.into_iter()
				.find(|c| c.kind() == "internal_module");
			if let Some(ns) = inner {
				Some(container_candidate(ns, ChunkKind::Module, source, recurse_internal_module(ns)))
			} else {
				Some(group_candidate(node, ChunkKind::Statements, source))
			}
		},

		_ => None,
	}
}

fn classify_class_custom<'t>(node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
	match node.kind() {
		// ── Exports / decorators (re-exported members) ──
		"export_statement" => Some(classify_export_statement(ChunkContext::ClassBody, node, source)),
		"decorated_definition" => promote_wrapper_candidate(
			&JsTsClassifier,
			ChunkContext::ClassBody,
			node,
			source,
			WrapperTransform { signature: WrapperSignature::Wrapper, ..WrapperTransform::default() },
		)
		.or_else(|| Some(positional_candidate(node, ChunkKind::Block, source))),

		// ── Variables ──
		"lexical_declaration" | "variable_declaration" => Some(classify_var_decl_js(node, source)),

		// ── Methods ──
		"method_definition" | "method_signature" | "abstract_method_signature" => {
			let name = extract_identifier(node, source).unwrap_or_else(|| "anonymous".to_string());
			if name == "constructor" {
				Some(make_kind_chunk(
					node,
					ChunkKind::Constructor,
					None,
					source,
					recurse_body(node, ChunkContext::FunctionBody),
				))
			} else {
				Some(make_kind_chunk(
					node,
					ChunkKind::Function,
					Some(name),
					source,
					recurse_body(node, ChunkContext::FunctionBody),
				))
			}
		},

		// ── Fields ──
		"public_field_definition"
		| "field_definition"
		| "property_definition"
		| "property_signature"
		| "property_declaration"
		| "abstract_class_field" => match extract_identifier(node, source) {
			Some(name) => Some(make_kind_chunk(node, ChunkKind::Field, Some(name), source, None)),
			None => Some(group_candidate(node, ChunkKind::Fields, source)),
		},

		// ── Enum members ──
		"enum_assignment" | "enum_member_declaration" => match extract_identifier(node, source) {
			Some(name) => Some(make_kind_chunk(node, ChunkKind::Variant, Some(name), source, None)),
			None => Some(group_candidate(node, ChunkKind::Variants, source)),
		},

		_ => None,
	}
}

/// Classify nodes inside a function body for JS/TS.
fn classify_function_js<'t>(node: Node<'t>, source: &str) -> RawChunkCandidate<'t> {
	let fn_recurse = || recurse_body(node, ChunkContext::FunctionBody);
	match node.kind() {
		// ── Control flow ──
		"if_statement" => {
			make_candidate(node, ChunkKind::If, None, NameStyle::Named, None, fn_recurse(), source)
		},
		"switch_statement" | "switch_expression" => {
			make_candidate(node, ChunkKind::Switch, None, NameStyle::Named, None, fn_recurse(), source)
		},
		"try_statement" => {
			make_candidate(node, ChunkKind::Try, None, NameStyle::Named, None, fn_recurse(), source)
		},

		// ── Loops ──
		"for_statement" => {
			make_candidate(node, ChunkKind::For, None, NameStyle::Named, None, fn_recurse(), source)
		},
		"for_in_statement" => {
			make_candidate(node, ChunkKind::ForIn, None, NameStyle::Named, None, fn_recurse(), source)
		},
		"for_of_statement" => {
			make_candidate(node, ChunkKind::ForOf, None, NameStyle::Named, None, fn_recurse(), source)
		},
		"while_statement" => {
			make_candidate(node, ChunkKind::While, None, NameStyle::Named, None, fn_recurse(), source)
		},
		"do_statement" => {
			make_candidate(node, ChunkKind::Block, None, NameStyle::Named, None, fn_recurse(), source)
		},

		// ── Blocks ──
		"with_statement" => {
			make_candidate(node, ChunkKind::Block, None, NameStyle::Named, None, fn_recurse(), source)
		},

		// ── Variables ──
		"lexical_declaration" | "variable_declaration" => {
			if let Some(name) = extract_single_declarator_name(node, source) {
				make_kind_chunk(node, ChunkKind::Variable, Some(name), source, None)
			} else {
				group_from_sanitized(node, source)
			}
		},

		// ── Return statements ──
		// A bare `return <Link>…</Link>` or `return (<Link>…</Link>)` creates a
		// huge monolithic leaf chunk in React components. Recurse into the JSX
		// so each child element inside the returned tree stays individually
		// addressable. Callback-with-trailing-block patterns such as
		// `return items.map(item => { … })` are handled by the shared
		// call-with-callback promotion in `classify_with_defaults` via the
		// `return_statement` arm below.
		"return_statement" => classify_return_statement_js(node, source),

		// ── JSX elements ──
		// Inside function bodies, JSX elements become container chunks with
		// their tag name so React component trees are navigable instead of
		// opaque walls of markup.
		"jsx_element" => classify_jsx_element(node, source),
		"jsx_self_closing_element" => classify_jsx_self_closing_element(node, source),
		"jsx_fragment" => make_candidate(
			node,
			ChunkKind::Tag,
			Some("fragment".to_string()),
			NameStyle::Named,
			signature_for_node(node, source),
			Some(recurse_self(node, ChunkContext::FunctionBody)),
			source,
		),

		// ── Expression statements (enable call-with-callback promotion) ──
		"expression_statement" => group_candidate(node, ChunkKind::Statements, source),

		// ── Fallback ──
		_ => group_from_sanitized(node, source),
	}
}

/// Classify a `jsx_element` as a container chunk named after its tag.
///
/// The chunk recurses into itself so that nested JSX children are emitted as
/// sub-chunks. Structural JSX nodes (opening/closing elements, text,
/// attributes) are filtered out as trivia by the classifier's `is_trivia`
/// override, so only meaningful children (child elements, expression
/// containers) become chunks.
fn classify_jsx_element<'t>(node: Node<'t>, source: &str) -> RawChunkCandidate<'t> {
	let tag_name = extract_jsx_tag_name(node, source);
	let mut candidate = make_candidate(
		node,
		ChunkKind::Tag,
		tag_name,
		NameStyle::Named,
		signature_for_node(node, source),
		Some(recurse_self(node, ChunkContext::FunctionBody)),
		source,
	);
	// Force recursion for jsx_elements that span more than a single
	// source line. Without this, a `<div>` wrapping a single
	// near-equal-sized child fails `recursion_narrows_scope` and the
	// whole subtree collapses into one opaque chunk. One-line elements
	// keep natural collapse behavior so short inline JSX stays a leaf.
	if candidate
		.range_end_line
		.saturating_sub(candidate.range_start_line)
		> 0
	{
		candidate.force_recurse = true;
	}
	candidate
}

/// Classify a `return_statement`.
///
/// Two patterns matter:
///
/// 1. `return <Link>…</Link>` / `return (<Link>…</Link>)` — unwrap any
///    parentheses and recurse directly into the JSX tree so each nested JSX
///    element is individually addressable.
/// 2. `return items.map(item => { … })` — the shared call-with-trailing-
///    callback promoter turns this into a named expression container that
///    recurses into the callback body. We invoke it explicitly here because the
///    shared promotion in `classify_with_defaults` only runs on groupable
///    leaves, and `Return` is not groupable.
fn classify_return_statement_js<'t>(node: Node<'t>, source: &str) -> RawChunkCandidate<'t> {
	if let Some(expr) = named_children(node).into_iter().next() {
		let target = unwrap_parenthesized(expr);
		if matches!(target.kind(), "jsx_element" | "jsx_fragment" | "jsx_self_closing_element") {
			let mut candidate = make_candidate(
				node,
				ChunkKind::Return,
				None::<String>,
				NameStyle::Named,
				signature_for_node(node, source),
				Some(RecurseSpec { node: target, context: ChunkContext::FunctionBody }),
				source,
			);
			// The JSX tree may span nearly the entire return statement, which
			// would fail the `recursion_narrows_scope` check. Force recursion
			// so the JSX children are always individually addressable.
			candidate.force_recurse = true;
			return candidate;
		}
	}
	if let Some(mut promoted) = try_promote_call_with_callback(node, source) {
		// The callback body is the sole child of the return value, so it
		// spans nearly the entire return statement. Force recursion to
		// guarantee the callback internals are addressable.
		promoted.force_recurse = true;
		return promoted;
	}
	group_from_sanitized(node, source)
}

/// Classify a `jsx_self_closing_element` as a leaf chunk named after its tag.
fn classify_jsx_self_closing_element<'t>(node: Node<'t>, source: &str) -> RawChunkCandidate<'t> {
	let tag_name = extract_jsx_tag_name(node, source);
	make_kind_chunk(node, ChunkKind::Tag, tag_name, source, None)
}

/// Unwrap nested `parenthesized_expression` wrappers to reach the meaningful
/// inner expression.
fn unwrap_parenthesized(mut node: Node<'_>) -> Node<'_> {
	while node.kind() == "parenthesized_expression" {
		let Some(inner) = named_children(node).into_iter().next() else {
			break;
		};
		node = inner;
	}
	node
}

/// Extract the tag name from a `jsx_element` or `jsx_self_closing_element`.
///
/// The tag may be an identifier (`div`, `Link`), a member expression
/// (`Foo.Bar`), or a nested identifier. We sanitize the full text so path
/// segments remain valid identifiers.
fn extract_jsx_tag_name(node: Node<'_>, source: &str) -> Option<String> {
	let name_holder = match node.kind() {
		"jsx_element" => child_by_kind(node, &["jsx_opening_element"])?,
		"jsx_self_closing_element" => node,
		_ => return None,
	};
	let name_node = named_children(name_holder).into_iter().find(|child| {
		matches!(
			child.kind(),
			"identifier" | "member_expression" | "nested_identifier" | "jsx_namespace_name"
		)
	})?;
	sanitize_identifier(node_text(source, name_node.start_byte(), name_node.end_byte()))
}

/// Classify `const`/`let`/`var` declarations, promoting arrow functions
/// and class expressions to fn_/class_ chunks.
fn classify_var_decl_js<'t>(node: Node<'t>, source: &str) -> RawChunkCandidate<'t> {
	// Inline promotion logic — look for single variable_declarator with fn/class
	// value.
	let declarators: Vec<Node<'t>> = named_children(node)
		.into_iter()
		.filter(|c| c.kind() == "variable_declarator")
		.collect();
	if declarators.len() == 1 {
		let decl = declarators[0];
		if let Some(value) = decl.child_by_field_name("value") {
			let name = extract_identifier(decl, source).unwrap_or_else(|| "anonymous".to_string());
			match value.kind() {
				"arrow_function" | "function_expression" | "function" => {
					let recurse = recurse_body(value, ChunkContext::FunctionBody);
					return make_kind_chunk(node, ChunkKind::Function, Some(name), source, recurse);
				},
				"class" | "class_expression" => {
					let recurse = recurse_class(value);
					return make_container_chunk(node, ChunkKind::Class, Some(name), source, recurse);
				},
				_ => {},
			}
		}
	}
	// Not promoted — fall back to var_NAME or group.
	if let Some(name) = extract_single_declarator_name(node, source) {
		return make_kind_chunk(node, ChunkKind::Variable, Some(name), source, None);
	}
	group_candidate(node, ChunkKind::Declarations, source)
}

fn group_from_sanitized<'t>(node: Node<'t>, source: &str) -> RawChunkCandidate<'t> {
	let sanitized = sanitize_node_kind(node.kind());
	let kind = ChunkKind::from_sanitized_kind(sanitized);
	let identifier = if kind == ChunkKind::Chunk {
		Some(sanitized.to_string())
	} else {
		None
	};
	make_candidate(node, kind, identifier, NameStyle::Group, None, None, source)
}

/// Unwrap `export` / `export default` to classify the inner declaration.
///
/// Wrapper promotion handles declaration-like exports automatically.
/// `export default …` remaps the promoted child to `default_export`, while
/// re-exports and bare expression exports still fall through to `stmts`.
fn classify_export_statement<'t>(
	context: ChunkContext,
	node: Node<'t>,
	source: &str,
) -> RawChunkCandidate<'t> {
	let header = normalized_header(source, node.start_byte(), node.end_byte());
	let is_default = header.starts_with("export default");

	if let Some(candidate) =
		promote_wrapper_candidate(&JsTsClassifier, context, node, source, WrapperTransform {
			kind: is_default.then_some(ChunkKind::DefaultExport),
			name_style: is_default.then_some(NameStyle::Named),
			clear_identifier: is_default,
			..WrapperTransform::default()
		}) {
		return candidate;
	}

	let Some(child) = first_wrapper_content_child(&JsTsClassifier, node) else {
		return if is_default {
			make_kind_chunk(node, ChunkKind::DefaultExport, None, source, None)
		} else {
			group_candidate(node, ChunkKind::Statements, source)
		};
	};

	if is_default {
		return make_kind_chunk(node, ChunkKind::DefaultExport, None, source, None);
	}

	match child.kind() {
		"lexical_declaration" | "variable_declaration" => {
			classify_with_defaults(&JsTsClassifier, context, child, source)
		},
		_ => group_candidate(child, ChunkKind::Statements, source),
	}
}
