//! Brush-based shell execution exported via N-API.
//!
//! # Overview
//! Executes shell commands in a non-interactive brush-core shell, streaming
//! output back to JavaScript via a threadsafe callback.
//!
//! # Example
//! ```ignore
//! const result = await natives.executeShell({ command: "ls" }, (chunk) => {
//!   console.log(chunk);
//! });
//! ```

use std::{
	collections::HashMap,
	io::Read,
	sync::{LazyLock, Mutex},
	time::Duration,
};

use brush_core::{
	CreateOptions, OpenFile, OpenFiles, ProcessGroupPolicy, Shell, ShellValue, ShellVariable,
};
use napi::{
	bindgen_prelude::*,
	threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode},
	tokio::{self, task, time},
};
use napi_derive::napi;

type ExecutionMap = HashMap<String, ExecutionControl>;

struct ExecutionControl {
	cancel: tokio::sync::oneshot::Sender<()>,
}

struct ExecutionGuard {
	execution_id: String,
}

impl Drop for ExecutionGuard {
	fn drop(&mut self) {
		let Ok(mut executions) = EXECUTIONS.lock() else {
			return;
		};
		executions.remove(&self.execution_id);
	}
}

static EXECUTIONS: LazyLock<Mutex<ExecutionMap>> = LazyLock::new(|| Mutex::new(HashMap::new()));

/// Options for executing a shell command via brush-core.
#[napi(object)]
pub struct ShellExecuteOptions {
	pub command:      String,
	pub cwd:          Option<String>,
	pub env:          Option<HashMap<String, String>>,
	pub timeout_ms:   Option<u32>,
	pub execution_id: String,
}

/// Result of executing a shell command via brush-core.
#[napi(object)]
pub struct ShellExecuteResult {
	pub exit_code: Option<i32>,
	pub cancelled: bool,
	pub timed_out: bool,
}

/// Execute a brush shell command.
#[napi]
pub async fn execute_shell(
	options: ShellExecuteOptions,
	#[napi(ts_arg_type = "((chunk: string) => void) | undefined | null")] on_chunk: Option<
		ThreadsafeFunction<String>,
	>,
) -> Result<ShellExecuteResult> {
	let execution_id = options.execution_id.clone();
	let timeout_ms = options.timeout_ms;

	let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel();
	{
		let mut executions = EXECUTIONS
			.lock()
			.map_err(|_| Error::from_reason("Execution lock poisoned"))?;
		if executions.contains_key(&execution_id) {
			return Err(Error::from_reason("Execution already running"));
		}
		executions.insert(execution_id.clone(), ExecutionControl { cancel: cancel_tx });
	}
	let _guard = ExecutionGuard { execution_id };

	let run_future = run_shell(options, on_chunk);
	tokio::pin!(run_future);

	let mut cancelled = false;
	let mut timed_out = false;

	let run_result = if let Some(ms) = timeout_ms {
		let timeout = time::sleep(Duration::from_millis(u64::from(ms)));
		tokio::pin!(timeout);

		tokio::select! {
			result = &mut run_future => result,
			_ = cancel_rx => {
				cancelled = true;
				attempt_kill_children().await;
				return Ok(ShellExecuteResult { exit_code: None, cancelled, timed_out });
			}
			() = &mut timeout => {
				timed_out = true;
				attempt_kill_children().await;
				return Ok(ShellExecuteResult { exit_code: None, cancelled, timed_out });
			}
		}
	} else {
		tokio::select! {
			result = &mut run_future => result,
			_ = cancel_rx => {
				cancelled = true;
				attempt_kill_children().await;
				return Ok(ShellExecuteResult { exit_code: None, cancelled, timed_out });
			}
		}
	}?;

	Ok(ShellExecuteResult { exit_code: Some(i32::from(run_result.exit_code)), cancelled, timed_out })
}

/// Abort a running shell execution.
#[napi]
pub fn abort_shell_execution(execution_id: String) -> Result<()> {
	let mut executions = EXECUTIONS
		.lock()
		.map_err(|_| Error::from_reason("Execution lock poisoned"))?;
	if let Some(control) = executions.remove(&execution_id) {
		let _ = control.cancel.send(());
	}
	Ok(())
}

async fn run_shell(
	options: ShellExecuteOptions,
	on_chunk: Option<ThreadsafeFunction<String>>,
) -> Result<brush_core::ExecutionResult> {
	let create_options = CreateOptions {
		interactive: false,
		login: false,
		no_profile: true,
		no_rc: true,
		do_not_inherit_env: true,
		..Default::default()
	};

	let mut shell = Shell::new(&create_options)
		.await
		.map_err(|err| Error::from_reason(format!("Failed to initialize shell: {err}")))?;

	if let Some(cwd) = options.cwd.as_deref() {
		shell
			.set_working_dir(cwd)
			.map_err(|err| Error::from_reason(format!("Failed to set cwd: {err}")))?;
	}

	if let Some(env) = options.env {
		for (key, value) in env {
			let mut var = ShellVariable::new(ShellValue::String(value));
			var.export();
			shell
				.env
				.set_global(key, var)
				.map_err(|err| Error::from_reason(format!("Failed to set env: {err}")))?;
		}
	}

	// Create a pipe using os_pipe
	let (pipe_reader, pipe_writer) =
		os_pipe::pipe().map_err(|err| Error::from_reason(format!("Failed to create pipe: {err}")))?;

	// Convert to std::fs::File via OwnedFd
	#[cfg(unix)]
	let (reader_file, writer_file): (std::fs::File, std::fs::File) = {
		use std::os::unix::io::IntoRawFd;
		let reader_fd = pipe_reader.into_raw_fd();
		let writer_fd = pipe_writer.into_raw_fd();
		// SAFETY: We just obtained these fds from os_pipe and own them exclusively.
		unsafe {
			(
				std::os::unix::io::FromRawFd::from_raw_fd(reader_fd),
				std::os::unix::io::FromRawFd::from_raw_fd(writer_fd),
			)
		}
	};

	#[cfg(windows)]
	let (reader_file, writer_file): (std::fs::File, std::fs::File) = {
		use std::os::windows::io::IntoRawHandle;
		let reader_handle = pipe_reader.into_raw_handle();
		let writer_handle = pipe_writer.into_raw_handle();
		// SAFETY: We just obtained these handles from os_pipe and own them exclusively.
		unsafe {
			(
				std::os::windows::io::FromRawHandle::from_raw_handle(reader_handle),
				std::os::windows::io::FromRawHandle::from_raw_handle(writer_handle),
			)
		}
	};

	let stdout_file = OpenFile::from(
		writer_file
			.try_clone()
			.map_err(|err| Error::from_reason(format!("Failed to clone pipe: {err}")))?,
	);
	let stderr_file = OpenFile::from(writer_file);

	let mut open_files = shell.open_files.clone();
	open_files.set(OpenFiles::STDOUT_FD, stdout_file);
	open_files.set(OpenFiles::STDERR_FD, stderr_file);

	let mut params = shell.default_exec_params();
	params.open_files = open_files;
	params.process_group_policy = ProcessGroupPolicy::NewProcessGroup;

	let reader_handle = task::spawn_blocking(move || read_output(reader_file, on_chunk));
	let result = shell
		.run_string(options.command, &params)
		.await
		.map_err(|err| Error::from_reason(format!("Shell execution failed: {err}")));

	// Drop shell and params to close write ends of pipes, allowing reader to finish
	drop(shell);
	drop(params);

	let _ = reader_handle.await;

	result
}

fn read_output(mut reader: std::fs::File, on_chunk: Option<ThreadsafeFunction<String>>) {
	let mut buf = [0u8; 8192];
	loop {
		let read = match reader.read(&mut buf) {
			Ok(0) => break,
			Ok(count) => count,
			Err(_) => break,
		};

		if let Some(callback) = on_chunk.as_ref() {
			let chunk = String::from_utf8_lossy(&buf[..read]).to_string();
			callback.call(Ok(chunk), ThreadsafeFunctionCallMode::NonBlocking);
		}
	}
}

#[cfg(unix)]
async fn attempt_kill_children() {
	let pid = std::process::id();
	let path = format!("/proc/{pid}/task/{pid}/children");
	let Ok(children) = std::fs::read_to_string(path) else {
		return;
	};
	let pids: Vec<i32> = children
		.split_whitespace()
		.filter_map(|pid| pid.parse::<i32>().ok())
		.collect();
	if pids.is_empty() {
		return;
	}

	for pid in &pids {
		// SAFETY: Sending SIGINT to child processes is safe; invalid pids are ignored.
		unsafe {
			libc::kill(*pid, libc::SIGINT);
		}
	}

	time::sleep(Duration::from_millis(50)).await;

	for pid in &pids {
		// SAFETY: Sending SIGKILL to child processes is safe; invalid pids are ignored.
		unsafe {
			libc::kill(*pid, libc::SIGKILL);
		}
	}
}

#[cfg(not(unix))]
async fn attempt_kill_children() {}
