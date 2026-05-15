"""Resume-aware behavior of `worker._run_rpc_blocking`.

These tests swap `robomp.worker.RpcClient` for a recording fake so we can
observe the `extra_args` and `set_todos` decisions the driver takes based on
whether the workspace's omp session directory already holds a JSONL transcript.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace

import pytest

from robomp import worker
from robomp.config import Settings


class _FakeRpcClient:
    instances: list[_FakeRpcClient] = []

    def __init__(self, **kwargs):
        self.kwargs = kwargs
        self.set_todos_calls: list[list[dict]] = []
        self.get_todos_calls = 0
        _FakeRpcClient.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def install_headless_ui(self) -> None:
        pass

    def on_tool_execution_end(self, _cb) -> None:
        pass

    def on_message_update(self, _cb) -> None:
        pass

    def stop(self) -> None:
        pass

    def set_todos(self, phases):
        self.set_todos_calls.append(phases)

    def get_todos(self):
        self.get_todos_calls += 1
        return ()

    def prompt_and_wait(self, prompt, timeout):
        class _Turn:
            messages: list = []
            events: list = []
            assistant_text: str = "ok"

        return _Turn()


_SEEDED_PHASES = [
    {
        "id": "p1",
        "name": "Reproduce",
        "tasks": [
            {
                "id": "t1",
                "content": "do it",
                "status": "pending",
                "notes": "",
                "details": "",
            }
        ],
    }
]


def _make_inputs(
    tmp_path: Path, settings: Settings, *, session_has_jsonl: bool, slot_uid: int | None = None
) -> tuple[worker.TaskInputs, SimpleNamespace]:
    session_dir = tmp_path / "session"
    session_dir.mkdir()
    if session_has_jsonl:
        (session_dir / "foo.jsonl").write_text("{}\n", encoding="utf-8")
    repo_dir = tmp_path / "repo"
    repo_dir.mkdir()

    workspace = SimpleNamespace(
        session_dir=session_dir,
        repo_dir=repo_dir,
        branch="robomp/issue-1",
    )
    repo = SimpleNamespace(full_name="acme/widgets", owner="acme", name="widgets")
    issue = SimpleNamespace(repo="acme/widgets", number=1, title="bug")

    db = SimpleNamespace(set_event_model=lambda _did, _model: None)
    github = SimpleNamespace()

    inputs = worker.TaskInputs(
        settings=settings,
        db=db,  # type: ignore[arg-type]
        github=github,  # type: ignore[arg-type]
        git_transport=SimpleNamespace(),  # type: ignore[arg-type]
        repo=repo,  # type: ignore[arg-type]
        issue=issue,  # type: ignore[arg-type]
        workspace=workspace,  # type: ignore[arg-type]
        delivery_id="d-test",
        attempts=0,
        slot_uid=slot_uid,
    )
    bindings = SimpleNamespace(
        workspace=workspace,
        repo=repo,
        issue=issue,
        issue_key=f"{repo.full_name}#{issue.number}",
    )
    return inputs, bindings


@pytest.fixture(autouse=True)
def _reset_fake() -> None:
    _FakeRpcClient.instances.clear()


@pytest.fixture(autouse=True)
def _patch_worker(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("robomp.worker.RpcClient", _FakeRpcClient)
    monkeypatch.setattr("robomp.worker.host_tools.build", lambda _b: ())
    monkeypatch.setattr(
        "robomp.worker.persona.system_append",
        lambda *, repo, issue, workspace: "SYS",
    )
    monkeypatch.setattr(
        "robomp.worker.persona.seed_phases",
        lambda _kind: [dict(p) for p in _SEEDED_PHASES],
    )


@pytest.mark.asyncio
async def test_run_rpc_passes_continue_when_session_jsonl_present(tmp_path: Path, settings: Settings) -> None:
    inputs, bindings = _make_inputs(tmp_path, settings, session_has_jsonl=True)
    loop = asyncio.new_event_loop()
    try:
        worker._run_rpc_blocking(
            inputs,
            task_kind="triage_issue",
            prompt="x",
            loop=loop,
            bindings=bindings,  # type: ignore[arg-type]
        )
    finally:
        loop.close()
    assert _FakeRpcClient.instances[0].kwargs["extra_args"] == ("--continue",)


@pytest.mark.asyncio
async def test_run_rpc_omits_continue_when_session_empty(
    tmp_path: Path, settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    agent_home = tmp_path / "agent-home"
    agent_home.mkdir()
    monkeypatch.setattr(worker, "_AGENT_HOME", agent_home)

    inputs, bindings = _make_inputs(tmp_path, settings, session_has_jsonl=False)
    loop = asyncio.new_event_loop()
    try:
        worker._run_rpc_blocking(
            inputs,
            task_kind="triage_issue",
            prompt="x",
            loop=loop,
            bindings=bindings,  # type: ignore[arg-type]
        )
    finally:
        loop.close()
    assert _FakeRpcClient.instances[0].kwargs["extra_args"] == ()
    client_kwargs = _FakeRpcClient.instances[0].kwargs
    assert client_kwargs["env"]["HOME"] == str(agent_home)
    assert client_kwargs["env"]["GITHUB_TOKEN"] == ""
    assert client_kwargs["env"]["GITHUB_WEBHOOK_SECRET"] == ""
    assert client_kwargs["env"]["ROBOMP_REPLAY_TOKEN"] == ""
    assert client_kwargs["env"]["ROBOMP_GH_PROXY_HMAC_KEY"] == ""
    assert client_kwargs["user"] is None
    assert client_kwargs["group"] is None
    assert client_kwargs["extra_groups"] is None


@pytest.mark.asyncio
async def test_run_rpc_omits_home_when_agent_home_absent(
    tmp_path: Path, settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(worker, "_AGENT_HOME", tmp_path / "missing-agent-home")

    inputs, bindings = _make_inputs(tmp_path, settings, session_has_jsonl=False)
    loop = asyncio.new_event_loop()
    try:
        worker._run_rpc_blocking(
            inputs,
            task_kind="triage_issue",
            prompt="x",
            loop=loop,
            bindings=bindings,  # type: ignore[arg-type]
        )
    finally:
        loop.close()
    client_kwargs = _FakeRpcClient.instances[0].kwargs
    assert "HOME" not in client_kwargs["env"]
    assert client_kwargs["env"]["GITHUB_TOKEN"] == ""
    assert client_kwargs["env"]["GITHUB_WEBHOOK_SECRET"] == ""
    assert client_kwargs["env"]["ROBOMP_REPLAY_TOKEN"] == ""
    assert client_kwargs["env"]["ROBOMP_GH_PROXY_HMAC_KEY"] == ""

@pytest.mark.asyncio
async def test_run_rpc_skips_set_todos_on_resumed_triage(tmp_path: Path, settings: Settings) -> None:
    inputs, bindings = _make_inputs(tmp_path, settings, session_has_jsonl=True)
    loop = asyncio.new_event_loop()
    try:
        worker._run_rpc_blocking(
            inputs,
            task_kind="triage_issue",
            prompt="x",
            loop=loop,
            bindings=bindings,  # type: ignore[arg-type]
        )
    finally:
        loop.close()
    assert _FakeRpcClient.instances[0].set_todos_calls == []


@pytest.mark.asyncio
async def test_run_rpc_seeds_todos_on_fresh_triage(tmp_path: Path, settings: Settings) -> None:
    inputs, bindings = _make_inputs(tmp_path, settings, session_has_jsonl=False)
    loop = asyncio.new_event_loop()
    try:
        worker._run_rpc_blocking(
            inputs,
            task_kind="triage_issue",
            prompt="x",
            loop=loop,
            bindings=bindings,  # type: ignore[arg-type]
        )
    finally:
        loop.close()
    calls = _FakeRpcClient.instances[0].set_todos_calls
    assert len(calls) == 1
    assert calls[0] == _SEEDED_PHASES


@pytest.mark.asyncio
async def test_run_rpc_merges_todos_on_followup_with_resume(tmp_path: Path, settings: Settings) -> None:
    inputs, bindings = _make_inputs(tmp_path, settings, session_has_jsonl=True)
    loop = asyncio.new_event_loop()
    try:
        worker._run_rpc_blocking(
            inputs,
            task_kind="handle_comment",
            prompt="x",
            loop=loop,
            bindings=bindings,  # type: ignore[arg-type]
        )
    finally:
        loop.close()
    client = _FakeRpcClient.instances[0]
    assert client.get_todos_calls == 1
    assert len(client.set_todos_calls) == 1
    assert len(client.set_todos_calls[0]) == len(_SEEDED_PHASES)


@pytest.mark.asyncio
async def test_run_rpc_passes_slot_uid_user_slot_group_and_omp_extra_group(
    tmp_path: Path, settings: Settings
) -> None:
    inputs, bindings = _make_inputs(tmp_path, settings, session_has_jsonl=False, slot_uid=2001)
    loop = asyncio.new_event_loop()
    try:
        worker._run_rpc_blocking(
            inputs,
            task_kind="triage_issue",
            prompt="x",
            loop=loop,
            bindings=bindings,  # type: ignore[arg-type]
        )
    finally:
        loop.close()
    client_kwargs = _FakeRpcClient.instances[0].kwargs
    assert client_kwargs["user"] == 2001
    assert client_kwargs["group"] == 2001
    assert client_kwargs["extra_groups"] == ["omp"]
