//! Brush-based shell execution exported via N-API.
//!
//! # Overview
//! Executes shell commands in a non-interactive brush-core shell, streaming
//! output back to JavaScript via a threadsafe callback.
//!
//! # Example
//! ```ignore
//! const shell = new natives.Shell();
//! const result = await shell.run({ command: "ls" }, (err, chunk) => {
//!   if (err) return;
//!   console.log(chunk);
//! });
//! ```

use std::{
	collections::HashMap,
	io::{Read, Write},
	sync::{
		Arc, LazyLock,
		atomic::{AtomicU64, Ordering},
	},
	time::Duration,
};

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
use tokio_util::sync::CancellationToken;

use crate::work::launch_task;

type ExecutionMap = HashMap<String, ExecutionControl>;
type SessionMap = HashMap<String, Arc<TokioMutex<ShellSession>>>;

struct ExecutionControl {
	cancel:      tokio::sync::oneshot::Sender<()>,
	session_key: String,
}



struct ExecutionGuard {
	execution_id: String,
}

impl Drop for ExecutionGuard {
	fn drop(&mut self) {
		let mut executions = EXECUTIONS.lock();
		executions.remove(&self.execution_id);
	}
}

struct ShellSession {
	shell: BrushShell,
}

static EXECUTIONS: LazyLock<Mutex<ExecutionMap>> = LazyLock::new(|| Mutex::new(HashMap::new()));
static SESSIONS: LazyLock<Mutex<SessionMap>> = LazyLock::new(|| Mutex::new(HashMap::new()));
static SESSION_COUNTER: AtomicU64 = AtomicU64::new(1);
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
	session_key:   String,
	session_env:   Option<HashMap<String, String>>,
	snapshot_path: Option<String>,
}

#[napi]
impl Shell {
	#[napi(constructor)]
	/// Create a new shell session from optional configuration.
	///
	/// The options set session-scoped environment variables and a snapshot path.
	pub fn new(options: Option<ShellOptions>) -> Self {
		let session_key = next_session_key();
		let (session_env, snapshot_path) =
			options.map_or((None, None), |opt| (opt.session_env, opt.snapshot_path));
		Self { session_key, session_env, snapshot_path }
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
		#[napi(ts_arg_type = "((error: Error | null, chunk: string) => void) | undefined | null")]
		on_chunk: Option<ThreadsafeFunction<String>>,
	) -> Result<ShellRunResult> {
		let execution_id = next_execution_id();

		let execute_options = ShellExecuteOptions {
			command: options.command,
			cwd: options.cwd,
			env: options.env,
			session_env: self.session_env.clone(),
			timeout_ms: options.timeout_ms,
			execution_id,
			session_key: self.session_key.clone(),
			snapshot_path: self.snapshot_path.clone(),
		};

		execute_shell_with_options(execute_options, on_chunk)
			.await
			.map(|result| ShellRunResult {
				exit_code: result.exit_code,
				cancelled: result.cancelled,
				timed_out: result.timed_out,
			})
	}

	/// Abort all running commands for this shell session.
	///
	/// Returns `Ok(())` even when no commands are running.
	#[napi]
	pub fn abort(&self) -> Result<()> {
		let execution_ids: Vec<String> = {
			let executions = EXECUTIONS.lock();
			executions
				.iter()
				.filter(|(_, control)| control.session_key == self.session_key)
				.map(|(execution_id, _)| execution_id.clone())
				.collect()
		};

		for execution_id in execution_ids {
			abort_shell_execution(execution_id)?;
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
	pub execution_id:  String,
	/// Session key for a persistent brush shell instance.
	pub session_key:   String,
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

/// Execute a brush shell command with explicit session metadata.
///
/// The `on_chunk` callback receives streamed stdout/stderr output. Returns the
/// exit code when the command completes, or flags when cancelled or timed out.
#[napi]
pub async fn execute_shell(
	options: ShellExecuteOptions,
	#[napi(ts_arg_type = "((chunk: string) => void) | undefined | null")] on_chunk: Option<
		ThreadsafeFunction<String>,
	>,
) -> Result<ShellExecuteResult> {
	execute_shell_with_options(options, on_chunk).await
}

async fn execute_shell_with_options(
	options: ShellExecuteOptions,
	on_chunk: Option<ThreadsafeFunction<String>>,
) -> Result<ShellExecuteResult> {
	let execution_id = options.execution_id.clone();
	let timeout_ms = options.timeout_ms;

	let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel();
	{
		let mut executions = EXECUTIONS.lock();
		if executions.contains_key(&execution_id) {
			return Err(Error::from_reason("Execution already running"));
		}
		executions.insert(execution_id.clone(), ExecutionControl {
			cancel:      cancel_tx,
			session_key: options.session_key.clone(),
		});
	}
	let _guard = ExecutionGuard { execution_id };

	let session = get_or_create_session(&options).await?;
	let cancel_token = CancellationToken::new();

	let mut cancelled = false;
	let mut timed_out = false;
	let mut tainted = false;

	let run_result = {
		let mut session = session.lock().await;
		let run_future =
			run_shell_command(&mut session, &options, on_chunk, cancel_token.clone());
		tokio::pin!(run_future);

		let run_result = if let Some(ms) = timeout_ms {
			let timeout = time::sleep(Duration::from_millis(u64::from(ms)));
			tokio::pin!(timeout);

			tokio::select! {
				result = &mut run_future => Some(result),
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
				result = &mut run_future => Some(result),
				_ = cancel_rx => {
					cancelled = true;
					cancel_token.cancel();
					None
				}
			}
		};

		if let Some(run_result) = run_result {
			Some(
				run_result
					.map_err(|err| Error::from_reason(format!("Shell execution failed: {err}")))?,
			)
		} else {
			if time::timeout(Duration::from_millis(1500), &mut run_future)
				.await
				.is_err()
			{
				tainted = true;
			}
			None
		}
	};

	if tainted {
		remove_session(&options.session_key);
	}

	let Some(run_result) = run_result else {
		return Ok(ShellExecuteResult { exit_code: None, cancelled, timed_out });
	};

	if should_reset_session(&run_result) {
		remove_session(&options.session_key);
	}

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
pub fn abort_shell_execution(execution_id: String) -> Result<()> {
	let mut executions = EXECUTIONS.lock();
	if let Some(control) = executions.remove(&execution_id) {
		let _ = control.cancel.send(());
	}
	Ok(())
}

async fn get_or_create_session(
	options: &ShellExecuteOptions,
) -> Result<Arc<TokioMutex<ShellSession>>> {
	if let Some(session) = { SESSIONS.lock().get(&options.session_key).cloned() } {
		return Ok(session);
	}

	let session = Arc::new(TokioMutex::new(create_session(options).await?));

	let mut sessions = SESSIONS.lock();
	if let Some(existing) = sessions.get(&options.session_key) {
		return Ok(existing.clone());
	}

	sessions.insert(options.session_key.clone(), session.clone());
	Ok(session)
}

async fn create_session(options: &ShellExecuteOptions) -> Result<ShellSession> {
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

	if let Some(env) = options.session_env.as_ref() {
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

	if let Some(snapshot_path) = options.snapshot_path.as_ref() {
		source_snapshot(&mut shell, snapshot_path).await?;
	}

	Ok(ShellSession { shell })
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
	session: &mut ShellSession,
	options: &ShellExecuteOptions,
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

	if let Some(env) = options.env.as_ref() {
		session.shell.env.push_scope(EnvironmentScope::Command);
		for (key, value) in env {
			if should_skip_env_var(key) {
				continue;
			}
			let mut var = ShellVariable::new(ShellValue::String(value.clone()));
			var.export();
			session
				.shell
				.env
				.add(key.clone(), var, EnvironmentScope::Command)
				.map_err(|err| Error::from_reason(format!("Failed to set env: {err}")))?;
		}
	}

	let reader_handle = launch_task(move || -> Result<()> {
		read_output(reader_file, on_chunk);
		Ok(())
	});
	let result = session
		.shell
		.run_string(options.command.clone(), &params)
		.await;

	if options.env.is_some() {
		session
			.shell
			.env
			.pop_scope(EnvironmentScope::Command)
			.map_err(|err| Error::from_reason(format!("Failed to pop env scope: {err}")))?;
	}

	drop(params);

	let _: Result<()> = reader_handle.wait().await;

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

fn next_session_key() -> String {
	let counter = SESSION_COUNTER.fetch_add(1, Ordering::Relaxed);
	format!("shell-{}-{counter}", std::process::id())
}

fn next_execution_id() -> String {
	let counter = EXECUTION_COUNTER.fetch_add(1, Ordering::Relaxed);
	format!("exec-{}-{counter}", std::process::id())
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

fn remove_session(session_key: &str) {
	let mut sessions = SESSIONS.lock();
	sessions.remove(session_key);
}


fn read_output(mut reader: std::fs::File, on_chunk: Option<ThreadsafeFunction<String>>) {
	let mut buf = [0u8; 8192];
	let mut pending = Vec::new();
	loop {
		let read = match reader.read(&mut buf) {
			Ok(0) => break,
			Ok(count) => count,
			Err(_) => break,
		};

		pending.extend_from_slice(&buf[..read]);
		let mut start = 0;
		while start < pending.len() {
			match std::str::from_utf8(&pending[start..]) {
				Ok(text) => {
					emit_chunk(text, on_chunk.as_ref());
					pending.clear();
					break;
				},
				Err(err) => {
					let valid = err.valid_up_to();
					if valid > 0 {
						let text = String::from_utf8_lossy(&pending[start..start + valid]);
						emit_chunk(&text, on_chunk.as_ref());
						start += valid;
					}

					if err.error_len().is_some() {
						start += 1;
						continue;
					}

					pending = pending.split_off(start);
					break;
				},
			}
		}
	}

	if !pending.is_empty() {
		let text = String::from_utf8_lossy(&pending);
		emit_chunk(&text, on_chunk.as_ref());
	}
}

fn emit_chunk(text: &str, callback: Option<&ThreadsafeFunction<String>>) {
	if let Some(callback) = callback {
		callback.call(Ok(text.to_string()), ThreadsafeFunctionCallMode::Blocking);
	}
}

fn pipe_to_files(label: &str) -> Result<(std::fs::File, std::fs::File)> {
	let (pipe_reader, pipe_writer) = os_pipe::pipe()
		.map_err(|err| Error::from_reason(format!("Failed to create {label} pipe: {err}")))?;

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

	Ok((reader_file, writer_file))
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
				_ = cancel_token.cancelled() => Ok(ExecutionExitCode::Interrupted.into()),
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
		let result = if let Some(cancel_token) = cancel_token {
			tokio::select! {
				result = &mut run_future => result,
				() = time::sleep(timeout) => Ok(ExecutionResult::new(124)),
				_ = cancel_token.cancelled() => Ok(ExecutionExitCode::Interrupted.into()),
			}
		} else {
			tokio::select! {
				result = &mut run_future => result,
				() = time::sleep(timeout) => Ok(ExecutionResult::new(124)),
			}
			};
			Ok(result?)
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
