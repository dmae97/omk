//! System information collection for the coding agent.
//!
//! # Overview
//! Provides cross-platform system info without shelling out, including OS,
//! distro, kernel, CPU model, architecture, and disk usage.
//!
//! # Example
//! ```ignore
//! const info = native.getSystemInfo();
//! console.log(info.os, info.cpu);
//! ```

use std::{fs, path::Path};

use napi_derive::napi;
use sysinfo::{Disks, System};

/// Basic system info without shelling out.
#[napi(object)]
pub struct SystemInfo {
	/// Linux distro or OS name when available.
	pub distro: Option<String>,
	/// Kernel version string (if reported by the OS).
	pub kernel: Option<String>,
	/// Primary CPU brand/model string.
	pub cpu:    Option<String>,
	/// Disk usage summary (used/total) for primary mount.
	pub disk:   Option<String>,
}

/// Collect system info with native APIs (no shell commands).
#[napi(js_name = "getSystemInfo")]
pub fn get_system_info() -> SystemInfo {
	let mut system = System::new_all();
	system.refresh_all();

	let distro = get_os_distro(&system);
	let kernel = sysinfo::System::kernel_version();
	let cpu = system
		.cpus()
		.first()
		.map(|cpu| cpu.brand().to_string())
		.filter(|v| !v.is_empty());
	let disk = get_disk_info();

	SystemInfo { distro, kernel, cpu, disk }
}

fn get_os_distro(_system: &System) -> Option<String> {
	if cfg!(target_os = "linux") {
		return read_linux_distro();
	}

	let base = sysinfo::System::long_os_version()
		.or_else(sysinfo::System::name)
		.filter(|value| !value.trim().is_empty());

	if cfg!(target_os = "macos")
		&& let Some(name) = macos_marketing_name()
	{
		return base.map(|b| format!("{b} {name}"));
	}

	base
}

/// Map macOS major version to its marketing name.
fn macos_marketing_name() -> Option<&'static str> {
	let version = sysinfo::System::os_version()?;
	let major: u32 = version.split('.').next()?.parse().ok()?;
	Some(match major {
		26 => "Tahoe",
		15 => "Sequoia",
		14 => "Sonoma",
		13 => "Ventura",
		12 => "Monterey",
		11 => "Big Sur",
		_ => return None,
	})
}

fn read_linux_distro() -> Option<String> {
	let content = fs::read_to_string("/etc/os-release").ok()?;
	let parsed = parse_key_value(&content);
	let pretty = parsed.get("PRETTY_NAME").cloned();
	if let Some(pretty) = pretty {
		return Some(strip_quotes(&pretty));
	}
	let name = parsed.get("NAME").cloned();
	let version = parsed.get("VERSION").cloned();
	match (name, version) {
		(Some(name), Some(version)) => Some(
			format!("{} {}", strip_quotes(&name), strip_quotes(&version))
				.trim()
				.to_string(),
		),
		(Some(name), None) => Some(strip_quotes(&name)),
		(None, Some(version)) => Some(strip_quotes(&version)),
		_ => None,
	}
}

fn parse_key_value(content: &str) -> std::collections::HashMap<String, String> {
	let mut result = std::collections::HashMap::new();
	for line in content.lines() {
		let trimmed = line.trim();
		if trimmed.is_empty() || trimmed.starts_with('#') {
			continue;
		}
		let mut parts = trimmed.splitn(2, '=');
		let key = parts.next().unwrap_or("").trim();
		let value = parts.next().unwrap_or("").trim();
		if !key.is_empty() && !value.is_empty() {
			result.insert(key.to_string(), value.to_string());
		}
	}
	result
}

fn strip_quotes(value: &str) -> String {
	value.trim_matches('"').to_string()
}

fn get_disk_info() -> Option<String> {
	let mut disks = Disks::new_with_refreshed_list();
	disks.refresh(true);

	if cfg!(target_os = "windows") {
		let mut entries = Vec::new();
		for disk in disks.list() {
			let mount = disk.mount_point().to_string_lossy().to_string();
			let label = mount.trim_end_matches(['\\', '/']).to_string();
			let total = disk.total_space();
			if total == 0 {
				continue;
			}
			let available = disk.available_space();
			let used = total.saturating_sub(available);
			entries.push(format_disk_entry(&label, used, total));
		}
		return if entries.is_empty() {
			None
		} else {
			Some(entries.join(", "))
		};
	}

	let root = disks
		.list()
		.iter()
		.find(|disk| disk.mount_point() == Path::new("/"))
		.or_else(|| disks.list().first());

	let disk = root?;
	let total = disk.total_space();
	if total == 0 {
		return None;
	}
	let used = total.saturating_sub(disk.available_space());
	Some(format!("/ {}", format_disk_usage(used, total)))
}

fn format_disk_entry(label: &str, used: u64, total: u64) -> String {
	format!("{} {}", label, format_disk_usage(used, total))
}

fn format_disk_usage(used: u64, total: u64) -> String {
	let pct = if total == 0 {
		0
	} else {
		((used as f64 / total as f64) * 100.0).round() as u32
	};
	format!("{}/{} ({}%)", format_bytes(used), format_bytes(total), pct)
}

fn format_bytes(bytes: u64) -> String {
	const KB: f64 = 1024.0;
	const MB: f64 = KB * 1024.0;
	const GB: f64 = MB * 1024.0;
	const TB: f64 = GB * 1024.0;
	let value = bytes as f64;
	if value < KB {
		format!("{bytes}B")
	} else if value < MB {
		format!("{:.1}KB", value / KB)
	} else if value < GB {
		format!("{:.1}MB", value / MB)
	} else if value < TB {
		format!("{:.1}GB", value / GB)
	} else {
		format!("{:.1}TB", value / TB)
	}
}
