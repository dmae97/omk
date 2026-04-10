use tree_sitter::Node;

use super::{atom_list, schema};

const IDENTIFIER_FIELD_PRIORITY: &[&str] = &[
	"name",
	"identifier",
	"attrpath",
	"key",
	"label",
	"alias",
	"field",
	"member",
	"property",
	"tag",
	"target",
	"variable",
];

const BODY_FIELD_PRIORITY: &[&str] = &["body", "value", "declaration_list", "block", "members"];

pub fn signature_end_byte(node: Node<'_>) -> Option<usize> {
	recurse_target(node)
		.filter(|child| child.start_byte() > node.start_byte())
		.map(|child| child.start_byte())
}

pub fn identifier_node(node: Node<'_>) -> Option<Node<'_>> {
	schema_identifier_node(node)
		.or_else(|| probe_field_child(node, IDENTIFIER_FIELD_PRIORITY))
		.or_else(|| {
			local_named_children(node)
				.into_iter()
				.find(|child| looks_like_identifier_kind(child.kind()))
		})
}

pub fn recurse_target(node: Node<'_>) -> Option<Node<'_>> {
	schema_body_child(node)
		.or_else(|| schema_container_child(node))
		.or_else(|| probe_field_child(node, BODY_FIELD_PRIORITY))
		.or_else(|| probe_structural_child(node))
		.and_then(descend_to_structural_target)
}

pub fn value_container_target(node: Node<'_>) -> Option<Node<'_>> {
	for field in ["value", "body"] {
		if let Some(child) = node.child_by_field_name(field)
			&& let Some(target) = descend_to_structural_target(child)
		{
			return Some(target);
		}
	}

	recurse_target(node)
}

pub fn is_root_wrapper_node(node: Node<'_>) -> bool {
	if is_atom_node(node) {
		return false;
	}

	if let Some(schema) = schema::schema_for_current(node.kind()) {
		if schema.is_supertype {
			return true;
		}
		if schema.is_structural() && !is_transparent_recurse_wrapper(node) {
			return false;
		}
	}

	if identifier_node(node).is_some() {
		return false;
	}

	let non_trivia = local_named_children(node)
		.into_iter()
		.filter(|child| !is_generic_trivia(*child))
		.collect::<Vec<_>>();
	non_trivia.len() == 1 && node_looks_structural(non_trivia[0])
}

pub fn is_generic_trivia(node: Node<'_>) -> bool {
	node.is_extra() || kind_looks_like_comment(node.kind())
}

pub fn is_generic_absorbable_attr(kind: &str) -> bool {
	matches!(kind, "attribute_item" | "inner_attribute_item")
}

pub fn is_atom_node(node: Node<'_>) -> bool {
	atom_list::is_atom_node_current(node.kind())
}

fn schema_identifier_node(node: Node<'_>) -> Option<Node<'_>> {
	let schema = schema::schema_for_current(node.kind())?;
	for field in &schema.identifier_fields {
		if let Some(child) = node.child_by_field_name(field) {
			return Some(child);
		}
	}
	None
}

fn schema_body_child(node: Node<'_>) -> Option<Node<'_>> {
	let schema = schema::schema_for_current(node.kind())?;
	for field in &schema.body_fields {
		if let Some(child) = node.child_by_field_name(field) {
			return Some(child);
		}
	}
	None
}

fn schema_container_child(node: Node<'_>) -> Option<Node<'_>> {
	let schema = schema::schema_for_current(node.kind())?;
	local_named_children(node).into_iter().find(|child| {
		schema
			.container_child_kinds
			.iter()
			.any(|kind| child.kind() == kind)
	})
}

fn probe_field_child<'tree>(node: Node<'tree>, fields: &[&str]) -> Option<Node<'tree>> {
	fields
		.iter()
		.find_map(|field| node.child_by_field_name(field))
}

fn probe_structural_child(node: Node<'_>) -> Option<Node<'_>> {
	local_named_children(node).into_iter().find(|child| {
		!is_generic_trivia(*child)
			&& !looks_like_identifier_kind(child.kind())
			&& !is_atom_node(*child)
			&& node_looks_structural(*child)
	})
}

fn descend_to_structural_target(node: Node<'_>) -> Option<Node<'_>> {
	if is_atom_node(node) {
		return None;
	}

	if is_transparent_recurse_wrapper(node) {
		let child = local_named_children(node)
			.into_iter()
			.find(|child| !is_generic_trivia(*child) && node_looks_structural(*child))?;
		return descend_to_structural_target(child).or(Some(child));
	}

	if node_looks_structural(node) {
		return Some(node);
	}

	probe_structural_child(node).and_then(descend_to_structural_target)
}

fn is_transparent_recurse_wrapper(node: Node<'_>) -> bool {
	if is_atom_node(node) || identifier_node(node).is_some() {
		return false;
	}

	schema::schema_for_current(node.kind()).is_some_and(|schema| schema.is_supertype)
		|| matches!(node.kind(), "document" | "stream")
		|| node.kind().ends_with("_node")
}

fn node_looks_structural(node: Node<'_>) -> bool {
	if is_atom_node(node) {
		return false;
	}

	if schema::schema_for_current(node.kind()).is_some_and(|schema| schema.is_structural()) {
		return true;
	}

	let non_trivia_children = local_named_children(node)
		.into_iter()
		.filter(|child| !is_generic_trivia(*child))
		.collect::<Vec<_>>();
	!non_trivia_children.is_empty()
		&& non_trivia_children
			.iter()
			.any(|child| !looks_like_identifier_kind(child.kind()) || child.named_child_count() > 0)
}

fn local_named_children(node: Node<'_>) -> Vec<Node<'_>> {
	let mut children = Vec::new();
	for index in 0..node.child_count() {
		if let Some(child) = node.child(index)
			&& (child.is_named() || child.is_error() || child.kind() == "ERROR")
		{
			children.push(child);
		}
	}
	children
}

fn looks_like_identifier_kind(kind: &str) -> bool {
	kind == "identifier"
		|| kind == "name"
		|| kind.ends_with("_identifier")
		|| kind.ends_with("_name")
		|| kind.ends_with("_label")
}

fn kind_looks_like_comment(kind: &str) -> bool {
	kind == "comment" || kind.contains("comment")
}

/// Detect a call-with-trailing-callback pattern inside a node.
///
/// Returns `(call_text_node, body_node)` where `call_text_node` is the function
/// being called (for name extraction) and `body_node` is the block body of the
/// trailing callback argument.
///
/// This handles patterns like:
/// - JS/TS: `describe('x', () => { ... })`, `app.use(handler)`
/// - Go: `t.Run("x", func(t *testing.T) { ... })`
/// - Rust: `tokio::spawn(async { ... })`
/// - Ruby: `describe 'x' do ... end` (via `do_block`)
///
/// Only matches when the last argument has a structural block body, so
/// expression-body arrows and simple value arguments are not promoted.
pub fn trailing_callback_body(node: Node<'_>) -> Option<(Node<'_>, Node<'_>)> {
	// Look through the node's children for a call-like node.
	let call = local_named_children(node)
		.into_iter()
		.find(|c| is_call_like(*c))?;

	// Find the arguments / parameter list.
	let args_node = call
		.child_by_field_name("arguments")
		.or_else(|| call.child_by_field_name("args"))
		.or_else(|| call.child_by_field_name("block"))?;

	// Get the last named child of the arguments list.
	let last_arg = local_named_children(args_node).into_iter().last()?;

	// Try to find a structural body inside the last argument.
	let body = recurse_target(last_arg)?;

	// Extract the call target node for name purposes.
	let func_node = call
		.child_by_field_name("function")
		.or_else(|| call.child_by_field_name("method"))
		.or_else(|| call.child_by_field_name("name"))
		.unwrap_or(call);

	Some((func_node, body))
}

/// Returns `true` if the node looks like a function/method call.
fn is_call_like(node: Node<'_>) -> bool {
	let kind = node.kind();
	// Explicit known call kinds.
	if matches!(
		kind,
		"call_expression"
			| "call"
			| "function_call"
			| "method_call"
			| "method_call_expression"
			| "invocation_expression"
	) {
		return true;
	}
	// Heuristic: has an `arguments` field.
	node.child_by_field_name("arguments").is_some()
}

#[cfg(test)]
mod tests {
	use ast_grep_core::tree_sitter::LanguageExt;
	use tree_sitter::{Node, Parser};

	use super::{
		identifier_node, is_root_wrapper_node, recurse_target, signature_end_byte,
		trailing_callback_body,
	};
	use crate::language::SupportLang;

	fn parse_tree_with_language(
		source: &str,
		language: SupportLang,
	) -> (crate::chunk::schema::SchemaLanguageGuard, tree_sitter::Tree) {
		let schema_language = crate::chunk::schema::enter_language(language.canonical_name());
		let mut parser = Parser::new();
		parser
			.set_language(&language.get_ts_language())
			.expect("language should parse");
		let tree = parser.parse(source, None).expect("tree should parse");
		(schema_language, tree)
	}

	fn find_named_node<'tree>(node: Node<'tree>, kind: &str) -> Option<Node<'tree>> {
		if node.kind() == kind {
			return Some(node);
		}
		for index in 0..node.child_count() {
			let Some(child) = node.child(index) else {
				continue;
			};
			if let Some(found) = find_named_node(child, kind) {
				return Some(found);
			}
		}
		None
	}

	#[test]
	fn python_function_definition_resolves_identifier_and_body() {
		let (_schema_language, tree) =
			parse_tree_with_language("def greet(name):\n return name\n", SupportLang::Python);
		let node =
			find_named_node(tree.root_node(), "function_definition").expect("function_definition");
		assert_eq!(identifier_node(node).expect("name").kind(), "identifier");
		assert_eq!(recurse_target(node).expect("body").kind(), "block");
		assert!(signature_end_byte(node).is_some());
	}

	#[test]
	fn typescript_class_declaration_resolves_body() {
		let (_schema_language, tree) =
			parse_tree_with_language("class Greeter {\n  hello() {}\n}\n", SupportLang::TypeScript);
		let node = find_named_node(tree.root_node(), "class_declaration").expect("class_declaration");
		assert_eq!(recurse_target(node).expect("body").kind(), "class_body");
	}

	#[test]
	fn yaml_wrapper_nodes_are_structural_without_shared_kind_lists() {
		let (_schema_language, tree) =
			parse_tree_with_language("root:\n  child: 1\n", SupportLang::Yaml);
		let node = find_named_node(tree.root_node(), "block_node").expect("block_node");
		assert!(is_root_wrapper_node(node), "block_node should be treated as a structural wrapper");
	}

	#[test]
	fn js_expression_statement_with_callback_detects_body() {
		let source = "describe(\"suite\", () => {\n\tit(\"a\", () => {});\n});\n";
		let (_schema_language, tree) = parse_tree_with_language(source, SupportLang::TypeScript);
		let expr_stmt =
			find_named_node(tree.root_node(), "expression_statement").expect("expression_statement");
		let (func_node, body) =
			trailing_callback_body(expr_stmt).expect("should detect trailing callback body");
		assert_eq!(body.kind(), "statement_block");
		assert!(
			matches!(func_node.kind(), "identifier" | "member_expression"),
			"func_node should be an identifier or member_expression, got {}",
			func_node.kind()
		);
	}
}
