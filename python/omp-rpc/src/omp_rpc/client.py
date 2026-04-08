from __future__ import annotations

import json
import os
import queue
import subprocess
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence, TypeVar, cast

from .protocol import (
    AgentEndEvent,
    AgentMessage,
    AssistantMessage,
    BashResult,
    BranchMessage,
    BranchResult,
    CancellationResult,
    CompactionResult,
    ExtensionError,
    ExtensionUiRequest,
    ImageContent,
    InterruptMode,
    JsonObject,
    JsonValue,
    ModelCycleResult,
    ModelInfo,
    ReadyEvent,
    RpcAgentEvent,
    SessionState,
    SessionStats,
    SteeringMode,
    StreamingBehavior,
    ThinkingLevel,
    ThinkingLevelCycleResult,
    assistant_text,
    parse_bash_result,
    parse_branch_messages,
    parse_branch_result,
    parse_cancellation_result,
    parse_compaction_result,
    parse_model_cycle_result,
    parse_model_info,
    parse_notification,
    parse_session_state,
    parse_session_stats,
    parse_thinking_level_cycle_result,
)

AgentEventListener = Callable[[RpcAgentEvent], None]
UiRequestListener = Callable[[ExtensionUiRequest], None]
ExtensionErrorListener = Callable[[ExtensionError], None]
TListener = TypeVar("TListener")


class RpcError(RuntimeError):
    """Base exception for the Python RPC client."""


class RpcTimeoutError(RpcError):
    """Raised when the server does not respond before a timeout."""


class RpcProcessExitError(RpcError):
    """Raised when the RPC process exits while a request is pending."""


class RpcCommandError(RpcError):
    """Raised when the RPC server returns `success: false`."""

    def __init__(self, command: str, error: str):
        super().__init__(f"{command}: {error}")
        self.command = command
        self.error = error


@dataclass(slots=True, frozen=True)
class PromptTurn:
    events: tuple[RpcAgentEvent, ...]
    messages: tuple[AgentMessage, ...]
    assistant_message: AssistantMessage | None
    assistant_text: str | None

    def require_assistant_text(self) -> str:
        if self.assistant_text is None:
            raise RpcError("Prompt completed without a text assistant message")
        return self.assistant_text


class RpcClient:
    def __init__(
        self,
        *,
        command: Sequence[str] | None = None,
        executable: str = "omp",
        provider: str | None = None,
        model: str | None = None,
        session_dir: str | Path | None = None,
        cwd: str | Path | None = None,
        env: Mapping[str, str] | None = None,
        extra_args: Sequence[str] = (),
        startup_timeout: float = 30.0,
        request_timeout: float = 30.0,
    ) -> None:
        self._command = tuple(command) if command is not None else None
        self._executable = executable
        self._provider = provider
        self._model = model
        self._session_dir = Path(session_dir) if session_dir is not None else None
        self._cwd = Path(cwd) if cwd is not None else None
        self._env = dict(env or {})
        self._extra_args = tuple(extra_args)
        self._startup_timeout = startup_timeout
        self._request_timeout = request_timeout

        self._process: subprocess.Popen[str] | None = None
        self._stdout_thread: threading.Thread | None = None
        self._stderr_thread: threading.Thread | None = None
        self._ready = threading.Event()
        self._write_lock = threading.Lock()
        self._state_lock = threading.Lock()
        self._event_condition = threading.Condition()
        self._pending: dict[str, queue.Queue[JsonObject | BaseException]] = {}
        self._request_id = 0
        self._events: list[RpcAgentEvent] = []
        self._ui_requests: queue.Queue[ExtensionUiRequest] = queue.Queue()
        self._stderr_chunks: list[str] = []
        self._closed_error: BaseException | None = None
        self._stopping = False

        self._event_listeners: list[AgentEventListener] = []
        self._ui_request_listeners: list[UiRequestListener] = []
        self._extension_error_listeners: list[ExtensionErrorListener] = []

    def __enter__(self) -> RpcClient:
        return self.start()

    def __exit__(self, _exc_type: object, _exc: object, _tb: object) -> None:
        self.stop()

    @property
    def stderr(self) -> str:
        return "".join(self._stderr_chunks)

    @property
    def command(self) -> tuple[str, ...]:
        return self._build_command()

    def start(self) -> RpcClient:
        if self._process is not None:
            raise RpcError("RPC client is already started")

        self._ready.clear()
        self._stopping = False
        self._closed_error = None
        self._events.clear()
        self._ui_requests = queue.Queue()
        self._stderr_chunks.clear()

        process = subprocess.Popen(
            list(self._build_command()),
            cwd=str(self._cwd) if self._cwd is not None else None,
            env={**os.environ, **self._env},
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            bufsize=1,
        )
        self._process = process

        self._stdout_thread = threading.Thread(target=self._read_stdout_loop, name="omp-rpc-stdout", daemon=True)
        self._stderr_thread = threading.Thread(target=self._read_stderr_loop, name="omp-rpc-stderr", daemon=True)
        self._stdout_thread.start()
        self._stderr_thread.start()

        if not self._ready.wait(self._startup_timeout):
            stderr = self.stderr
            self.stop()
            raise RpcTimeoutError(f"Timed out waiting for RPC ready signal. Stderr: {stderr}")

        return self

    def stop(self) -> None:
        process = self._process
        if process is None:
            return

        self._stopping = True

        try:
            if process.stdin is not None:
                try:
                    process.stdin.close()
                except OSError:
                    pass

            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=1.0)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=1.0)
        finally:
            if process.stdout is not None:
                try:
                    process.stdout.close()
                except OSError:
                    pass
            if process.stderr is not None:
                try:
                    process.stderr.close()
                except OSError:
                    pass
            self._fail_pending(RpcProcessExitError("RPC process stopped"))
            self._process = None
            self._ready.set()
            with self._event_condition:
                self._event_condition.notify_all()
            if self._stdout_thread is not None:
                self._stdout_thread.join(timeout=1.0)
            if self._stderr_thread is not None:
                self._stderr_thread.join(timeout=1.0)
            self._stdout_thread = None
            self._stderr_thread = None

    def on_event(self, listener: AgentEventListener) -> Callable[[], None]:
        self._event_listeners.append(listener)
        return lambda: self._remove_listener(self._event_listeners, listener)

    def on_ui_request(self, listener: UiRequestListener) -> Callable[[], None]:
        self._ui_request_listeners.append(listener)
        return lambda: self._remove_listener(self._ui_request_listeners, listener)

    def on_extension_error(self, listener: ExtensionErrorListener) -> Callable[[], None]:
        self._extension_error_listeners.append(listener)
        return lambda: self._remove_listener(self._extension_error_listeners, listener)

    def next_ui_request(self, timeout: float | None = None) -> ExtensionUiRequest:
        try:
            return self._ui_requests.get(timeout=timeout)
        except queue.Empty as exc:
            raise RpcTimeoutError("Timed out waiting for an extension UI request") from exc

    def send_ui_value(self, request_id: str, value: str) -> None:
        self._send_notification({"type": "extension_ui_response", "id": request_id, "value": value})

    def send_ui_confirmation(self, request_id: str, confirmed: bool) -> None:
        self._send_notification({"type": "extension_ui_response", "id": request_id, "confirmed": confirmed})

    def cancel_ui_request(self, request_id: str, *, timed_out: bool = False) -> None:
        payload: JsonObject = {"type": "extension_ui_response", "id": request_id, "cancelled": True}
        if timed_out:
            payload["timedOut"] = True
        self._send_notification(payload)

    def get_state(self) -> SessionState:
        payload = self._request("get_state")
        return parse_session_state(payload)

    def set_model(self, provider: str, model_id: str) -> ModelInfo:
        payload = self._request("set_model", provider=provider, modelId=model_id)
        model = parse_model_info(payload)
        if model is None:
            raise RpcError("set_model returned an empty payload")
        return model

    def cycle_model(self) -> ModelCycleResult | None:
        return parse_model_cycle_result(self._request("cycle_model"))

    def get_available_models(self) -> tuple[ModelInfo, ...]:
        payload = self._request("get_available_models")
        models = cast(list[JsonObject], payload.get("models") or [])
        return tuple(filter(None, (parse_model_info(model) for model in models)))

    def set_thinking_level(self, level: ThinkingLevel) -> None:
        self._request("set_thinking_level", level=level)

    def cycle_thinking_level(self) -> ThinkingLevelCycleResult | None:
        return parse_thinking_level_cycle_result(self._request("cycle_thinking_level"))

    def set_steering_mode(self, mode: SteeringMode) -> None:
        self._request("set_steering_mode", mode=mode)

    def set_follow_up_mode(self, mode: SteeringMode) -> None:
        self._request("set_follow_up_mode", mode=mode)

    def set_interrupt_mode(self, mode: InterruptMode) -> None:
        self._request("set_interrupt_mode", mode=mode)

    def compact(self, custom_instructions: str | None = None) -> CompactionResult:
        payload = self._request("compact", customInstructions=custom_instructions)
        return parse_compaction_result(payload)

    def set_auto_compaction(self, enabled: bool) -> None:
        self._request("set_auto_compaction", enabled=enabled)

    def set_auto_retry(self, enabled: bool) -> None:
        self._request("set_auto_retry", enabled=enabled)

    def abort_retry(self) -> None:
        self._request("abort_retry")

    def bash(self, command: str) -> BashResult:
        payload = self._request("bash", command=command)
        return parse_bash_result(payload)

    def abort_bash(self) -> None:
        self._request("abort_bash")

    def get_session_stats(self) -> SessionStats:
        payload = self._request("get_session_stats")
        return parse_session_stats(payload)

    def export_html(self, output_path: str | Path | None = None) -> Path:
        payload = self._request("export_html", outputPath=str(output_path) if output_path is not None else None)
        return Path(str(payload["path"]))

    def new_session(self, parent_session: str | None = None) -> CancellationResult:
        return parse_cancellation_result(self._request("new_session", parentSession=parent_session))

    def switch_session(self, session_path: str | Path) -> CancellationResult:
        return parse_cancellation_result(self._request("switch_session", sessionPath=str(session_path)))

    def branch(self, entry_id: str) -> BranchResult:
        return parse_branch_result(self._request("branch", entryId=entry_id))

    def get_branch_messages(self) -> tuple[BranchMessage, ...]:
        return parse_branch_messages(self._request("get_branch_messages"))

    def get_last_assistant_text(self) -> str | None:
        payload = self._request("get_last_assistant_text")
        value = payload.get("text")
        return str(value) if isinstance(value, str) else None

    def set_session_name(self, name: str) -> None:
        self._request("set_session_name", name=name)

    def get_messages(self) -> tuple[AgentMessage, ...]:
        payload = self._request("get_messages")
        return tuple(cast(list[AgentMessage], payload.get("messages") or []))

    def prompt(
        self,
        message: str,
        *,
        images: Sequence[ImageContent] | None = None,
        streaming_behavior: StreamingBehavior | None = None,
    ) -> None:
        self._request(
            "prompt",
            message=message,
            images=list(images) if images is not None else None,
            streamingBehavior=streaming_behavior,
        )

    def steer(self, message: str, *, images: Sequence[ImageContent] | None = None) -> None:
        self._request("steer", message=message, images=list(images) if images is not None else None)

    def follow_up(self, message: str, *, images: Sequence[ImageContent] | None = None) -> None:
        self._request("follow_up", message=message, images=list(images) if images is not None else None)

    def abort(self) -> None:
        self._request("abort")

    def abort_and_prompt(self, message: str, *, images: Sequence[ImageContent] | None = None) -> None:
        self._request("abort_and_prompt", message=message, images=list(images) if images is not None else None)

    def prompt_and_wait(
        self,
        message: str,
        *,
        images: Sequence[ImageContent] | None = None,
        streaming_behavior: StreamingBehavior | None = None,
        timeout: float | None = None,
    ) -> PromptTurn:
        start_index = self._current_event_index()
        self.prompt(message, images=images, streaming_behavior=streaming_behavior)
        events = self._wait_for_agent_end(start_index, timeout=timeout)
        return self._build_prompt_turn(events)

    def wait_for_idle(self, timeout: float | None = None) -> None:
        start_index = self._current_event_index()
        self._wait_for_agent_end(start_index, timeout=timeout)

    def collect_events(self, timeout: float | None = None) -> tuple[RpcAgentEvent, ...]:
        start_index = self._current_event_index()
        return self._wait_for_agent_end(start_index, timeout=timeout)

    def request_raw(self, command_type: str, **payload: JsonValue) -> JsonObject:
        return self._request(command_type, **payload)

    def _current_event_index(self) -> int:
        with self._event_condition:
            return len(self._events)

    def _build_prompt_turn(self, events: tuple[RpcAgentEvent, ...]) -> PromptTurn:
        final_messages: tuple[AgentMessage, ...] = ()
        for event in reversed(events):
            if isinstance(event, AgentEndEvent):
                final_messages = event.messages
                break

        assistant_message: AssistantMessage | None = None
        for message in reversed(final_messages):
            if message.get("role") == "assistant":
                assistant_message = cast(AssistantMessage, message)
                break

        if assistant_message is None:
            for event in reversed(events):
                if hasattr(event, "message"):
                    message = cast(AgentMessage | None, getattr(event, "message", None))
                    if isinstance(message, dict) and message.get("role") == "assistant":
                        assistant_message = cast(AssistantMessage, message)
                        break

        return PromptTurn(
            events=events,
            messages=final_messages,
            assistant_message=assistant_message,
            assistant_text=assistant_text(assistant_message) if assistant_message is not None else None,
        )

    def _wait_for_agent_end(self, start_index: int, timeout: float | None = None) -> tuple[RpcAgentEvent, ...]:
        deadline = time.monotonic() + (timeout if timeout is not None else 60.0)
        with self._event_condition:
            while True:
                if self._closed_error is not None:
                    raise RpcProcessExitError(str(self._closed_error))

                events = tuple(self._events[start_index:])
                if any(isinstance(event, AgentEndEvent) for event in events):
                    return events

                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise RpcTimeoutError(f"Timed out waiting for agent_end. Stderr: {self.stderr}")
                self._event_condition.wait(remaining)

    def _request(self, command_type: str, **payload: JsonValue) -> JsonObject:
        process = self._require_process()
        request_id = self._next_request_id()
        envelope: JsonObject = {"id": request_id, "type": command_type}
        for key, value in payload.items():
            if value is not None:
                envelope[key] = value

        response_queue: queue.Queue[JsonObject | BaseException] = queue.Queue(maxsize=1)
        with self._state_lock:
            self._pending[request_id] = response_queue

        self._write_json(process, envelope)

        try:
            response = response_queue.get(timeout=self._request_timeout)
        except queue.Empty as exc:
            with self._state_lock:
                self._pending.pop(request_id, None)
            raise RpcTimeoutError(f"Timed out waiting for response to {command_type}. Stderr: {self.stderr}") from exc

        if isinstance(response, BaseException):
            raise response

        if not bool(response.get("success", False)):
            raise RpcCommandError(command=str(response.get("command", command_type)), error=str(response.get("error", "")))

        data = response.get("data")
        return dict(cast(JsonObject, data or {}))

    def _send_notification(self, payload: JsonObject) -> None:
        process = self._require_process()
        self._write_json(process, payload)

    def _build_command(self) -> tuple[str, ...]:
        if self._command is not None:
            return self._command

        command: list[str] = [self._executable, "--mode", "rpc"]
        if self._provider:
            command.extend(["--provider", self._provider])
        if self._model:
            command.extend(["--model", self._model])
        if self._session_dir is not None:
            command.extend(["--session-dir", str(self._session_dir)])
        command.extend(self._extra_args)
        return tuple(command)

    def _next_request_id(self) -> str:
        with self._state_lock:
            self._request_id += 1
            return f"req_{self._request_id}"

    def _require_process(self) -> subprocess.Popen[str]:
        if self._process is None:
            raise RpcError("RPC client is not started")
        return self._process

    def _write_json(self, process: subprocess.Popen[str], payload: JsonObject) -> None:
        if process.stdin is None:
            raise RpcProcessExitError("RPC process stdin is unavailable")
        with self._write_lock:
            try:
                process.stdin.write(json.dumps(payload))
                process.stdin.write("\n")
                process.stdin.flush()
            except (BrokenPipeError, OSError) as exc:
                raise RpcProcessExitError(f"Failed to write RPC command: {exc}") from exc

    def _read_stdout_loop(self) -> None:
        process = self._process
        if process is None or process.stdout is None:
            return

        try:
            for line in process.stdout:
                stripped = line.strip()
                if not stripped:
                    continue

                payload = cast(JsonObject, json.loads(stripped))
                if payload.get("type") == "response":
                    request_id = payload.get("id")
                    if isinstance(request_id, str):
                        with self._state_lock:
                            pending = self._pending.pop(request_id, None)
                        if pending is not None:
                            pending.put(payload)
                    continue

                notification = parse_notification(payload)
                if isinstance(notification, ReadyEvent):
                    self._ready.set()
                    continue

                if isinstance(notification, ExtensionUiRequest):
                    self._ui_requests.put(notification)
                    for listener in list(self._ui_request_listeners):
                        listener(notification)
                    continue

                if isinstance(notification, ExtensionError):
                    for listener in list(self._extension_error_listeners):
                        listener(notification)
                    continue

                if getattr(notification, "type", None) != "unknown":
                    with self._event_condition:
                        self._events.append(cast(RpcAgentEvent, notification))
                        self._event_condition.notify_all()
                    for listener in list(self._event_listeners):
                        listener(cast(RpcAgentEvent, notification))
        except json.JSONDecodeError as exc:
            self._mark_closed(RpcError(f"Failed to decode RPC output: {exc}"))
        except Exception as exc:
            self._mark_closed(exc)
        else:
            if not self._stopping:
                exit_code = process.poll()
                if exit_code is None:
                    try:
                        exit_code = process.wait(timeout=1.0)
                    except subprocess.TimeoutExpired:
                        self._mark_closed(RpcProcessExitError("RPC process stdout closed before the process exited"))
                        return
                self._mark_closed(RpcProcessExitError(f"RPC process exited with code {exit_code}. Stderr: {self.stderr}"))

    def _read_stderr_loop(self) -> None:
        process = self._process
        if process is None or process.stderr is None:
            return
        for chunk in process.stderr:
            self._stderr_chunks.append(chunk)

    def _mark_closed(self, error: BaseException) -> None:
        if self._closed_error is not None:
            return
        self._closed_error = error
        self._ready.set()
        self._fail_pending(error)
        with self._event_condition:
            self._event_condition.notify_all()

    def _fail_pending(self, error: BaseException) -> None:
        with self._state_lock:
            pending = list(self._pending.values())
            self._pending.clear()
        for response_queue in pending:
            response_queue.put(error)

    @staticmethod
    def _remove_listener(listeners: list[TListener], listener: TListener) -> None:
        try:
            listeners.remove(listener)
        except ValueError:
            pass
