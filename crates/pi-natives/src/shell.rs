//! Brush-based shell execution exported via N-API.
//!
//! # Overview
//! Executes shell commands in a non-interactive brush-core shell, streaming
//! output back to JavaScript via a threadsafe callback.
//!
//! # Example
//! ```ignore
//! const shell = new natives.Shell();
//! const result = await shell.run({ command: "ls" }, (chunk) => {
//!   console.log(chunk);
//! });
//! ```

use std::{
	collections::HashMap,
	fs,
	io::{self, Write},
	str,
	sync::{
		Arc, LazyLock,
		atomic::{AtomicU64, Ordering},
	},
	time::Duration,
};

#[cfg(windows)]
mod windows;

use brush_builtins::{BuiltinSet, default_builtins};
use brush_core::{
	CreateOptions, ExecutionContext, ExecutionControlFlow, ExecutionExitCode, ExecutionResult,
	ProcessGroupPolicy, Shell as BrushShell, ShellValue, ShellVariable, builtins,
	env::EnvironmentScope,
	openfiles::{self, OpenFile, OpenFiles},
};
use clap::Parser;
use napi::{
	bindgen_prelude::*,
	threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode},
	tokio::{self, sync::Mutex as TokioMutex, time},
};
use napi_derive::napi;
use parking_lot::Mutex;
use tokio::{io::AsyncReadExt as _, sync::oneshot};
use tokio_util::sync::CancellationToken;
#[cfg(windows)]
use windows::configure_windows_path;

use crate::work::launch_async;

type ExecutionMap = HashMap<u64, ExecutionControl>;

struct ExecutionControl {
	cancel:   oneshot::Sender<()>,
	shell_id: u64,
}

struct ExecutionGuard {
	execution_id: u64,
}

impl Drop for ExecutionGuard {
	fn drop(&mut self) {
		EXECUTIONS.lock().remove(&self.execution_id);
	}
}

struct ShellSessionCore {
	shell: BrushShell,
}

#[derive(Clone)]
struct ShellConfig {
	session_env:   Option<HashMap<String, String>>,
	snapshot_path: Option<String>,
}

static EXECUTIONS: LazyLock<Mutex<ExecutionMap>> = LazyLock::new(|| Mutex::new(HashMap::new()));
static SHELL_COUNTER: AtomicU64 = AtomicU64::new(1);
static EXECUTION_COUNTER: AtomicU64 = AtomicU64::new(1);

/// Options for configuring a persistent shell session.
#[napi(object)]
pub struct ShellOptions {
	/// Environment variables to apply once per session.
	pub session_env:   Option<HashMap<String, String>>,
	/// Optional snapshot file to source on session creation.
	pub snapshot_path: Option<String>,
}

/// Options for running a shell command.
#[napi(object)]
pub struct ShellRunOptions {
	/// Command string to execute in the shell.
	pub command:    String,
	/// Working directory for the command.
	pub cwd:        Option<String>,
	/// Environment variables to apply for this command only.
	pub env:        Option<HashMap<String, String>>,
	/// Timeout in milliseconds before cancelling the command.
	pub timeout_ms: Option<u32>,
}

/// Result of running a shell command.
#[napi(object)]
pub struct ShellRunResult {
	/// Exit code when the command completes normally.
	pub exit_code: Option<i32>,
	/// Whether the command was cancelled via abort.
	pub cancelled: bool,
	/// Whether the command timed out before completion.
	pub timed_out: bool,
}

/// Persistent brush-core shell session.
#[napi]
pub struct Shell {
	id:      u64,
	session: Arc<TokioMutex<Option<ShellSessionCore>>>,
	config:  ShellConfig,
}

#[napi]
impl Shell {
	#[napi(constructor)]
	/// Create a new shell session from optional configuration.
	///
	/// The options set session-scoped environment variables and a snapshot path.
	pub fn new(options: Option<ShellOptions>) -> Self {
		let id = SHELL_COUNTER.fetch_add(1, Ordering::Relaxed);
		let config = options.map_or_else(
			|| ShellConfig { session_env: None, snapshot_path: None },
			|opt| ShellConfig { session_env: opt.session_env, snapshot_path: opt.snapshot_path },
		);
		Self { id, session: Arc::new(TokioMutex::new(None)), config }
	}

	/// Run a shell command using the provided options.
	///
	/// The `on_chunk` callback receives streamed stdout/stderr output. Returns
	/// the exit code when the command completes, or flags when cancelled or
	/// timed out.
	#[napi]
	pub async fn run(
		&self,
		options: ShellRunOptions,
		#[napi(ts_arg_type = "((chunk: string) => void) | undefined | null")] on_chunk: Option<
			ThreadsafeFunction<String>,
		>,
	) -> Result<ShellRunResult> {
		let execution_id = EXECUTION_COUNTER.fetch_add(1, Ordering::Relaxed);
		let timeout_ms = options.timeout_ms;

		let (cancel_tx, cancel_rx) = oneshot::channel();
		{
			let mut executions = EXECUTIONS.lock();
			executions
				.insert(execution_id, ExecutionControl { cancel: cancel_tx, shell_id: self.id });
		}
		let _guard = ExecutionGuard { execution_id };

		let session = self.session.clone();
		let config = self.config.clone();
		let cancel_token = CancellationToken::new();

		let mut run_task = tokio::spawn({
			let cancel_token = cancel_token.clone();
			async move {
				let mut session_guard = session.lock().await;
				if session_guard.is_none() {
					*session_guard = Some(create_session(&config).await?);
				}
				let session_core = session_guard.as_mut().unwrap();
				run_shell_command(session_core, &options, on_chunk, cancel_token).await
			}
		});

		let mut cancelled = false;
		let mut timed_out = false;
		let mut tainted = false;

		let run_result = {
			let run_result = if let Some(ms) = timeout_ms {
				let timeout = time::sleep(Duration::from_millis(ms as u64));
				tokio::pin!(timeout);

				tokio::select! {
					result = &mut run_task => Some(result),
					_ = cancel_rx => {
						cancelled = true;
						cancel_token.cancel();
						None
					}
					() = &mut timeout => {
						timed_out = true;
						cancel_token.cancel();
						None
					}
				}
			} else {
				tokio::select! {
					result = &mut run_task => Some(result),
					_ = cancel_rx => {
						cancelled = true;
						cancel_token.cancel();
						None
					}
				}
			};

			if let Some(run_result) = run_result {
				let run_result = match run_result {
					Ok(result) => result,
					Err(err) => {
						*self.session.lock().await = None;
						return Err(Error::from_reason(format!("Shell execution task failed: {err}")));
					},
				};
				Some(run_result?)
			} else {
				match time::timeout(Duration::from_millis(1500), &mut run_task).await {
					Ok(Err(_)) => tainted = true,
					Err(_) => {
						tainted = true;
						run_task.abort();
					},
					_ => {},
				}
				None
			}
		};

		if tainted {
			*self.session.lock().await = None;
		}

		let Some(run_result) = run_result else {
			return Ok(ShellRunResult { exit_code: None, cancelled, timed_out });
		};

		if should_reset_session(&run_result) {
			*self.session.lock().await = None;
		}

		Ok(ShellRunResult { exit_code: Some(exit_code(&run_result)), cancelled, timed_out })
	}

	/// Abort all running commands for this shell session.
	///
	/// Returns `Ok(())` even when no commands are running.
	#[napi]
	pub fn abort(&self) -> Result<()> {
		let mut executions = EXECUTIONS.lock();
		let ids: Vec<u64> = executions
			.iter()
			.filter_map(|(id, ctrl)| (ctrl.shell_id == self.id).then_some(*id))
			.collect();
		for id in ids {
			if let Some(ctrl) = executions.remove(&id) {
				let _ = ctrl.cancel.send(());
			}
		}

		Ok(())
	}
}

/// Options for executing a shell command via brush-core.
#[napi(object)]
pub struct ShellExecuteOptions {
	/// Command string to execute in the shell.
	pub command:       String,
	/// Working directory for the command.
	pub cwd:           Option<String>,
	/// Environment variables to apply for this command only.
	pub env:           Option<HashMap<String, String>>,
	/// Environment variables to apply once per session.
	pub session_env:   Option<HashMap<String, String>>,
	/// Timeout in milliseconds before cancelling the command.
	pub timeout_ms:    Option<u32>,
	/// Unique identifier for this execution.
	pub execution_id:  u32,
	/// Optional snapshot file to source on session creation.
	pub snapshot_path: Option<String>,
}

/// Result of executing a shell command via brush-core.
#[napi(object)]
pub struct ShellExecuteResult {
	/// Exit code when the command completes normally.
	pub exit_code: Option<i32>,
	/// Whether the command was cancelled via abort.
	pub cancelled: bool,
	/// Whether the command timed out before completion.
	pub timed_out: bool,
}

/// Execute a brush shell command.
///
/// Creates a fresh session for each call. The `on_chunk` callback receives
/// streamed stdout/stderr output. Returns the exit code when the command
/// completes, or flags when cancelled or timed out.
#[napi]
pub async fn execute_shell(
	options: ShellExecuteOptions,
	#[napi(ts_arg_type = "((chunk: string) => void) | undefined | null")] on_chunk: Option<
		ThreadsafeFunction<String>,
	>,
) -> Result<ShellExecuteResult> {
	let execution_id = options.execution_id as u64;
	let timeout_ms = options.timeout_ms;

	let (cancel_tx, cancel_rx) = oneshot::channel();
	{
		let mut executions = EXECUTIONS.lock();
		if executions.contains_key(&execution_id) {
			return Err(Error::from_reason("Execution already running"));
		}
		executions.insert(execution_id, ExecutionControl { cancel: cancel_tx, shell_id: 0 });
	}
	let _guard = ExecutionGuard { execution_id };

	let config = ShellConfig {
		session_env:   options.session_env.clone(),
		snapshot_path: options.snapshot_path.clone(),
	};
	let run_options = ShellRunOptions {
		command:    options.command,
		cwd:        options.cwd,
		env:        options.env,
		timeout_ms: None, // handled below
	};

	let cancel_token = CancellationToken::new();

	let mut run_task = tokio::spawn({
		let cancel_token = cancel_token.clone();
		async move {
			let mut session = create_session(&config).await?;
			run_shell_command(&mut session, &run_options, on_chunk, cancel_token).await
		}
	});

	let mut cancelled = false;
	let mut timed_out = false;

	let run_result = {
		let run_result = if let Some(ms) = timeout_ms {
			let timeout = time::sleep(Duration::from_millis(ms as u64));
			tokio::pin!(timeout);

			tokio::select! {
				result = &mut run_task => Some(result),
				_ = cancel_rx => {
					cancelled = true;
					cancel_token.cancel();
					None
				}
				() = &mut timeout => {
					timed_out = true;
					cancel_token.cancel();
					None
				}
			}
		} else {
			tokio::select! {
				result = &mut run_task => Some(result),
				_ = cancel_rx => {
					cancelled = true;
					cancel_token.cancel();
					None
				}
			}
		};

		if let Some(run_result) = run_result {
			let run_result = match run_result {
				Ok(result) => result,
				Err(err) => {
					return Err(Error::from_reason(format!("Shell execution task failed: {err}")));
				},
			};
			Some(run_result?)
		} else {
			match time::timeout(Duration::from_millis(1500), &mut run_task).await {
				Ok(Err(_)) | Err(_) => {
					run_task.abort();
				},
				_ => {},
			}
			None
		}
	};

	let Some(run_result) = run_result else {
		return Ok(ShellExecuteResult { exit_code: None, cancelled, timed_out });
	};

	Ok(ShellExecuteResult { exit_code: Some(exit_code(&run_result)), cancelled, timed_out })
}

fn null_file() -> Result<OpenFile> {
	openfiles::null().map_err(|err| Error::from_reason(format!("Failed to create null file: {err}")))
}

const fn exit_code(result: &ExecutionResult) -> i32 {
	match result.exit_code {
		ExecutionExitCode::Success => 0,
		ExecutionExitCode::GeneralError => 1,
		ExecutionExitCode::InvalidUsage => 2,
		ExecutionExitCode::Unimplemented => 99,
		ExecutionExitCode::CannotExecute => 126,
		ExecutionExitCode::NotFound => 127,
		ExecutionExitCode::Interrupted => 130,
		ExecutionExitCode::Custom(code) => code as i32,
	}
}

/// Abort a running shell execution by ID.
///
/// Returns `Ok(())` even when the execution ID is not active.
#[napi]
pub fn abort_shell_execution(execution_id: u32) -> Result<()> {
	let mut executions = EXECUTIONS.lock();
	if let Some(control) = executions.remove(&(execution_id as u64)) {
		let _ = control.cancel.send(());
	}
	Ok(())
}

async fn create_session(config: &ShellConfig) -> Result<ShellSessionCore> {
	let create_options = CreateOptions {
		interactive: false,
		login: false,
		no_profile: true,
		no_rc: true,
		do_not_inherit_env: true,
		builtins: default_builtins(BuiltinSet::BashMode),
		..Default::default()
	};

	let mut shell = BrushShell::new(create_options)
		.await
		.map_err(|err| Error::from_reason(format!("Failed to initialize shell: {err}")))?;

	if let Some(exec_builtin) = shell.builtin_mut("exec") {
		exec_builtin.disabled = true;
	}
	if let Some(suspend_builtin) = shell.builtin_mut("suspend") {
		suspend_builtin.disabled = true;
	}
	shell.register_builtin("sleep", builtins::builtin::<SleepCommand>());
	shell.register_builtin("timeout", builtins::builtin::<TimeoutCommand>());

	for (key, value) in std::env::vars() {
		if should_skip_env_var(&key) {
			continue;
		}
		let mut var = ShellVariable::new(ShellValue::String(value));
		var.export();
		shell
			.env
			.set_global(key, var)
			.map_err(|err| Error::from_reason(format!("Failed to set env: {err}")))?;
	}

	if let Some(env) = config.session_env.as_ref() {
		for (key, value) in env {
			if should_skip_env_var(key) {
				continue;
			}
			let mut var = ShellVariable::new(ShellValue::String(value.clone()));
			var.export();
			shell
				.env
				.set_global(key.clone(), var)
				.map_err(|err| Error::from_reason(format!("Failed to set env: {err}")))?;
		}
	}

	#[cfg(windows)]
	configure_windows_path(&mut shell)?;

	if let Some(snapshot_path) = config.snapshot_path.as_ref() {
		source_snapshot(&mut shell, snapshot_path).await?;
	}

	Ok(ShellSessionCore { shell })
}

async fn source_snapshot(shell: &mut BrushShell, snapshot_path: &str) -> Result<()> {
	let mut params = shell.default_exec_params();
	params.set_fd(OpenFiles::STDIN_FD, null_file()?);
	params.set_fd(OpenFiles::STDOUT_FD, null_file()?);
	params.set_fd(OpenFiles::STDERR_FD, null_file()?);

	let escaped = snapshot_path.replace('\'', "'\\''");
	let command = format!("source '{escaped}'");
	shell
		.run_string(command, &params)
		.await
		.map_err(|err| Error::from_reason(format!("Failed to source snapshot: {err}")))?;
	Ok(())
}

async fn run_shell_command(
	session: &mut ShellSessionCore,
	options: &ShellRunOptions,
	on_chunk: Option<ThreadsafeFunction<String>>,
	cancel_token: CancellationToken,
) -> Result<ExecutionResult> {
	if let Some(cwd) = options.cwd.as_deref() {
		session
			.shell
			.set_working_dir(cwd)
			.map_err(|err| Error::from_reason(format!("Failed to set cwd: {err}")))?;
	}

	let (reader_file, writer_file) = pipe_to_files("output")?;

	let stdout_file = OpenFile::from(
		writer_file
			.try_clone()
			.map_err(|err| Error::from_reason(format!("Failed to clone pipe: {err}")))?,
	);
	let stderr_file = OpenFile::from(writer_file);

	let mut params = session.shell.default_exec_params();
	params.set_fd(OpenFiles::STDIN_FD, null_file()?);
	params.set_fd(OpenFiles::STDOUT_FD, stdout_file);
	params.set_fd(OpenFiles::STDERR_FD, stderr_file);
	params.process_group_policy = ProcessGroupPolicy::NewProcessGroup;
	params.set_cancel_token(cancel_token);

	let mut env_scope_pushed = false;
	if let Some(env) = options.env.as_ref() {
		session.shell.env.push_scope(EnvironmentScope::Command);
		env_scope_pushed = true;
		for (key, value) in env {
			if should_skip_env_var(key) {
				continue;
			}
			let mut var = ShellVariable::new(ShellValue::String(value.clone()));
			var.export();
			if let Err(err) = session
				.shell
				.env
				.add(key.clone(), var, EnvironmentScope::Command)
			{
				let _ = session.shell.env.pop_scope(EnvironmentScope::Command);
				return Err(Error::from_reason(format!("Failed to set env: {err}")));
			}
		}
	}

	let reader_handle = launch_async("shell.read_output", async move {
		read_output(reader_file, on_chunk).await;
		Ok(())
	});
	let result = session
		.shell
		.run_string(options.command.clone(), &params)
		.await;

	if env_scope_pushed {
		session
			.shell
			.env
			.pop_scope(EnvironmentScope::Command)
			.map_err(|err| Error::from_reason(format!("Failed to pop env scope: {err}")))?;
	}

	drop(params);

	let () = reader_handle.wait().await?;

	result.map_err(|err| Error::from_reason(format!("Shell execution failed: {err}")))
}

fn should_skip_env_var(key: &str) -> bool {
	if key.starts_with("BASH_FUNC_") && key.ends_with("%%") {
		return true;
	}

	matches!(
		key,
		"BASH_ENV"
			| "ENV"
			| "HISTFILE"
			| "HISTTIMEFORMAT"
			| "HISTCMD"
			| "PS0"
			| "PS1"
			| "PS2"
			| "PS4"
			| "BRUSH_PS_ALT"
			| "READLINE_LINE"
			| "READLINE_POINT"
			| "BRUSH_VERSION"
			| "BASH"
			| "BASHOPTS"
			| "BASH_ALIASES"
			| "BASH_ARGV0"
			| "BASH_CMDS"
			| "BASH_SOURCE"
			| "BASH_SUBSHELL"
			| "BASH_VERSINFO"
			| "BASH_VERSION"
			| "SHELLOPTS"
			| "SHLVL"
			| "SHELL"
			| "COMP_WORDBREAKS"
			| "DIRSTACK"
			| "EPOCHREALTIME"
			| "EPOCHSECONDS"
			| "FUNCNAME"
			| "GROUPS"
			| "IFS"
			| "LINENO"
			| "MACHTYPE"
			| "OSTYPE"
			| "OPTERR"
			| "OPTIND"
			| "PIPESTATUS"
			| "PPID"
			| "PWD"
			| "OLDPWD"
			| "RANDOM"
			| "SRANDOM"
			| "SECONDS"
			| "UID"
			| "EUID"
			| "HOSTNAME"
			| "HOSTTYPE"
	)
}

const fn should_reset_session(result: &ExecutionResult) -> bool {
	match result.next_control_flow {
		ExecutionControlFlow::Normal => false,
		ExecutionControlFlow::BreakLoop { .. } => true,
		ExecutionControlFlow::ContinueLoop { .. } => true,
		ExecutionControlFlow::ReturnFromFunctionOrScript => true,
		ExecutionControlFlow::ExitShell => true,
	}
}

async fn read_output(reader: fs::File, on_chunk: Option<ThreadsafeFunction<String>>) {
	const REPLACEMENT: &str = "\u{FFFD}";
	const BUF: usize = 4096;
	let mut buf = [0u8; BUF + 4]; // +4 for max UTF-8 char
	let mut it = 0;

	let reader = tokio::fs::File::from_std(reader);
	tokio::pin!(reader);

	loop {
		let n = match reader.read(&mut buf[it..BUF]).await {
			Ok(0) => break, // EOF
			Ok(n) => n,
			Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
			Err(_) => break,
		};
		it += n;

		// Consume as much of `pending` as is decodable *right now*.
		while it > 0 {
			let pending = &buf[..it];
			match str::from_utf8(pending) {
				Ok(text) => {
					emit_chunk(text, on_chunk.as_ref());
					it = 0;
					break;
				},
				Err(err) => {
					let p = err.valid_up_to();
					if p > 0 {
						// SAFETY: [..p] is guaranteed valid UTF-8 by valid_up_to().
						let text = unsafe { str::from_utf8_unchecked(&pending[..p]) };
						emit_chunk(text, on_chunk.as_ref());
						// copy p..it to the beginning of the buffer
						buf.copy_within(p..it, 0);
						it -= p;
					}

					match err.error_len() {
						Some(p) => {
							// Invalid byte sequence: emit replacement and drop those bytes.
							emit_chunk(REPLACEMENT, on_chunk.as_ref());
							// copy p..it to the beginning of the buffer
							buf.copy_within(p..it, 0);
							it -= p;
							// continue loop in case more bytes remain after the
							// invalid sequence
						},
						None => {
							// Incomplete UTF-8 sequence at end: keep bytes for next read.
							break;
						},
					}
				},
			}
		}
	}

	// Flush whatever is left at EOF (including an incomplete final sequence).
	for chunk in buf[..it].utf8_chunks() {
		let valid = chunk.valid();
		if !valid.is_empty() {
			emit_chunk(valid, on_chunk.as_ref());
		}
		if !chunk.invalid().is_empty() {
			emit_chunk(REPLACEMENT, on_chunk.as_ref());
		}
	}
}

fn emit_chunk(text: &str, callback: Option<&ThreadsafeFunction<String>>) {
	if let Some(callback) = callback {
		callback.call(Ok(text.to_string()), ThreadsafeFunctionCallMode::NonBlocking);
	}
}

fn pipe_to_files(label: &str) -> Result<(fs::File, fs::File)> {
	let (r, w) = os_pipe::pipe()
		.map_err(|err| Error::from_reason(format!("Failed to create {label} pipe: {err}")))?;

	#[cfg(unix)]
	let (r, w): (fs::File, fs::File) = {
		use std::os::unix::io::{FromRawFd, IntoRawFd};
		let r = r.into_raw_fd();
		let w = w.into_raw_fd();
		// SAFETY: We just obtained these fds from os_pipe and own them exclusively.
		unsafe { (FromRawFd::from_raw_fd(r), FromRawFd::from_raw_fd(w)) }
	};

	#[cfg(windows)]
	let (r, w): (fs::File, fs::File) = {
		use std::os::windows::io::{FromRawHandle, IntoRawHandle};
		let r = r.into_raw_handle();
		let w = w.into_raw_handle();
		// SAFETY: We just obtained these handles from os_pipe and own them exclusively.
		unsafe { (FromRawHandle::from_raw_handle(r), FromRawHandle::from_raw_handle(w)) }
	};

	Ok((r, w))
}

#[derive(Parser)]
#[command(disable_help_flag = true)]
struct SleepCommand {
	#[arg(required = true)]
	durations: Vec<String>,
}

impl builtins::Command for SleepCommand {
	type Error = brush_core::Error;

	fn execute(
		&self,
		context: ExecutionContext<'_>,
	) -> impl Future<Output = std::result::Result<ExecutionResult, brush_core::Error>> + Send {
		let durations = self.durations.clone();
		async move {
			if context.is_cancelled() {
				return Ok(ExecutionExitCode::Interrupted.into());
			}
			let mut total = Duration::from_millis(0);
			for duration in &durations {
				let Some(parsed) = parse_duration(duration) else {
					let _ = writeln!(context.stderr(), "sleep: invalid time interval '{duration}'");
					return Ok(ExecutionResult::new(1));
				};
				total += parsed;
			}
			let sleep = time::sleep(total);
			tokio::pin!(sleep);
			if let Some(cancel_token) = context.cancel_token() {
				tokio::select! {
					() = &mut sleep => Ok(ExecutionResult::success()),
					() = cancel_token.cancelled() => Ok(ExecutionExitCode::Interrupted.into()),
				}
			} else {
				sleep.await;
				Ok(ExecutionResult::success())
			}
		}
	}
}

#[derive(Parser)]
#[command(disable_help_flag = true)]
struct TimeoutCommand {
	#[arg(required = true)]
	duration: String,
	#[arg(required = true, num_args = 1.., trailing_var_arg = true)]
	command:  Vec<String>,
}

impl builtins::Command for TimeoutCommand {
	type Error = brush_core::Error;

	fn execute(
		&self,
		context: ExecutionContext<'_>,
	) -> impl Future<Output = std::result::Result<ExecutionResult, brush_core::Error>> + Send {
		let duration = self.duration.clone();
		let command = self.command.clone();
		async move {
			if context.is_cancelled() {
				return Ok(ExecutionExitCode::Interrupted.into());
			}
			let Some(timeout) = parse_duration(&duration) else {
				let _ = writeln!(context.stderr(), "timeout: invalid time interval '{duration}'");
				return Ok(ExecutionResult::new(125));
			};
			if command.is_empty() {
				let _ = writeln!(context.stderr(), "timeout: missing command");
				return Ok(ExecutionResult::new(125));
			}

			let mut params = context.params.clone();
			params.process_group_policy = ProcessGroupPolicy::NewProcessGroup;

			let mut command_line = String::new();
			for (idx, arg) in command.iter().enumerate() {
				if idx > 0 {
					command_line.push(' ');
				}
				command_line.push_str(&quote_arg(arg));
			}

			let cancel_token = context.cancel_token();
			let run_future = context.shell.run_string(command_line, &params);
			tokio::pin!(run_future);

			if let Some(cancel_token) = cancel_token {
				tokio::select! {
					result = &mut run_future => result,
					() = time::sleep(timeout) => Ok(ExecutionResult::new(124)),
					() = cancel_token.cancelled() => Ok(ExecutionExitCode::Interrupted.into()),
				}
			} else {
				tokio::select! {
					result = &mut run_future => result,
					() = time::sleep(timeout) => Ok(ExecutionResult::new(124)),
				}
			}
		}
	}
}
fn parse_duration(input: &str) -> Option<Duration> {
	let trimmed = input.trim();
	if trimmed.is_empty() {
		return None;
	}
	let (number, multiplier) = match trimmed.chars().last()? {
		's' => (&trimmed[..trimmed.len() - 1], 1.0),
		'm' => (&trimmed[..trimmed.len() - 1], 60.0),
		'h' => (&trimmed[..trimmed.len() - 1], 3600.0),
		'd' => (&trimmed[..trimmed.len() - 1], 86400.0),
		ch if ch.is_ascii_alphabetic() => return None,
		_ => (trimmed, 1.0),
	};
	let value = number.parse::<f64>().ok()?;
	if value.is_sign_negative() {
		return None;
	}
	let millis = value * multiplier * 1000.0;
	if !millis.is_finite() || millis < 0.0 {
		return None;
	}
	Some(Duration::from_millis(millis.round() as u64))
}

fn quote_arg(arg: &str) -> String {
	if arg.is_empty() {
		return "''".to_string();
	}
	let safe = arg
		.chars()
		.all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | '/' | ':' | '+'));
	if safe {
		return arg.to_string();
	}
	let escaped = arg.replace('\'', "'\"'\"'");
	format!("'{escaped}'")
}
