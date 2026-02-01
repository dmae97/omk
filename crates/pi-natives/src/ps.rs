//! Cross-platform process tree management.
//!
//! Provides efficient process tree enumeration and termination without
//! requiring processes to be spawned with `detached: true`.
//!
//! # Platform Implementation
//! - **Linux**: Reads `/proc/{pid}/children` recursively
//! - **macOS**: Uses `libproc` (`proc_listchildpids`)
//! - **Windows**: Uses `CreateToolhelp32Snapshot` to build parent-child
//!   relationships
//!
//! # Example
//! ```ignore
//! use pi_natives::ps::kill_tree;
//!
//! // Kill process 1234 and all its descendants
//! let killed = kill_tree(1234, 9); // SIGKILL
//! ```

use napi_derive::napi;

#[cfg(target_os = "linux")]
mod platform {
	use std::fs;

	/// Recursively collect all descendant PIDs by reading /proc/{pid}/children.
	pub fn collect_descendants(pid: i32, pids: &mut Vec<i32>) {
		let children_path = format!("/proc/{pid}/task/{pid}/children");
		let Ok(content) = fs::read_to_string(&children_path) else {
			return;
		};

		for part in content.split_whitespace() {
			if let Ok(child_pid) = part.parse::<i32>() {
				pids.push(child_pid);
				collect_descendants(child_pid, pids);
			}
		}
	}

	/// Kill a process with the given signal.
	pub fn kill_pid(pid: i32, signal: i32) -> bool {
		// SAFETY: libc::kill is safe to call with any pid/signal combination
		unsafe { libc::kill(pid, signal) == 0 }
	}
}

#[cfg(target_os = "macos")]
mod platform {
	use std::ptr;

	#[link(name = "proc", kind = "dylib")]
	unsafe extern "C" {
		fn proc_listchildpids(ppid: i32, buffer: *mut i32, buffersize: i32) -> i32;
	}

	/// Recursively collect all descendant PIDs using libproc.
	pub fn collect_descendants(pid: i32, pids: &mut Vec<i32>) {
		// First call to get count
		let count = unsafe { proc_listchildpids(pid, ptr::null_mut(), 0) };
		if count <= 0 {
			return;
		}

		let mut buffer = vec![0i32; count as usize];
		let actual = unsafe {
			proc_listchildpids(pid, buffer.as_mut_ptr(), (buffer.len() * size_of::<i32>()) as i32)
		};

		if actual <= 0 {
			return;
		}

		let child_count = actual as usize / size_of::<i32>();
		for &child_pid in &buffer[..child_count] {
			if child_pid > 0 {
				pids.push(child_pid);
				collect_descendants(child_pid, pids);
			}
		}
	}

	/// Kill a process with the given signal.
	pub fn kill_pid(pid: i32, signal: i32) -> bool {
		// SAFETY: libc::kill is safe to call with any pid/signal combination
		unsafe { libc::kill(pid, signal) == 0 }
	}
}

#[cfg(target_os = "windows")]
mod platform {
	use std::{collections::HashMap, mem, ptr};

	#[repr(C)]
	#[allow(non_snake_case)]
	struct PROCESSENTRY32W {
		dwSize:              u32,
		cntUsage:            u32,
		th32ProcessID:       u32,
		th32DefaultHeapID:   usize,
		th32ModuleID:        u32,
		cntThreads:          u32,
		th32ParentProcessID: u32,
		pcPriClassBase:      i32,
		dwFlags:             u32,
		szExeFile:           [u16; 260],
	}

	type HANDLE = *mut std::ffi::c_void;
	const INVALID_HANDLE_VALUE: HANDLE = -1isize as HANDLE;
	const TH32CS_SNAPPROCESS: u32 = 0x00000002;
	const PROCESS_TERMINATE: u32 = 0x0001;

	#[link(name = "kernel32")]
	unsafe extern "system" {
		fn CreateToolhelp32Snapshot(dwFlags: u32, th32ProcessID: u32) -> HANDLE;
		fn Process32FirstW(hSnapshot: HANDLE, lppe: *mut PROCESSENTRY32W) -> i32;
		fn Process32NextW(hSnapshot: HANDLE, lppe: *mut PROCESSENTRY32W) -> i32;
		fn CloseHandle(hObject: HANDLE) -> i32;
		fn OpenProcess(dwDesiredAccess: u32, bInheritHandle: i32, dwProcessId: u32) -> HANDLE;
		fn TerminateProcess(hProcess: HANDLE, uExitCode: u32) -> i32;
	}

	/// Build a map of parent_pid -> [child_pids] for all processes.
	fn build_process_tree() -> HashMap<u32, Vec<u32>> {
		let mut tree: HashMap<u32, Vec<u32>> = HashMap::new();

		unsafe {
			let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
			if snapshot == INVALID_HANDLE_VALUE {
				return tree;
			}

			let mut entry: PROCESSENTRY32W = mem::zeroed();
			entry.dwSize = mem::size_of::<PROCESSENTRY32W>() as u32;

			if Process32FirstW(snapshot, &mut entry) != 0 {
				loop {
					tree
						.entry(entry.th32ParentProcessID)
						.or_default()
						.push(entry.th32ProcessID);

					if Process32NextW(snapshot, &mut entry) == 0 {
						break;
					}
				}
			}

			CloseHandle(snapshot);
		}

		tree
	}

	/// Recursively collect all descendant PIDs.
	pub fn collect_descendants(pid: i32, pids: &mut Vec<i32>) {
		let tree = build_process_tree();
		collect_descendants_from_tree(pid as u32, &tree, pids);
	}

	fn collect_descendants_from_tree(pid: u32, tree: &HashMap<u32, Vec<u32>>, pids: &mut Vec<i32>) {
		if let Some(children) = tree.get(&pid) {
			for &child_pid in children {
				pids.push(child_pid as i32);
				collect_descendants_from_tree(child_pid, tree, pids);
			}
		}
	}

	/// Kill a process (signal is ignored on Windows, always terminates).
	pub fn kill_pid(pid: i32, _signal: i32) -> bool {
		unsafe {
			let handle = OpenProcess(PROCESS_TERMINATE, 0, pid as u32);
			if handle.is_null() || handle == INVALID_HANDLE_VALUE {
				return false;
			}
			let result = TerminateProcess(handle, 1);
			CloseHandle(handle);
			result != 0
		}
	}
}

/// Kill a process tree (the process and all its descendants).
///
/// Kills children first (bottom-up) to prevent orphan re-parenting issues.
/// Returns the number of processes successfully killed.
#[napi]
pub fn kill_tree(pid: i32, signal: i32) -> u32 {
	let mut descendants = Vec::new();
	platform::collect_descendants(pid, &mut descendants);

	let mut killed = 0u32;

	// Kill children first (deepest first by reversing the DFS order)
	for &child_pid in descendants.iter().rev() {
		if platform::kill_pid(child_pid, signal) {
			killed += 1;
		}
	}

	// Kill the root process last
	if platform::kill_pid(pid, signal) {
		killed += 1;
	}

	killed
}

/// List all descendant PIDs of a process.
///
/// Returns an empty array if the process has no children or doesn't exist.
#[napi]
pub fn list_descendants(pid: i32) -> Vec<i32> {
	let mut descendants = Vec::new();
	platform::collect_descendants(pid, &mut descendants);
	descendants
}
