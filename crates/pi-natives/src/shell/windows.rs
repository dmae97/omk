use std::{
	env,
	path::{Path, PathBuf},
	process::Command,
};

use brush_core::{Shell as BrushShell, ShellValue, ShellVariable};
use napi::{Error, Result};
use winreg::{RegKey, enums::HKEY_LOCAL_MACHINE};

pub fn configure_windows_path(shell: &mut BrushShell) -> Result<()> {
	let Some(git_usr_bin) = find_git_usr_bin() else {
		return Ok(());
	};

	if !Path::new(&git_usr_bin).is_dir() {
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

	if path_contains_entry(&existing_path, &git_usr_bin) {
		return Ok(());
	}

	let mut updated_path = existing_path;
	if !updated_path.is_empty() && !updated_path.ends_with(';') {
		updated_path.push(';');
	}
	updated_path.push_str(&git_usr_bin);

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

fn find_git_usr_bin() -> Option<String> {
	for install_path in [query_git_install_path_from_registry(), query_git_install_path_from_where()]
		.into_iter()
		.flatten()
	{
		if let Some(path) = git_usr_bin_with_ls(&install_path) {
			return Some(path);
		}
	}

	None
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
	let install_root = git_path.parent()?.parent()?;
	Some(install_root.to_string_lossy().to_string())
}

fn git_usr_bin_with_ls(install_root: &str) -> Option<String> {
	let usr_bin = Path::new(install_root).join("usr").join("bin");
	if usr_bin.join("ls.exe").is_file() {
		Some(usr_bin.to_string_lossy().to_string())
	} else {
		None
	}
}
