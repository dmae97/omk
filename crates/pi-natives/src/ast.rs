//! AST-aware structural search and rewrite powered by ast-grep.

use std::{
	collections::{BTreeSet, HashMap},
	path::{Path, PathBuf},
};

use ast_grep_core::{
	Language, MatchStrictness,
	matcher::Pattern,
	source::{Doc, Edit},
	tree_sitter::LanguageExt,
};
use ast_grep_language::SupportLang;
use napi::bindgen_prelude::*;
use napi_derive::napi;

use crate::{fs_cache, glob_util, task};

const DEFAULT_FIND_LIMIT: u32 = 50;

#[napi(object)]
pub struct AstFindOptions<'env> {
	pub pattern:      Option<String>,
	pub lang:         Option<String>,
	pub path:         Option<String>,
	pub glob:         Option<String>,
	pub selector:     Option<String>,
	pub strictness:   Option<String>,
	pub limit:        Option<u32>,
	pub offset:       Option<u32>,
	#[napi(js_name = "includeMeta")]
	pub include_meta: Option<bool>,
	pub context:      Option<u32>,
	pub signal:       Option<Unknown<'env>>,
	#[napi(js_name = "timeoutMs")]
	pub timeout_ms:   Option<u32>,
}

#[napi(object)]
pub struct AstFindMatch {
	pub path:           String,
	pub text:           String,
	#[napi(js_name = "byteStart")]
	pub byte_start:     u32,
	#[napi(js_name = "byteEnd")]
	pub byte_end:       u32,
	#[napi(js_name = "startLine")]
	pub start_line:     u32,
	#[napi(js_name = "startColumn")]
	pub start_column:   u32,
	#[napi(js_name = "endLine")]
	pub end_line:       u32,
	#[napi(js_name = "endColumn")]
	pub end_column:     u32,
	#[napi(js_name = "metaVariables")]
	pub meta_variables: Option<HashMap<String, String>>,
}

#[napi(object)]
pub struct AstFindResult {
	pub matches:            Vec<AstFindMatch>,
	#[napi(js_name = "totalMatches")]
	pub total_matches:      u32,
	#[napi(js_name = "filesWithMatches")]
	pub files_with_matches: u32,
	#[napi(js_name = "filesSearched")]
	pub files_searched:     u32,
	#[napi(js_name = "limitReached")]
	pub limit_reached:      bool,
	#[napi(js_name = "parseErrors")]
	pub parse_errors:       Option<Vec<String>>,
}

#[napi(object)]
pub struct AstReplaceOptions<'env> {
	pub pattern:             Option<String>,
	pub rewrite:             Option<String>,
	pub lang:                Option<String>,
	pub path:                Option<String>,
	pub glob:                Option<String>,
	pub selector:            Option<String>,
	pub strictness:          Option<String>,
	#[napi(js_name = "dryRun")]
	pub dry_run:             Option<bool>,
	#[napi(js_name = "maxReplacements")]
	pub max_replacements:    Option<u32>,
	#[napi(js_name = "maxFiles")]
	pub max_files:           Option<u32>,
	#[napi(js_name = "failOnParseError")]
	pub fail_on_parse_error: Option<bool>,
	pub signal:              Option<Unknown<'env>>,
	#[napi(js_name = "timeoutMs")]
	pub timeout_ms:          Option<u32>,
}

#[napi(object)]
pub struct AstReplaceChange {
	pub path:           String,
	pub before:         String,
	pub after:          String,
	#[napi(js_name = "byteStart")]
	pub byte_start:     u32,
	#[napi(js_name = "byteEnd")]
	pub byte_end:       u32,
	#[napi(js_name = "deletedLength")]
	pub deleted_length: u32,
	#[napi(js_name = "startLine")]
	pub start_line:     u32,
	#[napi(js_name = "startColumn")]
	pub start_column:   u32,
	#[napi(js_name = "endLine")]
	pub end_line:       u32,
	#[napi(js_name = "endColumn")]
	pub end_column:     u32,
}

#[napi(object)]
pub struct AstReplaceFileChange {
	pub path:  String,
	pub count: u32,
}

#[napi(object)]
pub struct AstReplaceResult {
	pub changes:            Vec<AstReplaceChange>,
	#[napi(js_name = "fileChanges")]
	pub file_changes:       Vec<AstReplaceFileChange>,
	#[napi(js_name = "totalReplacements")]
	pub total_replacements: u32,
	#[napi(js_name = "filesTouched")]
	pub files_touched:      u32,
	#[napi(js_name = "filesSearched")]
	pub files_searched:     u32,
	pub applied:            bool,
	#[napi(js_name = "limitReached")]
	pub limit_reached:      bool,
	#[napi(js_name = "parseErrors")]
	pub parse_errors:       Option<Vec<String>>,
}

struct FileCandidate {
	absolute_path: PathBuf,
	display_path:  String,
}

struct PendingFileChange {
	change: AstReplaceChange,
	edit:   Edit<String>,
}

fn to_u32(value: usize) -> u32 {
	value.min(u32::MAX as usize) as u32
}

const fn supported_lang_aliases() -> &'static [&'static str] {
	&[
		"ts",
		"typescript",
		"tsx",
		"js",
		"javascript",
		"jsx",
		"json",
		"rs",
		"rust",
		"py",
		"python",
		"go",
	]
}

fn resolve_supported_lang(value: &str) -> Result<SupportLang> {
	match value.to_ascii_lowercase().as_str() {
		"ts" | "typescript" => Ok(SupportLang::TypeScript),
		"tsx" => Ok(SupportLang::Tsx),
		"js" | "javascript" | "jsx" => Ok(SupportLang::JavaScript),
		"json" => Ok(SupportLang::Json),
		"rs" | "rust" => Ok(SupportLang::Rust),
		"py" | "python" => Ok(SupportLang::Python),
		"go" => Ok(SupportLang::Go),
		_ => Err(Error::from_reason(format!(
			"Unsupported language '{value}'. Supported aliases: {}",
			supported_lang_aliases().join(", ")
		))),
	}
}

fn resolve_language(lang: Option<&str>, file_path: &Path) -> Result<SupportLang> {
	if let Some(lang) = lang.map(str::trim).filter(|lang| !lang.is_empty()) {
		return resolve_supported_lang(lang);
	}
	let Some(guessed) = SupportLang::from_path(file_path) else {
		return Err(Error::from_reason(format!(
			"Unable to infer language from file extension: {}. Specify `lang` explicitly.",
			file_path.display()
		)));
	};
	match guessed {
		SupportLang::TypeScript
		| SupportLang::Tsx
		| SupportLang::JavaScript
		| SupportLang::Json
		| SupportLang::Rust
		| SupportLang::Python
		| SupportLang::Go => Ok(guessed),
		_ => Err(Error::from_reason(format!(
			"Unsupported inferred language for {}. Supported aliases: {}",
			file_path.display(),
			supported_lang_aliases().join(", ")
		))),
	}
}

const fn canonical_lang_name(lang: SupportLang) -> &'static str {
	match lang {
		SupportLang::TypeScript => "typescript",
		SupportLang::Tsx => "tsx",
		SupportLang::JavaScript => "javascript",
		SupportLang::Json => "json",
		SupportLang::Rust => "rust",
		SupportLang::Python => "python",
		SupportLang::Go => "go",
		_ => "unknown",
	}
}

fn infer_single_replace_lang(
	candidates: &[FileCandidate],
	ct: &task::CancelToken,
) -> Result<String> {
	let mut inferred = BTreeSet::new();
	let mut unresolved = Vec::new();
	for candidate in candidates {
		ct.heartbeat()?;
		match resolve_language(None, &candidate.absolute_path) {
			Ok(language) => {
				inferred.insert(canonical_lang_name(language).to_string());
			},
			Err(err) => unresolved.push(format!("{}: {}", candidate.display_path, err)),
		}
	}
	if !unresolved.is_empty() {
		let details = unresolved
			.into_iter()
			.map(|entry| format!("- {entry}"))
			.collect::<Vec<_>>()
			.join("\n");
		return Err(Error::from_reason(format!(
			"`lang` is required for ast_replace when language cannot be inferred from all \
			 files:\n{details}"
		)));
	}
	if inferred.is_empty() {
		return Err(Error::from_reason(
			"`lang` is required for ast_replace when no files match path/glob".to_string(),
		));
	}
	if inferred.len() > 1 {
		return Err(Error::from_reason(format!(
			"`lang` is required for ast_replace when path/glob resolves to multiple languages: {}",
			inferred.into_iter().collect::<Vec<_>>().join(", ")
		)));
	}
	Ok(inferred.into_iter().next().expect("non-empty inferred set"))
}
fn parse_strictness(value: Option<&str>) -> Result<MatchStrictness> {
	let Some(raw) = value.map(str::trim).filter(|v| !v.is_empty()) else {
		return Ok(MatchStrictness::Smart);
	};
	raw.parse::<MatchStrictness>()
		.map_err(|err| Error::from_reason(format!("Invalid strictness '{raw}': {err}")))
}

fn normalize_search_path(path: Option<String>) -> Result<PathBuf> {
	let raw = path.unwrap_or_else(|| ".".to_string());
	let candidate = PathBuf::from(raw.trim());
	let absolute = if candidate.is_absolute() {
		candidate
	} else {
		std::env::current_dir()
			.map_err(|err| Error::from_reason(format!("Failed to resolve cwd: {err}")))?
			.join(candidate)
	};
	Ok(std::fs::canonicalize(&absolute).unwrap_or(absolute))
}

fn collect_from_entries(
	root: &Path,
	entries: &[fs_cache::GlobMatch],
	glob_set: Option<&globset::GlobSet>,
	mentions_node_modules: bool,
	ct: &task::CancelToken,
) -> Result<Vec<FileCandidate>> {
	let mut files = Vec::new();
	for entry in entries {
		ct.heartbeat()?;
		if entry.file_type != fs_cache::FileType::File {
			continue;
		}
		let relative = entry.path.replace('\\', "/");
		if fs_cache::should_skip_path(Path::new(&relative), mentions_node_modules) {
			continue;
		}
		if let Some(glob_set) = glob_set
			&& !glob_set.is_match(&relative)
		{
			continue;
		}
		files.push(FileCandidate { absolute_path: root.join(&relative), display_path: relative });
	}
	Ok(files)
}

fn collect_candidates(
	path: Option<String>,
	glob: Option<&str>,
	ct: &task::CancelToken,
) -> Result<Vec<FileCandidate>> {
	let search_path = normalize_search_path(path)?;
	let metadata = std::fs::metadata(&search_path)
		.map_err(|err| Error::from_reason(format!("Path not found: {err}")))?;
	if metadata.is_file() {
		let display_path = search_path
			.file_name()
			.and_then(|name| name.to_str())
			.map_or_else(
				|| search_path.to_string_lossy().to_string(),
				std::string::ToString::to_string,
			);
		return Ok(vec![FileCandidate { absolute_path: search_path, display_path }]);
	}
	if !metadata.is_dir() {
		return Err(Error::from_reason(format!(
			"Search path must be a file or directory: {}",
			search_path.display()
		)));
	}

	let glob_set = glob_util::try_compile_glob(glob, false)?;
	let mentions_node_modules = glob.is_some_and(|value| value.contains("node_modules"));
	let scan = fs_cache::get_or_scan(&search_path, true, true, ct)?;
	let mut files = collect_from_entries(
		&search_path,
		&scan.entries,
		glob_set.as_ref(),
		mentions_node_modules,
		ct,
	)?;

	if files.is_empty() && scan.cache_age_ms >= fs_cache::empty_recheck_ms() {
		let fresh = fs_cache::force_rescan(&search_path, true, true, true, ct)?;
		files =
			collect_from_entries(&search_path, &fresh, glob_set.as_ref(), mentions_node_modules, ct)?;
	}

	files.sort_by(|a, b| a.display_path.cmp(&b.display_path));
	Ok(files)
}

fn compile_pattern(
	pattern: &str,
	selector: Option<&str>,
	strictness: &MatchStrictness,
	lang: SupportLang,
) -> Result<Pattern> {
	let mut compiled = if let Some(selector) = selector.map(str::trim).filter(|s| !s.is_empty()) {
		Pattern::contextual(pattern, selector, lang)
	} else {
		Pattern::try_new(pattern, lang)
	}
	.map_err(|err| Error::from_reason(format!("Invalid pattern: {err}")))?;
	compiled.strictness = strictness.clone();
	Ok(compiled)
}

fn has_syntax_error<D: Doc>(ast: &ast_grep_core::AstGrep<D>) -> bool {
	ast.root()
		.dfs()
		.any(|node| node.is_error() || node.is_missing())
}

fn apply_edits(content: &str, edits: &[Edit<String>]) -> Result<String> {
	let mut sorted: Vec<&Edit<String>> = edits.iter().collect();
	sorted.sort_by_key(|edit| edit.position);
	let mut prev_end = 0usize;
	for edit in &sorted {
		if edit.position < prev_end {
			return Err(Error::from_reason(
				"Overlapping replacements detected; refine pattern to avoid ambiguous edits"
					.to_string(),
			));
		}
		prev_end = edit.position.saturating_add(edit.deleted_length);
	}

	let mut output = content.to_string();
	for edit in sorted.into_iter().rev() {
		let start = edit.position;
		let end = edit.position.saturating_add(edit.deleted_length);
		if end > output.len() || start > end {
			return Err(Error::from_reason("Computed edit range is out of bounds".to_string()));
		}
		let replacement = String::from_utf8(edit.inserted_text.clone()).map_err(|err| {
			Error::from_reason(format!("Replacement text is not valid UTF-8: {err}"))
		})?;
		output.replace_range(start..end, &replacement);
	}
	Ok(output)
}

#[napi(js_name = "astFind")]
pub fn ast_find(options: AstFindOptions<'_>) -> task::Async<AstFindResult> {
	let AstFindOptions {
		pattern,
		lang,
		path,
		glob,
		selector,
		strictness,
		limit,
		offset,
		include_meta,
		context: _,
		signal,
		timeout_ms,
	} = options;

	let ct = task::CancelToken::new(timeout_ms, signal);
	let normalized_limit = limit.unwrap_or(DEFAULT_FIND_LIMIT).max(1);
	let normalized_offset = offset.unwrap_or(0);

	task::blocking("ast_find", ct, move |ct| {
		let pattern = pattern
			.as_deref()
			.map(str::trim)
			.filter(|value| !value.is_empty())
			.ok_or_else(|| Error::from_reason("`pattern` is required".to_string()))?;

		let strictness = parse_strictness(strictness.as_deref())?;
		let include_meta = include_meta.unwrap_or(false);
		let candidates = collect_candidates(path, glob.as_deref(), &ct)?;

		let mut matches = Vec::new();
		let mut parse_errors = Vec::new();
		let mut total_matches = 0u32;
		let mut skipped = 0u32;
		let mut files_with_matches = 0u32;
		let mut limit_reached = false;

		'files: for candidate in &candidates {
			ct.heartbeat()?;
			let source = match std::fs::read_to_string(&candidate.absolute_path) {
				Ok(source) => source,
				Err(err) => {
					parse_errors.push(format!("{}: {err}", candidate.display_path));
					continue;
				},
			};

			let language = match resolve_language(lang.as_deref(), &candidate.absolute_path) {
				Ok(language) => language,
				Err(err) => {
					parse_errors.push(format!("{}: {}", candidate.display_path, err));
					continue;
				},
			};
			let compiled = match compile_pattern(pattern, selector.as_deref(), &strictness, language) {
				Ok(compiled) => compiled,
				Err(err) => {
					parse_errors.push(format!("{}: {}", candidate.display_path, err));
					continue;
				},
			};

			let ast = language.ast_grep(source);
			if has_syntax_error(&ast) {
				parse_errors.push(format!(
					"{}: parse error (syntax tree contains error nodes)",
					candidate.display_path
				));
				continue;
			}
			let mut file_has_match = false;
			for matched in ast.root().find_all(compiled.clone()) {
				ct.heartbeat()?;
				total_matches = total_matches.saturating_add(1);
				file_has_match = true;
				if skipped < normalized_offset {
					skipped = skipped.saturating_add(1);
					continue;
				}
				if matches.len() >= normalized_limit as usize {
					limit_reached = true;
					break 'files;
				}
				let range = matched.range();
				let start = matched.start_pos();
				let end = matched.end_pos();
				let meta_variables = if include_meta {
					Some(HashMap::<String, String>::from(matched.get_env().clone()))
				} else {
					None
				};
				matches.push(AstFindMatch {
					path: candidate.display_path.clone(),
					text: matched.text().into_owned(),
					byte_start: to_u32(range.start),
					byte_end: to_u32(range.end),
					start_line: to_u32(start.line().saturating_add(1)),
					start_column: to_u32(start.column(matched.get_node()).saturating_add(1)),
					end_line: to_u32(end.line().saturating_add(1)),
					end_column: to_u32(end.column(matched.get_node()).saturating_add(1)),
					meta_variables,
				});
			}
			if file_has_match {
				files_with_matches = files_with_matches.saturating_add(1);
			}
		}

		Ok(AstFindResult {
			matches,
			total_matches,
			files_with_matches,
			files_searched: to_u32(candidates.len()),
			limit_reached,
			parse_errors: (!parse_errors.is_empty()).then_some(parse_errors),
		})
	})
}

#[napi(js_name = "astReplace")]
pub fn ast_replace(options: AstReplaceOptions<'_>) -> task::Async<AstReplaceResult> {
	let AstReplaceOptions {
		pattern,
		rewrite,
		lang,
		path,
		glob,
		selector,
		strictness,
		dry_run,
		max_replacements,
		max_files,
		fail_on_parse_error,
		signal,
		timeout_ms,
	} = options;

	let ct = task::CancelToken::new(timeout_ms, signal);
	task::blocking("ast_replace", ct, move |ct| {
		let pattern = pattern
			.as_deref()
			.map(str::trim)
			.filter(|value| !value.is_empty())
			.ok_or_else(|| Error::from_reason("`pattern` is required".to_string()))?;

		let rewrite = rewrite
			.as_deref()
			.map(str::trim)
			.filter(|value| !value.is_empty())
			.ok_or_else(|| Error::from_reason("`rewrite` is required in pattern mode".to_string()))?
			.to_string();
		let strictness = parse_strictness(strictness.as_deref())?;
		let dry_run = dry_run.unwrap_or(true);
		let max_replacements = max_replacements.unwrap_or(u32::MAX).max(1);
		let max_files = max_files.unwrap_or(u32::MAX).max(1);
		let fail_on_parse_error = fail_on_parse_error.unwrap_or(false);

		let candidates = collect_candidates(path, glob.as_deref(), &ct)?;
		let effective_lang = if let Some(lang) = lang
			.as_deref()
			.map(str::trim)
			.filter(|value| !value.is_empty())
		{
			lang.to_string()
		} else {
			infer_single_replace_lang(&candidates, &ct)?
		};
		let mut changes = Vec::new();
		let mut parse_errors = Vec::new();
		let mut file_counts: HashMap<String, u32> = HashMap::new();
		let mut files_touched = 0u32;
		let mut limit_reached = false;

		'files: for candidate in &candidates {
			ct.heartbeat()?;
			let source = match std::fs::read_to_string(&candidate.absolute_path) {
				Ok(source) => source,
				Err(err) => {
					if fail_on_parse_error {
						return Err(Error::from_reason(format!("{}: {err}", candidate.display_path)));
					}
					parse_errors.push(format!("{}: {err}", candidate.display_path));
					continue;
				},
			};
			let language =
				match resolve_language(Some(effective_lang.as_str()), &candidate.absolute_path) {
					Ok(language) => language,
					Err(err) => {
						if fail_on_parse_error {
							return Err(err);
						}
						parse_errors.push(format!("{}: {}", candidate.display_path, err));
						continue;
					},
				};
			let compiled = match compile_pattern(pattern, selector.as_deref(), &strictness, language) {
				Ok(compiled) => compiled,
				Err(err) => {
					if fail_on_parse_error {
						return Err(err);
					}
					parse_errors.push(format!("{}: {}", candidate.display_path, err));
					continue;
				},
			};

			let ast = language.ast_grep(&source);
			if has_syntax_error(&ast) {
				let parse_issue = format!(
					"{}: parse error (syntax tree contains error nodes)",
					candidate.display_path
				);
				if fail_on_parse_error {
					return Err(Error::from_reason(parse_issue));
				}
				parse_errors.push(parse_issue);
				continue;
			}
			let mut file_changes = Vec::new();
			for matched in ast.root().find_all(compiled.clone()) {
				ct.heartbeat()?;
				if changes.len() >= max_replacements as usize {
					limit_reached = true;
					break 'files;
				}
				let edit = matched.replace_by(rewrite.as_str());
				let range = matched.range();
				let start = matched.start_pos();
				let end = matched.end_pos();
				let after = String::from_utf8(edit.inserted_text.clone()).map_err(|err| {
					Error::from_reason(format!(
						"{}: replacement text is not valid UTF-8: {err}",
						candidate.display_path
					))
				})?;
				file_changes.push(PendingFileChange {
					change: AstReplaceChange {
						path: candidate.display_path.clone(),
						before: matched.text().into_owned(),
						after,
						byte_start: to_u32(range.start),
						byte_end: to_u32(range.end),
						deleted_length: to_u32(edit.deleted_length),
						start_line: to_u32(start.line().saturating_add(1)),
						start_column: to_u32(start.column(matched.get_node()).saturating_add(1)),
						end_line: to_u32(end.line().saturating_add(1)),
						end_column: to_u32(end.column(matched.get_node()).saturating_add(1)),
					},
					edit,
				});
			}

			if file_changes.is_empty() {
				continue;
			}
			if files_touched >= max_files {
				limit_reached = true;
				break;
			}
			files_touched = files_touched.saturating_add(1);
			file_counts.insert(candidate.display_path.clone(), to_u32(file_changes.len()));

			if !dry_run {
				let edits: Vec<Edit<String>> = file_changes
					.iter()
					.map(|entry| Edit {
						position:       entry.edit.position,
						deleted_length: entry.edit.deleted_length,
						inserted_text:  entry.edit.inserted_text.clone(),
					})
					.collect();
				let output = apply_edits(&source, &edits)?;
				if output != source {
					std::fs::write(&candidate.absolute_path, output).map_err(|err| {
						Error::from_reason(format!("Failed to write {}: {err}", candidate.display_path))
					})?;
				}
			}

			changes.extend(file_changes.into_iter().map(|entry| entry.change));
			if changes.len() >= max_replacements as usize {
				limit_reached = true;
				break;
			}
		}

		let mut file_changes = file_counts
			.into_iter()
			.map(|(path, count)| AstReplaceFileChange { path, count })
			.collect::<Vec<_>>();
		file_changes.sort_by(|a, b| a.path.cmp(&b.path));

		Ok(AstReplaceResult {
			file_changes,
			total_replacements: to_u32(changes.len()),
			files_touched,
			files_searched: to_u32(candidates.len()),
			applied: !dry_run,
			limit_reached,
			parse_errors: (!parse_errors.is_empty()).then_some(parse_errors),
			changes,
		})
	})
}

#[cfg(test)]
mod tests {
	use std::{
		fs,
		path::PathBuf,
		time::{SystemTime, UNIX_EPOCH},
	};

	use ast_grep_core::tree_sitter::LanguageExt;

	use super::*;

	struct TempTree {
		root: PathBuf,
	}

	impl Drop for TempTree {
		fn drop(&mut self) {
			let _ = fs::remove_dir_all(&self.root);
		}
	}

	fn make_temp_tree() -> TempTree {
		let unique = SystemTime::now()
			.duration_since(UNIX_EPOCH)
			.expect("system time should be after UNIX_EPOCH")
			.as_nanos();
		let root = std::env::temp_dir().join(format!("pi-ast-glob-test-{unique}"));
		fs::create_dir_all(root.join("nested")).expect("temp nested dir should be created");
		fs::write(root.join("a.ts"), "const a = 1;\n").expect("temp file a.ts should be written");
		fs::write(root.join("nested").join("b.ts"), "const b = 2;\n")
			.expect("temp file nested/b.ts should be written");
		TempTree { root }
	}

	#[test]
	fn glob_star_matches_only_direct_children() {
		let tree = make_temp_tree();
		let ct = task::CancelToken::default();
		let candidates =
			collect_candidates(Some(tree.root.to_string_lossy().to_string()), Some("*.ts"), &ct)
				.expect("candidate collection should succeed");
		let paths = candidates
			.into_iter()
			.map(|file| file.display_path)
			.collect::<Vec<_>>();
		assert_eq!(paths, vec!["a.ts".to_string()]);
	}

	#[test]
	fn glob_double_star_matches_recursively() {
		let tree = make_temp_tree();
		let ct = task::CancelToken::default();
		let candidates =
			collect_candidates(Some(tree.root.to_string_lossy().to_string()), Some("**/*.ts"), &ct)
				.expect("candidate collection should succeed");
		let paths = candidates
			.into_iter()
			.map(|file| file.display_path)
			.collect::<Vec<_>>();
		assert_eq!(paths, vec!["a.ts".to_string(), "nested/b.ts".to_string()]);
	}
	fn make_mixed_temp_tree() -> TempTree {
		let unique = SystemTime::now()
			.duration_since(UNIX_EPOCH)
			.expect("system time should be after UNIX_EPOCH")
			.as_nanos();
		let root = std::env::temp_dir().join(format!("pi-ast-mixed-lang-test-{unique}"));
		fs::create_dir_all(&root).expect("temp mixed-lang dir should be created");
		fs::write(root.join("a.ts"), "const a = 1;\n").expect("temp file a.ts should be written");
		fs::write(root.join("b.rs"), "fn main() {}\n").expect("temp file b.rs should be written");
		TempTree { root }
	}

	#[test]
	fn infers_single_replace_lang_for_uniform_candidates() {
		let tree = make_temp_tree();
		let ct = task::CancelToken::default();
		let candidates =
			collect_candidates(Some(tree.root.to_string_lossy().to_string()), Some("**/*.ts"), &ct)
				.expect("candidate collection should succeed");
		let inferred =
			infer_single_replace_lang(&candidates, &ct).expect("language should be inferred");
		assert_eq!(inferred, "typescript");
	}

	#[test]
	fn rejects_mixed_replace_lang_inference() {
		let tree = make_mixed_temp_tree();
		let ct = task::CancelToken::default();
		let candidates = collect_candidates(Some(tree.root.to_string_lossy().to_string()), None, &ct)
			.expect("candidate collection should succeed");
		let err = infer_single_replace_lang(&candidates, &ct)
			.expect_err("mixed language inference should fail");
		assert!(err.to_string().contains("multiple languages"));
	}
	#[test]
	fn resolves_supported_language_aliases() {
		assert_eq!(resolve_supported_lang("ts").ok(), Some(SupportLang::TypeScript));
		assert_eq!(resolve_supported_lang("jsx").ok(), Some(SupportLang::JavaScript));
		assert_eq!(resolve_supported_lang("rs").ok(), Some(SupportLang::Rust));
		assert!(resolve_supported_lang("kotlin").is_err());
	}

	#[test]
	fn detects_syntax_errors_in_ast() {
		let ok = SupportLang::TypeScript.ast_grep("const value = 1;");
		assert!(!has_syntax_error(&ok));
		let bad = SupportLang::TypeScript.ast_grep("export function broken( { return 1; }");
		assert!(has_syntax_error(&bad));
	}

	#[test]
	fn applies_non_overlapping_edits() {
		let source = "const answer = 41;";
		let edits = vec![
			Edit::<String> { position: 6, deleted_length: 6, inserted_text: b"value".to_vec() },
			Edit::<String> { position: 15, deleted_length: 2, inserted_text: b"42".to_vec() },
		];
		let output = apply_edits(source, &edits).expect("edits should apply");
		assert_eq!(output, "const value = 42;");
	}

	#[test]
	fn rejects_overlapping_edits() {
		let source = "abcdef";
		let edits = vec![
			Edit::<String> { position: 1, deleted_length: 3, inserted_text: b"x".to_vec() },
			Edit::<String> { position: 2, deleted_length: 1, inserted_text: b"y".to_vec() },
		];
		assert!(apply_edits(source, &edits).is_err());
	}
}
