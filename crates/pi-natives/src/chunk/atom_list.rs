use std::collections::{HashMap, HashSet};

use super::schema;

type AtomSet = HashSet<&'static str>;

static ATOM_NODES: std::sync::LazyLock<HashMap<&'static str, AtomSet>> =
	std::sync::LazyLock::new(|| {
		HashMap::from([
			("astro", HashSet::from(["frontmatter"])),
			("bash", HashSet::from(["string", "raw_string", "heredoc_body", "simple_expansion"])),
			("c", HashSet::from(["string_literal", "char_literal"])),
			("clojure", HashSet::from(["kwd_lit", "regex_lit"])),
			("cmake", HashSet::from(["argument"])),
			("cpp", HashSet::from(["string_literal", "char_literal"])),
			(
				"csharp",
				HashSet::from([
					"string_literal",
					"verbatim_string_literal",
					"character_literal",
					"modifier",
				]),
			),
			("css", HashSet::from(["integer_value", "float_value", "color_value", "string_value"])),
			("elixir", HashSet::from(["string_constant_expr"])),
			("go", HashSet::from(["interpreted_string_literal", "raw_string_literal"])),
			(
				"haskell",
				HashSet::from([
					"qualified_variable",
					"qualified_module",
					"qualified_constructor",
					"strict_type",
				]),
			),
			("hcl", HashSet::from(["string_lit", "heredoc_template"])),
			(
				"html",
				HashSet::from(["doctype", "quoted_attribute_value", "raw_text", "tag_name", "text"]),
			),
			(
				"java",
				HashSet::from([
					"string_literal",
					"boolean_type",
					"integral_type",
					"floating_point_type",
					"void_type",
				]),
			),
			("json", HashSet::from(["string"])),
			(
				"julia",
				HashSet::from([
					"string_literal",
					"prefixed_string_literal",
					"command_literal",
					"character_literal",
				]),
			),
			(
				"kotlin",
				HashSet::from([
					"nullable_type",
					"string_literal",
					"line_string_literal",
					"character_literal",
				]),
			),
			("lua", HashSet::from(["string"])),
			("make", HashSet::from(["shell_text", "text"])),
			("nix", HashSet::from(["string_expression", "indented_string_expression"])),
			("objc", HashSet::from(["string_literal"])),
			(
				"perl",
				HashSet::from([
					"string_single_quoted",
					"string_double_quoted",
					"comments",
					"command_qx_quoted",
					"pattern_matcher_m",
					"regex_pattern_qr",
					"transliteration_tr_or_y",
					"substitution_pattern_s",
					"scalar_variable",
					"array_variable",
					"hash_variable",
					"hash_access_variable",
				]),
			),
			("php", HashSet::from(["string", "encapsed_string"])),
			("protobuf", HashSet::from(["string"])),
			("python", HashSet::from(["string"])),
			("r", HashSet::from(["string", "special"])),
			("ruby", HashSet::from(["string", "heredoc_body", "regex"])),
			("rust", HashSet::from(["char_literal", "string_literal", "raw_string_literal"])),
			("scala", HashSet::from(["string", "template_string", "interpolated_string_expression"])),
			("solidity", HashSet::from(["string", "hex_string_literal", "unicode_string_literal"])),
			("sql", HashSet::from(["string", "identifier"])),
			("swift", HashSet::from(["line_string_literal"])),
			("toml", HashSet::from(["string", "quoted_key"])),
			("tsx", HashSet::from(["string", "template_string"])),
			("typescript", HashSet::from(["string", "template_string", "regex", "predefined_type"])),
			("xml", HashSet::from(["AttValue", "XMLDecl"])),
			(
				"yaml",
				HashSet::from([
					"string_scalar",
					"double_quote_scalar",
					"single_quote_scalar",
					"block_scalar",
				]),
			),
			("verilog", HashSet::from(["integral_number"])),
			("zig", HashSet::from(["string"])),
		])
	});

pub fn is_atom_node(language: &str, kind: &str) -> bool {
	ATOM_NODES
		.get(language)
		.is_some_and(|atom_nodes| atom_nodes.contains(kind))
}

pub fn is_atom_node_current(kind: &str) -> bool {
	schema::current_language().is_some_and(|language| is_atom_node(language, kind))
}

#[cfg(test)]
mod tests {
	use super::is_atom_node;

	#[test]
	fn nix_binding_set_is_not_an_atom() {
		assert!(!is_atom_node("nix", "binding_set"));
		assert!(is_atom_node("nix", "string_expression"));
	}

	#[test]
	fn typescript_predefined_types_stay_atomic() {
		assert!(is_atom_node("typescript", "predefined_type"));
		assert!(!is_atom_node("typescript", "class_declaration"));
	}
}
