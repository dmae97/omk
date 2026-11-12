//! Validated compact JSONL records with original field order and value lexemes.
//!
//! Normal serde structs do not reproduce JavaScript insertion order, and opaque
//! extension data may contain number spellings/escapes that Value normalizes.
//! Store ordered raw *fields*, validate the whole record as FileEntry, and only
//! expose an immutable typed view. Changes go through from_entry for validation.

/// Session specialization of the shared validated JSON record. The T006
/// entry/into_entry/from_entry API and serialization behavior are unchanged.
pub type SessionRecord = crate::jsonl::JsonRecord<crate::session::FileEntry>;
