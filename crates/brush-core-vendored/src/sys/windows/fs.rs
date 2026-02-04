//! Filesystem utilities.

use crate::error;
use std::{ffi::OsStr, path::PathBuf, sync::OnceLock};

impl crate::sys::fs::PathExt for std::path::Path {
	fn readable(&self) -> bool {
		true
	}

	fn writable(&self) -> bool {
		true
	}

	fn executable(&self) -> bool {
		if !self.is_file() {
			return false;
		}
		let Some(ext) = self.extension().and_then(OsStr::to_str) else {
			return false;
		};
		let ext = format!(".{ext}");
		executable_extensions()
			.iter()
			.any(|known| known.eq_ignore_ascii_case(&ext))
	}

	fn exists_and_is_block_device(&self) -> bool {
		false
	}

	fn exists_and_is_char_device(&self) -> bool {
		false
	}

	fn exists_and_is_fifo(&self) -> bool {
		false
	}

	fn exists_and_is_socket(&self) -> bool {
		false
	}

	fn exists_and_is_setgid(&self) -> bool {
		false
	}

	fn exists_and_is_setuid(&self) -> bool {
		false
	}

	fn exists_and_is_sticky_bit(&self) -> bool {
		false
	}

	fn get_device_and_inode(&self) -> Result<(u64, u64), crate::error::Error> {
		Ok((0, 0))
	}
}

pub(crate) trait MetadataExt {
	fn gid(&self) -> u32 {
		0
	}

	fn uid(&self) -> u32 {
		0
	}
}

impl MetadataExt for std::fs::Metadata {}

pub(crate) fn get_default_executable_search_paths() -> Vec<String> {
	let mut paths = Vec::new();
	if let Some(system32) = system32_path() {
		paths.push(system32.to_string_lossy().to_string());
	}
	paths
}

/// Returns the default paths where standard Unix utilities are typically installed.
/// This is a stub implementation that returns an empty vector.
pub fn get_default_standard_utils_paths() -> Vec<String> {
	let mut paths = Vec::new();
	if let Some(system32) = system32_path() {
		paths.push(system32.to_string_lossy().to_string());
	}
	paths
}

/// Opens a null file that will discard all I/O.
pub fn open_null_file() -> Result<std::fs::File, error::Error> {
	let f = std::fs::File::options().read(true).write(true).open("NUL")?;

	Ok(f)
}

fn system32_path() -> Option<PathBuf> {
	let system_root = std::env::var_os("SystemRoot")?;
	Some(PathBuf::from(system_root).join("System32"))
}

pub(crate) fn executable_extensions() -> &'static [String] {
	static PATHEXT: OnceLock<Vec<String>> = OnceLock::new();
	PATHEXT.get_or_init(|| {
		let fallback = [".COM", ".EXE", ".BAT", ".CMD"];
		let Some(value) = std::env::var_os("PATHEXT") else {
			return fallback.iter().map(|ext| (*ext).to_string()).collect();
		};

		let value = value.to_string_lossy();
		let mut exts = value
			.split(';')
			.filter_map(|ext| {
				let ext = ext.trim();
				if ext.is_empty() {
					None
				} else if ext.starts_with('.') {
					Some(ext.to_string())
				} else {
					Some(format!(".{ext}"))
				}
			})
			.collect::<Vec<_>>();

		if exts.is_empty() {
			exts = fallback.iter().map(|ext| (*ext).to_string()).collect::<Vec<_>>();
			return exts;
		}

		exts
	})
}
