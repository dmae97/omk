//! Chunk classifier for Protocol Buffers.
//!
//! Mirror the grammar's declaration structure directly: the root owns headers,
//! imports, options, messages, enums, and services; message bodies own fields,
//! oneofs, and nested messages/enums; services own rpc declarations and service
//! options; rpc blocks may contain rpc-scoped options.

use tree_sitter::Node;

use super::{
	classify::{
		ClassifierTables, LangClassifier, NamingMode, RecurseMode, RuleStyle, semantic_rule,
	},
	common::*,
	kind::ChunkKind,
};

pub struct ProtoClassifier;

const PROTO_ROOT_RULES: &[super::classify::SemanticRule] = &[
	semantic_rule(
		"syntax",
		ChunkKind::Headers,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"package",
		ChunkKind::Headers,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"import",
		ChunkKind::Imports,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
	semantic_rule(
		"option",
		ChunkKind::Options,
		RuleStyle::Group,
		NamingMode::None,
		RecurseMode::None,
	),
];

const PROTO_CLASS_RULES: &[super::classify::SemanticRule] = &[semantic_rule(
	"option",
	ChunkKind::Options,
	RuleStyle::Group,
	NamingMode::None,
	RecurseMode::None,
)];

const PROTO_TABLES: ClassifierTables = ClassifierTables {
	root:                 PROTO_ROOT_RULES,
	class:                PROTO_CLASS_RULES,
	function:             &[],
	structural_overrides: super::classify::StructuralOverrides::EMPTY,
};

impl LangClassifier for ProtoClassifier {
	fn tables(&self) -> &'static ClassifierTables {
		&PROTO_TABLES
	}

	fn classify_override<'t>(
		&self,
		context: ChunkContext,
		node: Node<'t>,
		source: &str,
	) -> Option<RawChunkCandidate<'t>> {
		match context {
			ChunkContext::Root => classify_proto_root(node, source),
			ChunkContext::ClassBody => classify_proto_class(node, source),
			ChunkContext::FunctionBody => None,
		}
	}
}

fn classify_proto_root<'t>(node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
	Some(match node.kind() {
		"message" => make_named_proto_chunk(
			node,
			ChunkKind::Type,
			format!("msg_{}", proto_name(node, source)?),
			source,
			recurse_into(node, ChunkContext::ClassBody, &[], &["message_body"]),
		),
		"enum" => make_container_chunk(
			node,
			ChunkKind::Enum,
			proto_name(node, source),
			source,
			recurse_into(node, ChunkContext::ClassBody, &[], &["enum_body"]),
		),
		"service" => make_named_proto_chunk(
			node,
			ChunkKind::Interface,
			format!("service_{}", proto_name(node, source)?),
			source,
			Some(recurse_self(node, ChunkContext::ClassBody)),
		),
		_ => return None,
	})
}

fn classify_proto_class<'t>(node: Node<'t>, source: &str) -> Option<RawChunkCandidate<'t>> {
	Some(match node.kind() {
		"field" if is_proto_message_field(node) => {
			make_kind_chunk(node, ChunkKind::Field, proto_name(node, source), source, None)
		},
		"oneof" => make_named_proto_chunk(
			node,
			ChunkKind::Either,
			format!("oneof_{}", proto_name(node, source)?),
			source,
			Some(recurse_self(node, ChunkContext::ClassBody)),
		),
		"oneof_field" => {
			make_kind_chunk(node, ChunkKind::Field, proto_name(node, source), source, None)
		},
		"message" => make_named_proto_chunk(
			node,
			ChunkKind::Type,
			format!("msg_{}", proto_name(node, source)?),
			source,
			recurse_into(node, ChunkContext::ClassBody, &[], &["message_body"]),
		),
		"enum" => make_container_chunk(
			node,
			ChunkKind::Enum,
			proto_name(node, source),
			source,
			recurse_into(node, ChunkContext::ClassBody, &[], &["enum_body"]),
		),
		"enum_field" => {
			make_kind_chunk(node, ChunkKind::Variant, proto_name(node, source), source, None)
		},
		"rpc" => make_named_proto_chunk(
			node,
			ChunkKind::Proc,
			format!("rpc_{}", proto_name(node, source)?),
			source,
			proto_rpc_recurse(node),
		),
		_ => return None,
	})
}

fn make_named_proto_chunk<'t>(
	node: Node<'t>,
	kind: ChunkKind,
	identifier: impl Into<Option<String>>,
	source: &str,
	recurse: Option<RecurseSpec<'t>>,
) -> RawChunkCandidate<'t> {
	make_candidate(
		node,
		kind,
		identifier,
		NameStyle::Named,
		signature_for_node(node, source),
		recurse,
		source,
	)
}

fn is_proto_message_field(node: Node<'_>) -> bool {
	node
		.parent()
		.is_some_and(|parent| parent.kind() == "message_body")
}

fn proto_rpc_recurse(node: Node<'_>) -> Option<RecurseSpec<'_>> {
	let has_nested_option = named_children(node)
		.into_iter()
		.any(|child| child.kind() == "option");
	if has_nested_option {
		Some(recurse_self(node, ChunkContext::ClassBody))
	} else {
		None
	}
}

fn proto_name(node: Node<'_>, source: &str) -> Option<String> {
	child_by_kind(node, &["message_name", "enum_name", "service_name", "rpc_name", "identifier"])
		.and_then(|name| sanitize_identifier(node_text(source, name.start_byte(), name.end_byte())))
}
