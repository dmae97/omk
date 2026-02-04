use std::{
	collections::HashSet,
	env,
	path::{Path, PathBuf},
	process::Command,
};

use brush_core::{Shell as BrushShell, ShellValue, ShellVariable};
use napi::{Error, Result};
use winreg::{RegKey, enums::HKEY_LOCAL_MACHINE};

pub fn configure_windows_path(shell: &mut BrushShell) -> Result<()> {
	let git_paths = find_git_paths();
	if git_paths.is_empty() {
		return Ok(());
	}

	let existing_path = shell
		.env
		.get("PATH")
		.and_then(|(_, var)| match var.value() {
			ShellValue::String(value) => Some(value.clone()),
			_ => None,
		})
		.unwrap_or_default();

	let mut updated_path = existing_path.clone();
	for git_path in git_paths {
		if !Path::new(&git_path).is_dir() {
			continue;
		}
		if path_contains_entry(&updated_path, &git_path) {
			continue;
		}
		if !updated_path.is_empty() && !updated_path.ends_with(';') {
			updated_path.push(';');
		}
		updated_path.push_str(&git_path);
	}

	if updated_path == existing_path {
		return Ok(());
	}

	let mut var = ShellVariable::new(ShellValue::String(updated_path));
	var.export();
	shell
		.env
		.set_global("PATH", var)
		.map_err(|err| Error::from_reason(format!("Failed to set PATH: {err}")))?;

	Ok(())
}

fn path_contains_entry(path_value: &str, entry: &str) -> bool {
	let entry_normalized = normalize_path(Path::new(entry));
	if entry_normalized.is_empty() {
		return false;
	}

	env::split_paths(path_value).any(|segment| {
		let segment_normalized = normalize_path(&segment);
		!segment_normalized.is_empty() && segment_normalized.eq_ignore_ascii_case(&entry_normalized)
	})
}

fn normalize_path(path: &Path) -> String {
	let path_str = path.to_string_lossy();
	let trimmed = path_str.trim();
	let unquoted = trimmed.trim_matches('"');
	if unquoted.is_empty() {
		return String::new();
	}

	let path = Path::new(unquoted);
	if let Ok(canonical) = path.canonicalize() {
		return canonical.to_string_lossy().to_string();
	}

	let mut normalized = PathBuf::new();
	for component in path.components() {
		normalized.push(component.as_os_str());
	}

	normalized.to_string_lossy().to_string()
}

fn find_git_paths() -> Vec<String> {
	let mut paths = Vec::new();
	let mut seen = HashSet::new();

	for install_path in [query_git_install_path_from_registry(), query_git_install_path_from_where()]
		.into_iter()
		.flatten()
	{
		for path in git_paths_for_install_root(&install_path) {
			let normalized = normalize_path(Path::new(&path));
			if normalized.is_empty() {
				continue;
			}
			if seen.insert(normalized) {
				paths.push(path);
			}
		}
	}

	paths
}

fn query_git_install_path_from_registry() -> Option<String> {
	let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
	let key_paths = ["SOFTWARE\\GitForWindows", "SOFTWARE\\WOW6432Node\\GitForWindows"];

	for key_path in key_paths {
		if let Ok(key) = hklm.open_subkey(key_path) {
			if let Ok(path) = key.get_value::<String, _>("InstallPath") {
				if !path.is_empty() {
					return Some(path);
				}
			}
		}
	}

	None
}

fn query_git_install_path_from_where() -> Option<String> {
	let output = Command::new("where").arg("git").output().ok()?;
	if !output.status.success() {
		return None;
	}

	let stdout = String::from_utf8_lossy(&output.stdout);
	let line = stdout.lines().next()?.trim();
	if line.is_empty() {
		return None;
	}

	let git_path = Path::new(line);
	let install_root = git_install_root_from_path(git_path)?;
	Some(install_root.to_string_lossy().to_string())
}

fn git_install_root_from_path(git_path: &Path) -> Option<PathBuf> {
	let parent = git_path.parent()?;
	let parent_name = parent.file_name()?.to_string_lossy();

	if parent_name.eq_ignore_ascii_case("cmd") {
		return parent.parent().map(Path::to_path_buf);
	}

	if parent_name.eq_ignore_ascii_case("bin") {
		let grandparent = parent.parent()?;
		if let Some(grandparent_name) = grandparent.file_name() {
			let grandparent_name = grandparent_name.to_string_lossy();
			if grandparent_name.eq_ignore_ascii_case("usr")
				|| grandparent_name.eq_ignore_ascii_case("mingw64")
				|| grandparent_name.eq_ignore_ascii_case("mingw32")
			{
				return grandparent.parent().map(Path::to_path_buf);
			}
		}
		return Some(grandparent.to_path_buf());
	}

	parent.parent().map(Path::to_path_buf)
}

fn git_paths_for_install_root(install_root: &str) -> Vec<String> {
	let root = Path::new(install_root);
	let mut paths = Vec::new();

	let cmd = root.join("cmd");
	if has_git_command(&cmd) {
		paths.push(cmd.to_string_lossy().to_string());
	}

	let bin = root.join("bin");
	if has_git_command(&bin) {
		paths.push(bin.to_string_lossy().to_string());
	}

	let usr_bin = root.join("usr").join("bin");
	if has_git_command(&usr_bin) || usr_bin.join("ls.exe").is_file() {
		paths.push(usr_bin.to_string_lossy().to_string());
	}

	paths
}

fn has_git_command(dir: &Path) -> bool {
	if !dir.is_dir() {
		return false;
	}

	["git.exe", "git.cmd", "git.bat"]
		.iter()
		.any(|name| dir.join(name).is_file())
}
