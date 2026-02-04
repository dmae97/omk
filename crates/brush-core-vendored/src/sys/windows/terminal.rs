//! Terminal utilities.

use crate::{error, sys, terminal};
use windows_sys::Win32::{
	Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE},
	System::{
		Console::{
			GetConsoleMode, GetConsoleWindow, GetStdHandle, SetConsoleMode,
			ENABLE_ECHO_INPUT, ENABLE_LINE_INPUT, ENABLE_PROCESSED_INPUT,
			ENABLE_PROCESSED_OUTPUT, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE,
		},
		Diagnostics::ToolHelp::{
			CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
			TH32CS_SNAPPROCESS,
		},
		Threading::GetCurrentProcessId,
	},
	UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId, SetForegroundWindow},
};

/// Terminal configuration.
#[derive(Clone, Debug)]
pub struct Config {
	input_mode: u32,
	output_mode: u32,
}

impl Config {
	/// Creates a new `Config` from the actual terminal attributes of the terminal associated
	/// with the given file descriptor.
	///
	/// # Arguments
	///
	/// * `_fd` - The file descriptor of the terminal.
	pub fn from_term<Fd>(_fd: Fd) -> Result<Self, error::Error> {
		let input_handle = console_input_handle()?;
		let output_handle = console_output_handle()?;

		let input_mode = console_mode(input_handle)?;
		let output_mode = console_mode(output_handle)?;

		Ok(Self {
			input_mode,
			output_mode,
		})
	}

	/// Applies the terminal settings to the terminal associated with the given file descriptor.
	///
	/// # Arguments
	///
	/// * `_fd` - The file descriptor of the terminal.
	pub fn apply_to_term<Fd>(&self, _fd: Fd) -> Result<(), error::Error> {
		let input_handle = console_input_handle()?;
		let output_handle = console_output_handle()?;

		set_console_mode(input_handle, self.input_mode)?;
		set_console_mode(output_handle, self.output_mode)?;

		Ok(())
	}

	/// Applies the given high-level terminal settings to this configuration. Does not modify any
	/// terminal itself.
	///
	/// # Arguments
	///
	/// * `settings` - The high-level terminal settings to apply to this configuration.
	pub fn update(&mut self, settings: &terminal::Settings) {
		if let Some(echo_input) = settings.echo_input {
			if echo_input {
				self.input_mode |= ENABLE_ECHO_INPUT;
			} else {
				self.input_mode &= !ENABLE_ECHO_INPUT;
			}
		}

		if let Some(line_input) = settings.line_input {
			if line_input {
				self.input_mode |= ENABLE_LINE_INPUT;
			} else {
				self.input_mode &= !ENABLE_LINE_INPUT;
			}
		}

		if let Some(interrupt_signals) = settings.interrupt_signals {
			if interrupt_signals {
				self.input_mode |= ENABLE_PROCESSED_INPUT;
			} else {
				self.input_mode &= !ENABLE_PROCESSED_INPUT;
			}
		}

		if let Some(output_nl_as_nlcr) = settings.output_nl_as_nlcr {
			if output_nl_as_nlcr {
				self.output_mode |= ENABLE_PROCESSED_OUTPUT;
			} else {
				self.output_mode &= !ENABLE_PROCESSED_OUTPUT;
			}
		}
	}
}

/// Get the process ID of this process's parent.
pub fn get_parent_process_id() -> Option<sys::process::ProcessId> {
	let pid = {
		// SAFETY: GetCurrentProcessId has no safety requirements.
		unsafe { GetCurrentProcessId() }
	};
	let snapshot = {
		// SAFETY: CreateToolhelp32Snapshot requires valid flags.
		unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }
	};
	if snapshot == INVALID_HANDLE_VALUE {
		return None;
	}

	let mut entry = PROCESSENTRY32W {
		dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
		// SAFETY: zeroed struct is valid for PROCESSENTRY32W.
		..unsafe { std::mem::zeroed() }
	};

	let mut parent = None;
	let mut result = {
		// SAFETY: snapshot handle is valid and entry is initialized.
		unsafe { Process32FirstW(snapshot, &mut entry) }
	};
	while result != 0 {
		if entry.th32ProcessID == pid {
			parent = Some(entry.th32ParentProcessID as sys::process::ProcessId);
			break;
		}
		result = {
			// SAFETY: snapshot handle is valid and entry is initialized.
			unsafe { Process32NextW(snapshot, &mut entry) }
		};
	}

	let _ = {
		// SAFETY: snapshot handle was returned by CreateToolhelp32Snapshot.
		unsafe { CloseHandle(snapshot) }
	};
	parent
}

/// Get the process group ID for this process's process group.
pub fn get_process_group_id() -> Option<sys::process::ProcessId> {
	let pid = {
		// SAFETY: GetCurrentProcessId has no safety requirements.
		unsafe { GetCurrentProcessId() }
	};
	Some(pid as sys::process::ProcessId)
}

/// Get the foreground process ID of the attached terminal.
pub fn get_foreground_pid() -> Option<sys::process::ProcessId> {
	let hwnd = {
		// SAFETY: GetForegroundWindow has no safety requirements.
		unsafe { GetForegroundWindow() }
	};
	if hwnd == 0 {
		return None;
	}

	let mut pid = 0u32;
	{
		// SAFETY: hwnd is valid when non-zero and pid pointer is valid.
		unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
	}
	(pid != 0).then_some(pid as sys::process::ProcessId)
}

/// Move the specified process to the foreground of the attached terminal.
pub fn move_to_foreground(_pid: sys::process::ProcessId) -> Result<(), error::Error> {
	let hwnd = {
		// SAFETY: GetConsoleWindow has no safety requirements.
		unsafe { GetConsoleWindow() }
	};
	if hwnd != 0 {
		let _ = {
			// SAFETY: hwnd is a console window handle when non-zero.
			unsafe { SetForegroundWindow(hwnd) }
		};
	}
	Ok(())
}

/// Moves the current process to the foreground of the attached terminal.
pub fn move_self_to_foreground() -> Result<(), error::Error> {
	let pid = {
		// SAFETY: GetCurrentProcessId has no safety requirements.
		unsafe { GetCurrentProcessId() }
	};
	move_to_foreground(pid as sys::process::ProcessId)
}

fn console_input_handle() -> Result<HANDLE, error::Error> {
	let handle = {
		// SAFETY: GetStdHandle has no safety requirements.
		unsafe { GetStdHandle(STD_INPUT_HANDLE) }
	};
	validate_handle(handle)
}

fn console_output_handle() -> Result<HANDLE, error::Error> {
	let handle = {
		// SAFETY: GetStdHandle has no safety requirements.
		unsafe { GetStdHandle(STD_OUTPUT_HANDLE) }
	};
	validate_handle(handle)
}

fn validate_handle(handle: HANDLE) -> Result<HANDLE, error::Error> {
	if handle == 0 || handle == INVALID_HANDLE_VALUE {
		return Err(std::io::Error::last_os_error().into());
	}

	Ok(handle)
}

fn console_mode(handle: HANDLE) -> Result<u32, error::Error> {
	let mut mode = 0u32;
	// SAFETY: handle is validated and mode pointer is valid.
	if unsafe { GetConsoleMode(handle, &mut mode) } == 0 {
		return Err(std::io::Error::last_os_error().into());
	}

	Ok(mode)
}

fn set_console_mode(handle: HANDLE, mode: u32) -> Result<(), error::Error> {
	// SAFETY: handle is validated and mode is a valid console mode flag set.
	if unsafe { SetConsoleMode(handle, mode) } == 0 {
		return Err(std::io::Error::last_os_error().into());
	}

	Ok(())
}
