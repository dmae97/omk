"""Host tool tests against a mocked GitHub via httpx.MockTransport."""

from __future__ import annotations

import asyncio
import json
import threading
from pathlib import Path
from typing import Any

import httpx
import pytest
from omp_rpc import HostToolContext, RpcCommandError

from robomp.db import Database
from robomp.github_client import GitHubClient, IssueInfo, RepoInfo
from robomp.host_tools import ToolBindings, build
from robomp.sandbox import LocalGitTransport, Workspace


def _stub_workspace(tmp_path: Path) -> Workspace:
    root = tmp_path / "ws"
    repo_dir = root / "repo"
    session_dir = root / ".omp-session"
    context_dir = root / "context"
    artifacts_dir = root / "artifacts"
    for p in (root, repo_dir, session_dir, context_dir, context_dir / "repro", artifacts_dir):
        p.mkdir(parents=True, exist_ok=True)
    return Workspace(
        root=root,
        repo_dir=repo_dir,
        session_dir=session_dir,
        context_dir=context_dir,
        artifacts_dir=artifacts_dir,
        branch="farm/abc12345/some-issue",
        repo_full_name="octo/widget",
        issue_number=42,
    )


def _stub_issue() -> IssueInfo:
    return IssueInfo(
        repo="octo/widget",
        number=42,
        title="boom",
        body="b",
        state="open",
        author="alice",
        labels=("bug",),
        is_pull_request=False,
    )


def _stub_repo() -> RepoInfo:
    return RepoInfo(
        full_name="octo/widget",
        default_branch="main",
        clone_url="https://x/octo/widget.git",
        private=False,
    )


def _make_loop_in_background() -> tuple[asyncio.AbstractEventLoop, threading.Thread]:
    loop = asyncio.new_event_loop()
    t = threading.Thread(target=loop.run_forever, daemon=True)
    t.start()
    return loop, t


def _stop_loop(loop: asyncio.AbstractEventLoop, t: threading.Thread) -> None:
    loop.call_soon_threadsafe(loop.stop)
    t.join(timeout=2.0)
    loop.close()


def _bindings(
    db: Database, tmp_path: Path, transport: httpx.MockTransport
) -> tuple[ToolBindings, asyncio.AbstractEventLoop, threading.Thread]:
    github = GitHubClient("token", transport=transport)
    loop, thread = _make_loop_in_background()
    bindings = ToolBindings(
        db=db,
        github=github,
        git_transport=LocalGitTransport(token=None),
        repo=_stub_repo(),
        issue=_stub_issue(),
        workspace=_stub_workspace(tmp_path),
        loop=loop,
        author_name="robomp-bot",
        author_email="robomp-bot@example.invalid",
    )
    db.upsert_issue(
        key=bindings.issue_key,
        repo="octo/widget",
        number=42,
        state="reproducing",
        branch=bindings.workspace.branch,
        session_dir=str(bindings.workspace.session_dir),
    )
    return bindings, loop, thread


def _ctx() -> HostToolContext[Any]:
    return HostToolContext(tool_call_id="tc-1", _cancel_event=threading.Event(), _send_update=lambda _payload: None)


def test_gh_post_comment_happy_path(db: Database, tmp_path: Path) -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["body"] = json.loads(request.content)
        captured["auth"] = request.headers.get("authorization")
        return httpx.Response(201, json={"id": 999, "user": {"login": "robomp-bot"}, "body": "hi", "created_at": "t"})

    transport = httpx.MockTransport(handler)
    bindings, loop, t = _bindings(db, tmp_path, transport)
    try:
        tool = next(x for x in build(bindings) if x.name == "gh_post_comment")
        result = tool.execute({"body": "hi"}, _ctx())
    finally:
        _stop_loop(loop, t)

    assert result.startswith("comment posted")
    assert captured["url"].endswith("/repos/octo/widget/issues/42/comments")
    assert captured["body"] == {"body": "hi"}
    assert captured["auth"] == "Bearer token"


def test_gh_post_comment_validates_body(db: Database, tmp_path: Path) -> None:
    bindings, loop, t = _bindings(db, tmp_path, httpx.MockTransport(lambda r: httpx.Response(500)))
    try:
        tool = next(x for x in build(bindings) if x.name == "gh_post_comment")
        with pytest.raises(RpcCommandError):
            tool.execute({"body": ""}, _ctx())
    finally:
        _stop_loop(loop, t)


def test_gh_post_comment_defaults_to_inbound_pr_thread(db: Database, tmp_path: Path) -> None:
    """PR conversation/review tasks set inbound_thread_number to the PR; the
    agent's reply must land on that PR by default, not the originating issue."""
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        return httpx.Response(201, json={"id": 7, "user": {"login": "robomp-bot"}, "body": "hi", "created_at": "t"})

    transport = httpx.MockTransport(handler)
    github = GitHubClient("token", transport=transport)
    loop, thread = _make_loop_in_background()
    bindings = ToolBindings(
        db=db,
        github=github,
        git_transport=LocalGitTransport(token=None),
        repo=_stub_repo(),
        issue=_stub_issue(),  # issue #42
        workspace=_stub_workspace(tmp_path),
        loop=loop,
        author_name="robomp-bot",
        author_email="robomp-bot@example.invalid",
        inbound_thread_number=99,  # PR #99 that fixes issue #42
    )
    try:
        tool = next(x for x in build(bindings) if x.name == "gh_post_comment")
        tool.execute({"body": "hi"}, _ctx())
    finally:
        _stop_loop(loop, thread)

    assert captured["url"].endswith("/repos/octo/widget/issues/99/comments"), captured["url"]


def test_gh_post_comment_explicit_number_overrides_inbound(db: Database, tmp_path: Path) -> None:
    """An explicit `number` arg still wins over the inbound default."""
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        return httpx.Response(201, json={"id": 7, "user": {"login": "robomp-bot"}, "body": "hi", "created_at": "t"})

    transport = httpx.MockTransport(handler)
    github = GitHubClient("token", transport=transport)
    loop, thread = _make_loop_in_background()
    bindings = ToolBindings(
        db=db,
        github=github,
        git_transport=LocalGitTransport(token=None),
        repo=_stub_repo(),
        issue=_stub_issue(),
        workspace=_stub_workspace(tmp_path),
        loop=loop,
        author_name="robomp-bot",
        author_email="robomp-bot@example.invalid",
        inbound_thread_number=99,
    )
    try:
        tool = next(x for x in build(bindings) if x.name == "gh_post_comment")
        tool.execute({"body": "hi", "number": 42}, _ctx())
    finally:
        _stop_loop(loop, thread)

    assert captured["url"].endswith("/repos/octo/widget/issues/42/comments"), captured["url"]


def test_gh_post_comment_propagates_github_error(db: Database, tmp_path: Path) -> None:
    transport = httpx.MockTransport(lambda r: httpx.Response(422, json={"message": "Validation failed"}))
    bindings, loop, t = _bindings(db, tmp_path, transport)
    try:
        tool = next(x for x in build(bindings) if x.name == "gh_post_comment")
        with pytest.raises(RpcCommandError) as exc:
            tool.execute({"body": "hi"}, _ctx())
        assert "422" in str(exc.value)
    finally:
        _stop_loop(loop, t)


def test_gh_open_pr_requires_template_sections(db: Database, tmp_path: Path) -> None:
    transport = httpx.MockTransport(lambda r: httpx.Response(500))
    bindings, loop, t = _bindings(db, tmp_path, transport)
    try:
        tool = next(x for x in build(bindings) if x.name == "gh_open_pr")
        with pytest.raises(RpcCommandError) as exc:
            tool.execute({"title": "t", "body": "no sections"}, _ctx())
        assert "Repro" in str(exc.value)
    finally:
        _stop_loop(loop, t)


def test_repro_record_writes_transcript(db: Database, tmp_path: Path) -> None:
    bindings, loop, t = _bindings(db, tmp_path, httpx.MockTransport(lambda r: httpx.Response(500)))
    try:
        tool = next(x for x in build(bindings) if x.name == "repro_record")
        result = tool.execute(
            {
                "title": "panic on empty input",
                "command": "bun test foo.test.ts",
                "output": "Error: boom",
                "exit_code": 1,
                "reproduced": True,
            },
            _ctx(),
        )
        assert "saved transcript" in result
        files = list(bindings.workspace.repro_dir.iterdir())
        assert len(files) == 1
        assert "exit_code: 1" in files[0].read_text()
    finally:
        _stop_loop(loop, t)


def test_repro_record_rejects_bad_args(db: Database, tmp_path: Path) -> None:
    bindings, loop, t = _bindings(db, tmp_path, httpx.MockTransport(lambda r: httpx.Response(500)))
    try:
        tool = next(x for x in build(bindings) if x.name == "repro_record")
        with pytest.raises(RpcCommandError):
            tool.execute({"title": "", "command": "x", "output": "y", "exit_code": 1}, _ctx())
        with pytest.raises(RpcCommandError):
            tool.execute({"title": "t", "command": "x", "output": "y", "exit_code": "bad"}, _ctx())
    finally:
        _stop_loop(loop, t)


def test_mark_unable_posts_comment_and_abandons(db: Database, tmp_path: Path) -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return httpx.Response(201, json={"id": 77, "user": {"login": "robomp-bot"}, "body": "x", "created_at": "t"})

    bindings, loop, t = _bindings(db, tmp_path, httpx.MockTransport(handler))
    try:
        tool = next(x for x in build(bindings) if x.name == "mark_unable_to_reproduce")
        result = tool.execute({"diagnosis": "needed exact version", "info_needed": "post bun --version"}, _ctx())
    finally:
        _stop_loop(loop, t)
    assert "abandonment" in result
    assert "Could not reproduce" in captured["body"]["body"]
    issue = db.get_issue(bindings.issue_key)
    assert issue and issue.state == "abandoned"


def test_fetch_issue_thread_returns_markdown(db: Database, tmp_path: Path) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/comments"):
            return httpx.Response(
                200,
                json=[
                    {"id": 1, "user": {"login": "alice"}, "body": "still broken", "created_at": "t1"},
                ],
            )
        return httpx.Response(
            200,
            json={
                "number": 42,
                "title": "boom",
                "body": "b",
                "state": "open",
                "user": {"login": "alice"},
                "labels": [{"name": "bug"}],
            },
        )

    bindings, loop, t = _bindings(db, tmp_path, httpx.MockTransport(handler))
    try:
        tool = next(x for x in build(bindings) if x.name == "fetch_issue_thread")
        result = tool.execute({}, _ctx())
    finally:
        _stop_loop(loop, t)
    assert "octo/widget#42" in result
    assert "@alice" in result
    assert "still broken" in result


def test_classify_issue_applies_labels_and_persists_primary(db: Database, tmp_path: Path) -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = request.url.path
        captured["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json=[{"name": n} for n in captured["body"]["labels"]],
        )

    bindings, loop, t = _bindings(db, tmp_path, httpx.MockTransport(handler))
    try:
        tool = next(x for x in build(bindings) if x.name == "classify_issue")
        result = tool.execute(
            {
                "primary": "bug",
                "priority": "prio:p1",
                "functional": ["tool", "agent"],
                "provider": "provider:openai",
                "platform": "platform:macos",
                "rationale": "tool call panics on empty arg on macOS",
            },
            _ctx(),
        )
    finally:
        _stop_loop(loop, t)

    assert "classified as bug" in result
    assert "reproduce" in result.lower()
    assert captured["path"].endswith("/issues/42/labels")
    assert captured["body"]["labels"] == [
        "bug",
        "prio:p1",
        "tool",
        "agent",
        "providers",
        "provider:openai",
        "platform:macos",
        "triaged",
    ]
    row = db.get_issue(bindings.issue_key)
    assert row is not None and row.classification == "bug"


def test_classify_issue_question_skips_repro_path(db: Database, tmp_path: Path) -> None:
    transport = httpx.MockTransport(lambda r: httpx.Response(200, json=[{"name": "question"}, {"name": "triaged"}]))
    bindings, loop, t = _bindings(db, tmp_path, transport)
    try:
        tool = next(x for x in build(bindings) if x.name == "classify_issue")
        result = tool.execute(
            {"primary": "question", "rationale": "how-to about config"},
            _ctx(),
        )
    finally:
        _stop_loop(loop, t)
    assert "question" in result
    assert "no PR" in result
    row = db.get_issue(bindings.issue_key)
    assert row is not None and row.classification == "question"


def test_classify_issue_rejects_bug_without_priority(db: Database, tmp_path: Path) -> None:
    bindings, loop, t = _bindings(db, tmp_path, httpx.MockTransport(lambda r: httpx.Response(500)))
    try:
        tool = next(x for x in build(bindings) if x.name == "classify_issue")
        with pytest.raises(RpcCommandError):
            tool.execute({"primary": "bug", "rationale": "yes a bug"}, _ctx())
    finally:
        _stop_loop(loop, t)


def test_classify_issue_rejects_priority_on_non_bug(db: Database, tmp_path: Path) -> None:
    bindings, loop, t = _bindings(db, tmp_path, httpx.MockTransport(lambda r: httpx.Response(500)))
    try:
        tool = next(x for x in build(bindings) if x.name == "classify_issue")
        with pytest.raises(RpcCommandError):
            tool.execute(
                {"primary": "question", "priority": "prio:p1", "rationale": "x"},
                _ctx(),
            )
    finally:
        _stop_loop(loop, t)


def test_classify_issue_rejects_unknown_primary(db: Database, tmp_path: Path) -> None:
    bindings, loop, t = _bindings(db, tmp_path, httpx.MockTransport(lambda r: httpx.Response(500)))
    try:
        tool = next(x for x in build(bindings) if x.name == "classify_issue")
        with pytest.raises(RpcCommandError):
            tool.execute({"primary": "nonsense", "rationale": "x"}, _ctx())
    finally:
        _stop_loop(loop, t)


def test_set_issue_labels_appends(db: Database, tmp_path: Path) -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return httpx.Response(200, json=[{"name": n} for n in captured["body"]["labels"]])

    bindings, loop, t = _bindings(db, tmp_path, httpx.MockTransport(handler))
    try:
        tool = next(x for x in build(bindings) if x.name == "set_issue_labels")
        result = tool.execute({"labels": ["wontfix"]}, _ctx())
    finally:
        _stop_loop(loop, t)
    assert "wontfix" in result
    assert captured["body"]["labels"] == ["wontfix"]


def test_set_issue_labels_rejects_empty(db: Database, tmp_path: Path) -> None:
    bindings, loop, t = _bindings(db, tmp_path, httpx.MockTransport(lambda r: httpx.Response(500)))
    try:
        tool = next(x for x in build(bindings) if x.name == "set_issue_labels")
        with pytest.raises(RpcCommandError):
            tool.execute({"labels": []}, _ctx())
        with pytest.raises(RpcCommandError):
            tool.execute({"labels": ["   ", ""]}, _ctx())
    finally:
        _stop_loop(loop, t)


def test_gh_push_branch_rejects_wrong_identity(db: Database, tmp_path: Path) -> None:
    """Pre-push gate refuses to push commits authored by anyone other than the configured identity."""
    import os
    import subprocess

    # Build a real local upstream + worktree so git operations actually work.
    bare = tmp_path / "upstream.git"
    bare.mkdir()
    subprocess.run(["git", "init", "--bare", "--initial-branch=main", str(bare)], check=True, capture_output=True)
    seed = tmp_path / "seed"
    seed.mkdir()
    env = os.environ | {
        "GIT_AUTHOR_NAME": "seed",
        "GIT_AUTHOR_EMAIL": "seed@x",
        "GIT_COMMITTER_NAME": "seed",
        "GIT_COMMITTER_EMAIL": "seed@x",
    }
    subprocess.run(["git", "init", "--initial-branch=main", str(seed)], check=True, capture_output=True)
    (seed / "README.md").write_text("init\n")
    for cmd in (
        ["git", "-C", str(seed), "add", "."],
        ["git", "-C", str(seed), "-c", "user.email=seed@x", "-c", "user.name=seed", "commit", "-m", "init"],
        ["git", "-C", str(seed), "remote", "add", "origin", str(bare)],
        ["git", "-C", str(seed), "push", "origin", "main"],
    ):
        subprocess.run(cmd, check=True, capture_output=True, env=env)

    from robomp.sandbox import SandboxManager

    mgr = SandboxManager(tmp_path / "workspaces")
    ws = mgr.ensure_workspace(
        repo="octo/widget",
        number=42,
        title="identity test",
        clone_url=str(bare),
        default_branch="main",
        author_name="robomp-bot",
        author_email="robomp-bot@example.invalid",
    )
    # Commit with a different identity to provoke the gate.
    bad_env = os.environ | {
        "GIT_AUTHOR_NAME": "wrong",
        "GIT_AUTHOR_EMAIL": "wrong@nope",
        "GIT_COMMITTER_NAME": "wrong",
        "GIT_COMMITTER_EMAIL": "wrong@nope",
    }
    (ws.repo_dir / "x.txt").write_text("hi\n")
    subprocess.run(["git", "-C", str(ws.repo_dir), "add", "."], check=True, capture_output=True)
    subprocess.run(
        ["git", "-C", str(ws.repo_dir), "-c", "user.email=wrong@nope", "-c", "user.name=wrong", "commit", "-m", "bad"],
        check=True,
        capture_output=True,
        env=bad_env,
    )

    github = GitHubClient("tok", transport=httpx.MockTransport(lambda r: httpx.Response(500)))
    loop, thread = _make_loop_in_background()
    try:
        bindings = ToolBindings(
            db=db,
            github=github,
            git_transport=LocalGitTransport(token=None),
            repo=_stub_repo(),
            issue=IssueInfo(
                repo="octo/widget",
                number=42,
                title="t",
                body="",
                state="open",
                author="alice",
                labels=(),
                is_pull_request=False,
            ),
            workspace=ws,
            loop=loop,
            author_name="robomp-bot",
            author_email="robomp-bot@example.invalid",
        )
        db.upsert_issue(
            key=bindings.issue_key,
            repo="octo/widget",
            number=42,
            state="reproducing",
            branch=ws.branch,
            session_dir=str(ws.session_dir),
        )
        tool = next(x for x in build(bindings) if x.name == "gh_push_branch")
        with pytest.raises(RpcCommandError) as exc:
            tool.execute({}, _ctx())
        msg = str(exc.value)
        assert "identity mismatch" in msg
        assert "wrong <wrong@nope>" in msg
        assert "robomp-bot <robomp-bot@example.invalid>" in msg
        # Branch must NOT have been pushed.
        refs = subprocess.run(
            ["git", "-C", str(bare), "for-each-ref", "--format=%(refname)"],
            capture_output=True,
            text=True,
            check=True,
        )
        assert not any(r.startswith("refs/heads/farm/") for r in refs.stdout.splitlines()), refs.stdout
    finally:
        _stop_loop(loop, thread)


def test_gh_open_pr_rejects_wrong_identity_before_push_or_pr(db: Database, tmp_path: Path) -> None:
    """gh_open_pr uses the guarded push path before creating the pull request."""
    import os
    import subprocess

    bare = tmp_path / "upstream.git"
    bare.mkdir()
    subprocess.run(["git", "init", "--bare", "--initial-branch=main", str(bare)], check=True, capture_output=True)
    seed = tmp_path / "seed"
    seed.mkdir()
    env = os.environ | {
        "GIT_AUTHOR_NAME": "seed",
        "GIT_AUTHOR_EMAIL": "seed@x",
        "GIT_COMMITTER_NAME": "seed",
        "GIT_COMMITTER_EMAIL": "seed@x",
    }
    subprocess.run(["git", "init", "--initial-branch=main", str(seed)], check=True, capture_output=True)
    (seed / "README.md").write_text("init\n")
    for cmd in (
        ["git", "-C", str(seed), "add", "."],
        ["git", "-C", str(seed), "-c", "user.email=seed@x", "-c", "user.name=seed", "commit", "-m", "init"],
        ["git", "-C", str(seed), "remote", "add", "origin", str(bare)],
        ["git", "-C", str(seed), "push", "origin", "main"],
    ):
        subprocess.run(cmd, check=True, capture_output=True, env=env)

    from robomp.sandbox import SandboxManager

    mgr = SandboxManager(tmp_path / "workspaces")
    ws = mgr.ensure_workspace(
        repo="octo/widget",
        number=42,
        title="identity test",
        clone_url=str(bare),
        default_branch="main",
        author_name="robomp-bot",
        author_email="robomp-bot@example.invalid",
    )
    bad_env = os.environ | {
        "GIT_AUTHOR_NAME": "wrong",
        "GIT_AUTHOR_EMAIL": "wrong@nope",
        "GIT_COMMITTER_NAME": "wrong",
        "GIT_COMMITTER_EMAIL": "wrong@nope",
    }
    (ws.repo_dir / "x.txt").write_text("hi\n")
    subprocess.run(["git", "-C", str(ws.repo_dir), "add", "."], check=True, capture_output=True)
    subprocess.run(
        ["git", "-C", str(ws.repo_dir), "-c", "user.email=wrong@nope", "-c", "user.name=wrong", "commit", "-m", "bad"],
        check=True,
        capture_output=True,
        env=bad_env,
    )

    opened_pr = False

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal opened_pr
        opened_pr = True
        return httpx.Response(
            201,
            json={
                "number": 7,
                "html_url": "https://github.com/octo/widget/pull/7",
                "head": {"ref": ws.branch},
                "base": {"ref": "main"},
            },
        )

    github = GitHubClient("tok", transport=httpx.MockTransport(handler))
    loop, thread = _make_loop_in_background()
    try:
        bindings = ToolBindings(
            db=db,
            github=github,
            git_transport=LocalGitTransport(token=None),
            repo=_stub_repo(),
            issue=IssueInfo(
                repo="octo/widget",
                number=42,
                title="t",
                body="",
                state="open",
                author="alice",
                labels=(),
                is_pull_request=False,
            ),
            workspace=ws,
            loop=loop,
            author_name="robomp-bot",
            author_email="robomp-bot@example.invalid",
        )
        db.upsert_issue(
            key=bindings.issue_key,
            repo="octo/widget",
            number=42,
            state="reproducing",
            branch=ws.branch,
            session_dir=str(ws.session_dir),
        )
        tool = next(x for x in build(bindings) if x.name == "gh_open_pr")
        body = "## Repro\nrepro\n\n## Cause\ncause\n\n## Fix\nfix\n\n## Verification\nran tests\n\nFixes #42\n"
        with pytest.raises(RpcCommandError) as exc:
            tool.execute({"title": "fix: x", "body": body}, _ctx())
        assert "identity mismatch" in str(exc.value)
        assert not opened_pr
        refs = subprocess.run(
            ["git", "-C", str(bare), "for-each-ref", "--format=%(refname)"],
            capture_output=True,
            text=True,
            check=True,
        )
        assert not any(r.startswith("refs/heads/farm/") for r in refs.stdout.splitlines()), refs.stdout
    finally:
        _stop_loop(loop, thread)


def test_gh_push_branch_rejects_invalid_identity_scan_range(db: Database, tmp_path: Path) -> None:
    """A failing git-log author scan is a push rejection, not an empty successful scan."""
    import os
    import subprocess

    bare = tmp_path / "upstream.git"
    bare.mkdir()
    subprocess.run(["git", "init", "--bare", "--initial-branch=main", str(bare)], check=True, capture_output=True)
    seed = tmp_path / "seed"
    seed.mkdir()
    env = os.environ | {
        "GIT_AUTHOR_NAME": "robomp-bot",
        "GIT_AUTHOR_EMAIL": "robomp-bot@example.invalid",
        "GIT_COMMITTER_NAME": "robomp-bot",
        "GIT_COMMITTER_EMAIL": "robomp-bot@example.invalid",
    }
    subprocess.run(["git", "init", "--initial-branch=main", str(seed)], check=True, capture_output=True)
    (seed / "README.md").write_text("init\n")
    for cmd in (
        ["git", "-C", str(seed), "add", "."],
        [
            "git",
            "-C",
            str(seed),
            "-c",
            "user.email=robomp-bot@example.invalid",
            "-c",
            "user.name=robomp-bot",
            "commit",
            "-m",
            "init",
        ],
        ["git", "-C", str(seed), "remote", "add", "origin", str(bare)],
        ["git", "-C", str(seed), "push", "origin", "main"],
    ):
        subprocess.run(cmd, check=True, capture_output=True, env=env)

    from robomp.sandbox import SandboxManager

    mgr = SandboxManager(tmp_path / "workspaces")
    ws = mgr.ensure_workspace(
        repo="octo/widget",
        number=42,
        title="missing base ref",
        clone_url=str(bare),
        default_branch="main",
        author_name="robomp-bot",
        author_email="robomp-bot@example.invalid",
    )
    subprocess.run(
        ["git", "-C", str(ws.repo_dir), "update-ref", "-d", "refs/remotes/origin/main"], check=True, capture_output=True
    )
    (ws.repo_dir / "x.txt").write_text("hi\n")
    subprocess.run(["git", "-C", str(ws.repo_dir), "add", "x.txt"], check=True, capture_output=True)
    subprocess.run(
        [
            "git",
            "-C",
            str(ws.repo_dir),
            "-c",
            "user.email=robomp-bot@example.invalid",
            "-c",
            "user.name=robomp-bot",
            "commit",
            "-m",
            "ok",
        ],
        check=True,
        capture_output=True,
        env=env,
    )

    github = GitHubClient("tok", transport=httpx.MockTransport(lambda r: httpx.Response(500)))
    loop, thread = _make_loop_in_background()
    try:
        bindings = ToolBindings(
            db=db,
            github=github,
            git_transport=LocalGitTransport(token=None),
            repo=_stub_repo(),
            issue=IssueInfo(
                repo="octo/widget",
                number=42,
                title="t",
                body="",
                state="open",
                author="alice",
                labels=(),
                is_pull_request=False,
            ),
            workspace=ws,
            loop=loop,
            author_name="robomp-bot",
            author_email="robomp-bot@example.invalid",
        )
        db.upsert_issue(
            key=bindings.issue_key,
            repo="octo/widget",
            number=42,
            state="reproducing",
            branch=ws.branch,
            session_dir=str(ws.session_dir),
        )
        tool = next(x for x in build(bindings) if x.name == "gh_push_branch")
        with pytest.raises(RpcCommandError) as exc:
            tool.execute({}, _ctx())
        msg = str(exc.value)
        assert "could not inspect commit authors" in msg
        assert "origin/main..HEAD" in msg
        refs = subprocess.run(
            ["git", "-C", str(bare), "for-each-ref", "--format=%(refname)"],
            capture_output=True,
            text=True,
            check=True,
        )
        assert not any(r.startswith("refs/heads/farm/") for r in refs.stdout.splitlines()), refs.stdout
        row = db._conn.execute(
            "SELECT error FROM tool_calls WHERE tool='gh_push_branch' ORDER BY id DESC LIMIT 1"
        ).fetchone()
        assert row is not None and "could not inspect commit authors" in row["error"]
        assert "origin/main..HEAD" in row["error"]
    finally:
        _stop_loop(loop, thread)


def test_gh_open_pr_requires_closes_keyword(db: Database, tmp_path: Path) -> None:
    """gh_open_pr refuses if the body has the four sections but no Fixes/Closes/Resolves keyword."""
    bindings, loop, t = _bindings(db, tmp_path, httpx.MockTransport(lambda r: httpx.Response(500)))
    try:
        tool = next(x for x in build(bindings) if x.name == "gh_open_pr")
        body = "## Repro\nrepro\n\n## Cause\ncause\n\n## Fix\nfix\n\n## Verification\nran tests\n"
        with pytest.raises(RpcCommandError) as exc:
            tool.execute({"title": "fix: x", "body": body}, _ctx())
        assert "Fixes #42" in str(exc.value)
    finally:
        _stop_loop(loop, t)


def test_gh_open_pr_refuses_failed_bun_check_before_push_or_pr(
    db: Database, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """gh_open_pr sends a failing pre-PR check back to the agent without creating a PR."""
    import os

    opened_pr = False

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal opened_pr
        opened_pr = True
        return httpx.Response(
            201,
            json={
                "number": 7,
                "html_url": "https://github.com/octo/widget/pull/7",
                "head": {"ref": "farm/abc12345/some-issue"},
                "base": {"ref": "main"},
            },
        )

    bindings, loop, t = _bindings(db, tmp_path, httpx.MockTransport(handler))
    fakebin = tmp_path / "fakebin"
    fakebin.mkdir()
    fake_bun = fakebin / "bun"
    fake_bun.write_text(
        "#!/bin/sh\n"
        'if [ "$1" != "check" ]; then printf "wrong command: %s\\n" "$1" >&2; exit 2; fi\n'
        'printf "TypeError: property missing\\n" >&2\n'
        "exit 1\n",
        encoding="utf-8",
    )
    fake_bun.chmod(0o755)
    monkeypatch.setenv("PATH", f"{fakebin}{os.pathsep}{os.environ['PATH']}")
    (bindings.workspace.repo_dir / "package.json").write_text(
        json.dumps({"scripts": {"check": "tsc --noEmit"}}) + "\n",
        encoding="utf-8",
    )

    try:
        tool = next(x for x in build(bindings) if x.name == "gh_open_pr")
        body = "## Repro\nrepro\n\n## Cause\ncause\n\n## Fix\nfix\n\n## Verification\nran tests\n\nFixes #42\n"
        with pytest.raises(RpcCommandError) as exc:
            tool.execute({"title": "fix: x", "body": body}, _ctx())
    finally:
        _stop_loop(loop, t)

    msg = str(exc.value)
    assert "refusing to open PR" in msg
    assert "`bun check` failed before open PR" in msg
    assert "TypeError: property missing" in msg
    assert not opened_pr
    row = db._conn.execute("SELECT error FROM tool_calls WHERE tool='gh_open_pr' ORDER BY id DESC LIMIT 1").fetchone()
    assert row is not None
    assert "TypeError: property missing" in row["error"]


def test_gh_push_branch_rejects_dirty_worktree(db: Database, tmp_path: Path) -> None:
    """Pre-push gate refuses if the working tree has uncommitted changes."""
    import os
    import subprocess

    # Real upstream + worktree so git status works.
    bare = tmp_path / "upstream.git"
    bare.mkdir()
    subprocess.run(["git", "init", "--bare", "--initial-branch=main", str(bare)], check=True, capture_output=True)
    seed = tmp_path / "seed"
    seed.mkdir()
    env = os.environ | {
        "GIT_AUTHOR_NAME": "robomp-bot",
        "GIT_AUTHOR_EMAIL": "robomp-bot@example.invalid",
        "GIT_COMMITTER_NAME": "robomp-bot",
        "GIT_COMMITTER_EMAIL": "robomp-bot@example.invalid",
    }
    subprocess.run(["git", "init", "--initial-branch=main", str(seed)], check=True, capture_output=True)
    (seed / "README.md").write_text("init\n")
    for cmd in (
        ["git", "-C", str(seed), "add", "."],
        [
            "git",
            "-C",
            str(seed),
            "-c",
            "user.email=robomp-bot@example.invalid",
            "-c",
            "user.name=robomp-bot",
            "commit",
            "-m",
            "init",
        ],
        ["git", "-C", str(seed), "remote", "add", "origin", str(bare)],
        ["git", "-C", str(seed), "push", "origin", "main"],
    ):
        subprocess.run(cmd, check=True, capture_output=True, env=env)

    from robomp.sandbox import SandboxManager

    mgr = SandboxManager(tmp_path / "workspaces")
    ws = mgr.ensure_workspace(
        repo="octo/widget",
        number=42,
        title="dirty test",
        clone_url=str(bare),
        default_branch="main",
        author_name="robomp-bot",
        author_email="robomp-bot@example.invalid",
    )
    # Make a proper commit (so the identity gate passes).
    (ws.repo_dir / "a.txt").write_text("a\n")
    subprocess.run(["git", "-C", str(ws.repo_dir), "add", "a.txt"], check=True, capture_output=True)
    subprocess.run(
        [
            "git",
            "-C",
            str(ws.repo_dir),
            "-c",
            "user.email=robomp-bot@example.invalid",
            "-c",
            "user.name=robomp-bot",
            "commit",
            "-m",
            "ok",
        ],
        check=True,
        capture_output=True,
        env=env,
    )
    # Now dirty the worktree — uncommitted edit.
    (ws.repo_dir / "a.txt").write_text("a-modified\n")

    github = GitHubClient("tok", transport=httpx.MockTransport(lambda r: httpx.Response(500)))
    loop, thread = _make_loop_in_background()
    try:
        bindings = ToolBindings(
            db=db,
            github=github,
            git_transport=LocalGitTransport(token=None),
            repo=_stub_repo(),
            issue=IssueInfo(
                repo="octo/widget",
                number=42,
                title="t",
                body="",
                state="open",
                author="alice",
                labels=(),
                is_pull_request=False,
            ),
            workspace=ws,
            loop=loop,
            author_name="robomp-bot",
            author_email="robomp-bot@example.invalid",
        )
        db.upsert_issue(
            key=bindings.issue_key,
            repo="octo/widget",
            number=42,
            state="reproducing",
            branch=ws.branch,
            session_dir=str(ws.session_dir),
        )
        tool = next(x for x in build(bindings) if x.name == "gh_push_branch")
        with pytest.raises(RpcCommandError) as exc:
            tool.execute({}, _ctx())
        assert "working tree is dirty" in str(exc.value)
        # Nothing pushed.
        refs = subprocess.run(
            ["git", "-C", str(bare), "for-each-ref", "--format=%(refname)"],
            capture_output=True,
            text=True,
            check=True,
        )
        assert not any(r.startswith("refs/heads/farm/") for r in refs.stdout.splitlines()), refs.stdout
    finally:
        _stop_loop(loop, thread)


def test_gh_push_branch_runs_fix_and_check_before_pushing(
    db: Database, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """gh_push_branch must run `bun run fix` then `bun check` (when defined)
    before the push reaches the remote. Same gate as `gh_open_pr` so a
    follow-up commit can't break CI."""
    import os
    import subprocess

    bare = tmp_path / "upstream.git"
    bare.mkdir()
    subprocess.run(["git", "init", "--bare", "--initial-branch=main", str(bare)], check=True, capture_output=True)
    seed = tmp_path / "seed"
    seed.mkdir()
    env = os.environ | {
        "GIT_AUTHOR_NAME": "robomp-bot",
        "GIT_AUTHOR_EMAIL": "robomp-bot@example.invalid",
        "GIT_COMMITTER_NAME": "robomp-bot",
        "GIT_COMMITTER_EMAIL": "robomp-bot@example.invalid",
    }
    subprocess.run(["git", "init", "--initial-branch=main", str(seed)], check=True, capture_output=True)
    (seed / "README.md").write_text("init\n")
    for cmd in (
        ["git", "-C", str(seed), "add", "."],
        [
            "git",
            "-C",
            str(seed),
            "-c",
            "user.email=robomp-bot@example.invalid",
            "-c",
            "user.name=robomp-bot",
            "commit",
            "-m",
            "init",
        ],
        ["git", "-C", str(seed), "remote", "add", "origin", str(bare)],
        ["git", "-C", str(seed), "push", "origin", "main"],
    ):
        subprocess.run(cmd, check=True, capture_output=True, env=env)

    from robomp.sandbox import SandboxManager

    mgr = SandboxManager(tmp_path / "workspaces")
    ws = mgr.ensure_workspace(
        repo="octo/widget",
        number=42,
        title="push gate",
        clone_url=str(bare),
        default_branch="main",
        author_name="robomp-bot",
        author_email="robomp-bot@example.invalid",
    )

    fix_calls = tmp_path / "fix-calls"
    check_calls = tmp_path / "check-calls"
    fakebin = tmp_path / "fakebin"
    fakebin.mkdir()
    fake_bun = fakebin / "bun"
    fake_bun.write_text(
        "#!/bin/sh\n"
        'if [ "$1" = "run" ] && [ "$2" = "fix" ]; then\n'
        f"    printf called >> {fix_calls}\n"
        '    printf "formatted\\n" > src.txt\n'
        "    exit 0\n"
        "fi\n"
        'if [ "$1" = "check" ]; then\n'
        f"    printf called >> {check_calls}\n"
        "    exit 0\n"
        "fi\n"
        'printf "unexpected bun call: %s\\n" "$*" >&2\n'
        "exit 2\n"
    )
    fake_bun.chmod(0o755)
    monkeypatch.setenv("PATH", f"{fakebin}{os.pathsep}{os.environ['PATH']}")

    (ws.repo_dir / "package.json").write_text(
        json.dumps({"scripts": {"fix": "...", "check": "..."}}) + "\n",
        encoding="utf-8",
    )
    (ws.repo_dir / "src.txt").write_text("original\n")
    subprocess.run(["git", "-C", str(ws.repo_dir), "add", "package.json", "src.txt"], check=True, capture_output=True)
    subprocess.run(
        [
            "git",
            "-C",
            str(ws.repo_dir),
            "-c",
            "user.email=robomp-bot@example.invalid",
            "-c",
            "user.name=robomp-bot",
            "commit",
            "-m",
            "feat: follow-up",
        ],
        check=True,
        capture_output=True,
        env=env,
    )

    github = GitHubClient("tok", transport=httpx.MockTransport(lambda r: httpx.Response(500)))
    loop, thread = _make_loop_in_background()
    try:
        bindings = ToolBindings(
            db=db,
            github=github,
            git_transport=LocalGitTransport(token=None),
            repo=_stub_repo(),
            issue=IssueInfo(
                repo="octo/widget",
                number=42,
                title="t",
                body="",
                state="open",
                author="alice",
                labels=(),
                is_pull_request=False,
            ),
            workspace=ws,
            loop=loop,
            author_name="robomp-bot",
            author_email="robomp-bot@example.invalid",
        )
        db.upsert_issue(
            key=bindings.issue_key,
            repo="octo/widget",
            number=42,
            state="reproducing",
            branch=ws.branch,
            session_dir=str(ws.session_dir),
        )
        tool = next(x for x in build(bindings) if x.name == "gh_push_branch")
        result = tool.execute({}, _ctx())
    finally:
        _stop_loop(loop, thread)

    # Both gates ran, and fix preceded check (both have one call recorded).
    assert fix_calls.read_text() == "called"
    assert check_calls.read_text() == "called"
    # The formatter's diff was committed by the bot as a `style: bun run fix` commit.
    log = subprocess.run(
        ["git", "-C", str(ws.repo_dir), "log", "--format=%an <%ae> %s", "-n", "2"],
        capture_output=True,
        text=True,
        check=True,
    )
    lines = log.stdout.strip().splitlines()
    assert lines[0].startswith("robomp-bot <robomp-bot@example.invalid> style: bun run fix"), lines
    # And the branch ended up on the remote at the new head.
    assert result.startswith(f"pushed {ws.branch} ")
    refs = subprocess.run(
        ["git", "-C", str(bare), "for-each-ref", "--format=%(refname)"],
        capture_output=True,
        text=True,
        check=True,
    )
    assert f"refs/heads/{ws.branch}" in refs.stdout.splitlines()


def test_gh_push_branch_force_with_lease_recovers_after_amend(db: Database, tmp_path: Path) -> None:
    """A divergent local history (amended commit) must push successfully.

    Plain `git push` rejects this as non-fast-forward, leaving the agent stuck.
    `--force-with-lease` accepts the rewrite because origin still matches the
    ref we last fetched."""
    import os
    import subprocess

    bare = tmp_path / "upstream.git"
    bare.mkdir()
    subprocess.run(["git", "init", "--bare", "--initial-branch=main", str(bare)], check=True, capture_output=True)
    seed = tmp_path / "seed"
    seed.mkdir()
    env = os.environ | {
        "GIT_AUTHOR_NAME": "robomp-bot",
        "GIT_AUTHOR_EMAIL": "robomp-bot@example.invalid",
        "GIT_COMMITTER_NAME": "robomp-bot",
        "GIT_COMMITTER_EMAIL": "robomp-bot@example.invalid",
    }
    subprocess.run(["git", "init", "--initial-branch=main", str(seed)], check=True, capture_output=True)
    (seed / "README.md").write_text("init\n")
    for cmd in (
        ["git", "-C", str(seed), "add", "."],
        [
            "git",
            "-C",
            str(seed),
            "-c",
            "user.email=robomp-bot@example.invalid",
            "-c",
            "user.name=robomp-bot",
            "commit",
            "-m",
            "init",
        ],
        ["git", "-C", str(seed), "remote", "add", "origin", str(bare)],
        ["git", "-C", str(seed), "push", "origin", "main"],
    ):
        subprocess.run(cmd, check=True, capture_output=True, env=env)

    from robomp.sandbox import SandboxManager

    mgr = SandboxManager(tmp_path / "workspaces")
    ws = mgr.ensure_workspace(
        repo="octo/widget",
        number=42,
        title="amend recover",
        clone_url=str(bare),
        default_branch="main",
        author_name="robomp-bot",
        author_email="robomp-bot@example.invalid",
    )
    # First commit + push — fast-forward path.
    (ws.repo_dir / "feature.txt").write_text("original\n")
    subprocess.run(["git", "-C", str(ws.repo_dir), "add", "feature.txt"], check=True, capture_output=True)
    subprocess.run(
        [
            "git",
            "-C",
            str(ws.repo_dir),
            "-c",
            "user.email=robomp-bot@example.invalid",
            "-c",
            "user.name=robomp-bot",
            "commit",
            "-m",
            "feat: original",
        ],
        check=True,
        capture_output=True,
        env=env,
    )

    github = GitHubClient("tok", transport=httpx.MockTransport(lambda r: httpx.Response(500)))
    loop, thread = _make_loop_in_background()
    try:
        bindings = ToolBindings(
            db=db,
            github=github,
            git_transport=LocalGitTransport(token=None),
            repo=_stub_repo(),
            issue=IssueInfo(
                repo="octo/widget",
                number=42,
                title="t",
                body="",
                state="open",
                author="alice",
                labels=(),
                is_pull_request=False,
            ),
            workspace=ws,
            loop=loop,
            author_name="robomp-bot",
            author_email="robomp-bot@example.invalid",
        )
        db.upsert_issue(
            key=bindings.issue_key,
            repo="octo/widget",
            number=42,
            state="reproducing",
            branch=ws.branch,
            session_dir=str(ws.session_dir),
        )
        tool = next(x for x in build(bindings) if x.name == "gh_push_branch")
        tool.execute({}, _ctx())

        # Confirm origin received the original commit.
        first_remote = subprocess.run(
            ["git", "-C", str(bare), "rev-parse", f"refs/heads/{ws.branch}"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()

        # Now amend the commit (simulates an agent reset-author rebase, or a
        # code change applied via `git commit --amend`).
        (ws.repo_dir / "feature.txt").write_text("amended\n")
        subprocess.run(["git", "-C", str(ws.repo_dir), "add", "feature.txt"], check=True, capture_output=True)
        subprocess.run(
            [
                "git",
                "-C",
                str(ws.repo_dir),
                "-c",
                "user.email=robomp-bot@example.invalid",
                "-c",
                "user.name=robomp-bot",
                "commit",
                "--amend",
                "--no-edit",
            ],
            check=True,
            capture_output=True,
            env=env,
        )
        new_local = subprocess.run(
            ["git", "-C", str(ws.repo_dir), "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
        assert new_local != first_remote, "amend must rewrite the SHA"

        # Second push — divergent. Plain `git push` would reject; we expect success.
        result = tool.execute({}, _ctx())
    finally:
        _stop_loop(loop, thread)

    assert result.startswith(f"pushed {ws.branch} ")
    final_remote = subprocess.run(
        ["git", "-C", str(bare), "rev-parse", f"refs/heads/{ws.branch}"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    assert final_remote == new_local, (final_remote, new_local)


def test_gh_push_branch_aborts_on_failed_bun_check(
    db: Database, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A failing `bun check` aborts the push and leaves the remote untouched."""
    import os
    import subprocess

    bare = tmp_path / "upstream.git"
    bare.mkdir()
    subprocess.run(["git", "init", "--bare", "--initial-branch=main", str(bare)], check=True, capture_output=True)
    seed = tmp_path / "seed"
    seed.mkdir()
    env = os.environ | {
        "GIT_AUTHOR_NAME": "robomp-bot",
        "GIT_AUTHOR_EMAIL": "robomp-bot@example.invalid",
        "GIT_COMMITTER_NAME": "robomp-bot",
        "GIT_COMMITTER_EMAIL": "robomp-bot@example.invalid",
    }
    subprocess.run(["git", "init", "--initial-branch=main", str(seed)], check=True, capture_output=True)
    (seed / "README.md").write_text("init\n")
    for cmd in (
        ["git", "-C", str(seed), "add", "."],
        [
            "git",
            "-C",
            str(seed),
            "-c",
            "user.email=robomp-bot@example.invalid",
            "-c",
            "user.name=robomp-bot",
            "commit",
            "-m",
            "init",
        ],
        ["git", "-C", str(seed), "remote", "add", "origin", str(bare)],
        ["git", "-C", str(seed), "push", "origin", "main"],
    ):
        subprocess.run(cmd, check=True, capture_output=True, env=env)

    from robomp.sandbox import SandboxManager

    mgr = SandboxManager(tmp_path / "workspaces")
    ws = mgr.ensure_workspace(
        repo="octo/widget",
        number=42,
        title="push aborted",
        clone_url=str(bare),
        default_branch="main",
        author_name="robomp-bot",
        author_email="robomp-bot@example.invalid",
    )

    fakebin = tmp_path / "fakebin"
    fakebin.mkdir()
    fake_bun = fakebin / "bun"
    fake_bun.write_text(
        "#!/bin/sh\n"
        'if [ "$1" = "check" ]; then\n'
        '    printf "TypeError: property missing\\n" >&2\n'
        "    exit 1\n"
        "fi\n"
        "exit 0\n"
    )
    fake_bun.chmod(0o755)
    monkeypatch.setenv("PATH", f"{fakebin}{os.pathsep}{os.environ['PATH']}")

    (ws.repo_dir / "package.json").write_text(
        json.dumps({"scripts": {"check": "tsc --noEmit"}}) + "\n",
        encoding="utf-8",
    )
    (ws.repo_dir / "feature.txt").write_text("feature\n")
    subprocess.run(
        ["git", "-C", str(ws.repo_dir), "add", "package.json", "feature.txt"], check=True, capture_output=True
    )
    subprocess.run(
        [
            "git",
            "-C",
            str(ws.repo_dir),
            "-c",
            "user.email=robomp-bot@example.invalid",
            "-c",
            "user.name=robomp-bot",
            "commit",
            "-m",
            "ok",
        ],
        check=True,
        capture_output=True,
        env=env,
    )

    github = GitHubClient("tok", transport=httpx.MockTransport(lambda r: httpx.Response(500)))
    loop, thread = _make_loop_in_background()
    try:
        bindings = ToolBindings(
            db=db,
            github=github,
            git_transport=LocalGitTransport(token=None),
            repo=_stub_repo(),
            issue=IssueInfo(
                repo="octo/widget",
                number=42,
                title="t",
                body="",
                state="open",
                author="alice",
                labels=(),
                is_pull_request=False,
            ),
            workspace=ws,
            loop=loop,
            author_name="robomp-bot",
            author_email="robomp-bot@example.invalid",
        )
        db.upsert_issue(
            key=bindings.issue_key,
            repo="octo/widget",
            number=42,
            state="reproducing",
            branch=ws.branch,
            session_dir=str(ws.session_dir),
        )
        tool = next(x for x in build(bindings) if x.name == "gh_push_branch")
        with pytest.raises(RpcCommandError) as exc:
            tool.execute({}, _ctx())
    finally:
        _stop_loop(loop, thread)

    msg = str(exc.value)
    assert "refusing to push" in msg
    assert "`bun check` failed before push" in msg
    assert "TypeError: property missing" in msg
    # The branch must not have reached the remote.
    refs = subprocess.run(
        ["git", "-C", str(bare), "for-each-ref", "--format=%(refname)"],
        capture_output=True,
        text=True,
        check=True,
    )
    assert not any(r.startswith("refs/heads/farm/") for r in refs.stdout.splitlines()), refs.stdout
    # Audit row attributes the failure to gh_push_branch, not gh_open_pr.
    row = db._conn.execute(
        "SELECT tool, error FROM tool_calls WHERE tool='gh_push_branch' ORDER BY id DESC LIMIT 1"
    ).fetchone()
    assert row is not None
    assert "TypeError: property missing" in row["error"]


def test_gh_open_pr_runs_fix_then_check_and_commits_fixup(
    db: Database, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """gh_open_pr runs `bun run fix`, commits any diff as the bot, then runs `bun check`."""
    import os
    import subprocess

    bare = tmp_path / "upstream.git"
    bare.mkdir()
    subprocess.run(["git", "init", "--bare", "--initial-branch=main", str(bare)], check=True, capture_output=True)
    seed = tmp_path / "seed"
    seed.mkdir()
    env = os.environ | {
        "GIT_AUTHOR_NAME": "robomp-bot",
        "GIT_AUTHOR_EMAIL": "robomp-bot@example.invalid",
        "GIT_COMMITTER_NAME": "robomp-bot",
        "GIT_COMMITTER_EMAIL": "robomp-bot@example.invalid",
    }
    subprocess.run(["git", "init", "--initial-branch=main", str(seed)], check=True, capture_output=True)
    (seed / "README.md").write_text("init\n")
    for cmd in (
        ["git", "-C", str(seed), "add", "."],
        [
            "git",
            "-C",
            str(seed),
            "-c",
            "user.email=robomp-bot@example.invalid",
            "-c",
            "user.name=robomp-bot",
            "commit",
            "-m",
            "init",
        ],
        ["git", "-C", str(seed), "remote", "add", "origin", str(bare)],
        ["git", "-C", str(seed), "push", "origin", "main"],
    ):
        subprocess.run(cmd, check=True, capture_output=True, env=env)

    from robomp.sandbox import SandboxManager

    mgr = SandboxManager(tmp_path / "workspaces")
    ws = mgr.ensure_workspace(
        repo="octo/widget",
        number=42,
        title="fix runs before check",
        clone_url=str(bare),
        default_branch="main",
        author_name="robomp-bot",
        author_email="robomp-bot@example.invalid",
    )

    # The fake bun:
    #   `bun run fix` → rewrite src.txt and emit a small marker the test asserts on
    #   `bun check`   → exit 0
    #   anything else → fail
    fix_calls = tmp_path / "fix-calls"
    check_calls = tmp_path / "check-calls"
    fakebin = tmp_path / "fakebin"
    fakebin.mkdir()
    fake_bun = fakebin / "bun"
    fake_bun.write_text(
        "#!/bin/sh\n"
        'if [ "$1" = "run" ] && [ "$2" = "fix" ]; then\n'
        f"    printf called >> {fix_calls}\n"
        '    printf "formatted\\n" > src.txt\n'
        "    exit 0\n"
        "fi\n"
        'if [ "$1" = "check" ]; then\n'
        f"    printf called >> {check_calls}\n"
        "    exit 0\n"
        "fi\n"
        'printf "unexpected bun call: %s\\n" "$*" >&2\n'
        "exit 2\n"
    )
    fake_bun.chmod(0o755)
    monkeypatch.setenv("PATH", f"{fakebin}{os.pathsep}{os.environ['PATH']}")

    (ws.repo_dir / "package.json").write_text(
        json.dumps({"scripts": {"fix": "...", "check": "..."}}) + "\n",
        encoding="utf-8",
    )
    (ws.repo_dir / "src.txt").write_text("original\n")
    subprocess.run(["git", "-C", str(ws.repo_dir), "add", "package.json", "src.txt"], check=True, capture_output=True)
    subprocess.run(
        [
            "git",
            "-C",
            str(ws.repo_dir),
            "-c",
            "user.email=robomp-bot@example.invalid",
            "-c",
            "user.name=robomp-bot",
            "commit",
            "-m",
            "feat: initial change",
        ],
        check=True,
        capture_output=True,
        env=env,
    )

    opened_pr: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        opened_pr["url"] = str(request.url)
        return httpx.Response(
            201,
            json={
                "number": 7,
                "html_url": "https://github.com/octo/widget/pull/7",
                "head": {"ref": ws.branch},
                "base": {"ref": "main"},
                "state": "open",
            },
        )

    github = GitHubClient("tok", transport=httpx.MockTransport(handler))
    loop, thread = _make_loop_in_background()
    try:
        bindings = ToolBindings(
            db=db,
            github=github,
            git_transport=LocalGitTransport(token=None),
            repo=_stub_repo(),
            issue=IssueInfo(
                repo="octo/widget",
                number=42,
                title="t",
                body="",
                state="open",
                author="alice",
                labels=(),
                is_pull_request=False,
            ),
            workspace=ws,
            loop=loop,
            author_name="robomp-bot",
            author_email="robomp-bot@example.invalid",
        )
        db.upsert_issue(
            key=bindings.issue_key,
            repo="octo/widget",
            number=42,
            state="reproducing",
            branch=ws.branch,
            session_dir=str(ws.session_dir),
        )
        tool = next(x for x in build(bindings) if x.name == "gh_open_pr")
        body = "## Repro\nrepro\n\n## Cause\ncause\n\n## Fix\nfix\n\n## Verification\nran tests\n\nFixes #42\n"
        result = tool.execute({"title": "fix: x", "body": body}, _ctx())
    finally:
        _stop_loop(loop, thread)

    # Both bun stages ran, and fix preceded check.
    assert fix_calls.read_text() == "called"
    assert check_calls.read_text() == "called"
    # The formatter diff was committed by the bot as a "style:" commit.
    log = subprocess.run(
        ["git", "-C", str(ws.repo_dir), "log", "--format=%an|%ae|%s", "-2"],
        capture_output=True,
        text=True,
        check=True,
    )
    lines = log.stdout.strip().splitlines()
    assert lines[0] == "robomp-bot|robomp-bot@example.invalid|style: bun run fix"
    assert lines[1].endswith("|feat: initial change")
    # Worktree is clean again (gate before push would have rejected otherwise).
    status = subprocess.run(
        ["git", "-C", str(ws.repo_dir), "status", "--porcelain"],
        capture_output=True,
        text=True,
        check=True,
    )
    assert status.stdout == ""
    # The PR actually opened.
    assert "opened #7" in result
    assert opened_pr["url"].endswith("/repos/octo/widget/pulls")
    refs = subprocess.run(
        ["git", "-C", str(bare), "for-each-ref", "--format=%(refname)"],
        capture_output=True,
        text=True,
        check=True,
    )
    assert f"refs/heads/{ws.branch}" in refs.stdout.splitlines()


def test_gh_open_pr_refuses_dirty_worktree_before_fix(
    db: Database, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A pre-existing uncommitted edit MUST cause gh_open_pr (and gh_push_branch)
    to refuse BEFORE `bun run fix` runs — otherwise `git add -A` after fix
    would silently fold the unrelated edit into the `style: bun run fix`
    commit and ship it in the PR."""
    import os
    import subprocess

    bare = tmp_path / "upstream.git"
    bare.mkdir()
    subprocess.run(["git", "init", "--bare", "--initial-branch=main", str(bare)], check=True, capture_output=True)
    seed = tmp_path / "seed"
    seed.mkdir()
    env = os.environ | {
        "GIT_AUTHOR_NAME": "robomp-bot",
        "GIT_AUTHOR_EMAIL": "robomp-bot@example.invalid",
        "GIT_COMMITTER_NAME": "robomp-bot",
        "GIT_COMMITTER_EMAIL": "robomp-bot@example.invalid",
    }
    subprocess.run(["git", "init", "--initial-branch=main", str(seed)], check=True, capture_output=True)
    (seed / "README.md").write_text("init\n")
    for cmd in (
        ["git", "-C", str(seed), "add", "."],
        [
            "git",
            "-C",
            str(seed),
            "-c",
            "user.email=robomp-bot@example.invalid",
            "-c",
            "user.name=robomp-bot",
            "commit",
            "-m",
            "init",
        ],
        ["git", "-C", str(seed), "remote", "add", "origin", str(bare)],
        ["git", "-C", str(seed), "push", "origin", "main"],
    ):
        subprocess.run(cmd, check=True, capture_output=True, env=env)

    from robomp.sandbox import SandboxManager

    mgr = SandboxManager(tmp_path / "workspaces")
    ws = mgr.ensure_workspace(
        repo="octo/widget",
        number=42,
        title="dirty before fix",
        clone_url=str(bare),
        default_branch="main",
        author_name="robomp-bot",
        author_email="robomp-bot@example.invalid",
    )

    # `bun run fix` is a no-op; `bun check` would also pass. The bug being
    # tested is the staging order, not the formatter's behavior.
    fakebin = tmp_path / "fakebin"
    fakebin.mkdir()
    fake_bun = fakebin / "bun"
    fake_bun.write_text("#!/bin/sh\nexit 0\n")
    fake_bun.chmod(0o755)
    monkeypatch.setenv("PATH", f"{fakebin}{os.pathsep}{os.environ['PATH']}")

    # Commit a clean package.json + tracked source; then leave an UNRELATED
    # uncommitted edit sitting in the worktree (the kind of thing the agent
    # forgot to commit).
    (ws.repo_dir / "package.json").write_text(
        json.dumps({"scripts": {"fix": "...", "check": "..."}}) + "\n",
        encoding="utf-8",
    )
    (ws.repo_dir / "src.txt").write_text("clean\n")
    subprocess.run(
        ["git", "-C", str(ws.repo_dir), "add", "package.json", "src.txt"],
        check=True,
        capture_output=True,
    )
    subprocess.run(
        [
            "git",
            "-C",
            str(ws.repo_dir),
            "-c",
            "user.email=robomp-bot@example.invalid",
            "-c",
            "user.name=robomp-bot",
            "commit",
            "-m",
            "feat: committed work",
        ],
        check=True,
        capture_output=True,
        env=env,
    )
    head_before = subprocess.run(
        ["git", "-C", str(ws.repo_dir), "rev-parse", "HEAD"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    # Now plant the stowaway edit that the agent forgot.
    (ws.repo_dir / "src.txt").write_text("STOWAWAY uncommitted edit\n")

    github = GitHubClient("tok", transport=httpx.MockTransport(lambda r: httpx.Response(500)))
    loop, thread = _make_loop_in_background()
    try:
        bindings = ToolBindings(
            db=db,
            github=github,
            git_transport=LocalGitTransport(token=None),
            repo=_stub_repo(),
            issue=IssueInfo(
                repo="octo/widget",
                number=42,
                title="t",
                body="",
                state="open",
                author="alice",
                labels=(),
                is_pull_request=False,
            ),
            workspace=ws,
            loop=loop,
            author_name="robomp-bot",
            author_email="robomp-bot@example.invalid",
        )
        db.upsert_issue(
            key=bindings.issue_key,
            repo="octo/widget",
            number=42,
            state="reproducing",
            branch=ws.branch,
            session_dir=str(ws.session_dir),
        )
        push_tool = next(x for x in build(bindings) if x.name == "gh_push_branch")
        with pytest.raises(RpcCommandError) as exc:
            push_tool.execute({}, _ctx())
        assert "dirty worktree" in str(exc.value).lower()

        pr_tool = next(x for x in build(bindings) if x.name == "gh_open_pr")
        body = "## Repro\nr\n\n## Cause\nc\n\n## Fix\nf\n\n## Verification\nv\n\nFixes #42\n"
        with pytest.raises(RpcCommandError) as exc2:
            pr_tool.execute({"title": "fix: x", "body": body}, _ctx())
        assert "dirty worktree" in str(exc2.value).lower()
    finally:
        _stop_loop(loop, thread)

    # HEAD is unchanged: the unrelated edit was NEVER committed.
    head_after = subprocess.run(
        ["git", "-C", str(ws.repo_dir), "rev-parse", "HEAD"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    assert head_after == head_before
    # The stowaway edit is still sitting uncommitted in the worktree.
    status = subprocess.run(
        ["git", "-C", str(ws.repo_dir), "status", "--porcelain"],
        capture_output=True,
        text=True,
        check=True,
    )
    assert "src.txt" in status.stdout
    # No commit named "style: bun run fix" exists.
    log = subprocess.run(
        ["git", "-C", str(ws.repo_dir), "log", "--format=%s"],
        capture_output=True,
        text=True,
        check=True,
    )
    assert "style: bun run fix" not in log.stdout
    # Origin's farm/* branch was never created — push refused before reaching the network.
    refs = subprocess.run(
        ["git", "-C", str(bare), "for-each-ref", "--format=%(refname)"],
        capture_output=True,
        text=True,
        check=True,
    )
    assert not any(r.startswith("refs/heads/farm/") for r in refs.stdout.splitlines())


def test_gh_open_pr_skips_fix_when_no_script(db: Database, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """No `scripts.fix` entry → fix stage is a no-op even if `scripts.check` exists."""
    import os
    import subprocess

    bare = tmp_path / "upstream.git"
    bare.mkdir()
    subprocess.run(["git", "init", "--bare", "--initial-branch=main", str(bare)], check=True, capture_output=True)
    seed = tmp_path / "seed"
    seed.mkdir()
    env = os.environ | {
        "GIT_AUTHOR_NAME": "robomp-bot",
        "GIT_AUTHOR_EMAIL": "robomp-bot@example.invalid",
        "GIT_COMMITTER_NAME": "robomp-bot",
        "GIT_COMMITTER_EMAIL": "robomp-bot@example.invalid",
    }
    subprocess.run(["git", "init", "--initial-branch=main", str(seed)], check=True, capture_output=True)
    (seed / "README.md").write_text("init\n")
    for cmd in (
        ["git", "-C", str(seed), "add", "."],
        [
            "git",
            "-C",
            str(seed),
            "-c",
            "user.email=robomp-bot@example.invalid",
            "-c",
            "user.name=robomp-bot",
            "commit",
            "-m",
            "init",
        ],
        ["git", "-C", str(seed), "remote", "add", "origin", str(bare)],
        ["git", "-C", str(seed), "push", "origin", "main"],
    ):
        subprocess.run(cmd, check=True, capture_output=True, env=env)

    from robomp.sandbox import SandboxManager

    mgr = SandboxManager(tmp_path / "workspaces")
    ws = mgr.ensure_workspace(
        repo="octo/widget",
        number=42,
        title="no fix script",
        clone_url=str(bare),
        default_branch="main",
        author_name="robomp-bot",
        author_email="robomp-bot@example.invalid",
    )

    fix_calls = tmp_path / "fix-calls"
    check_calls = tmp_path / "check-calls"
    fakebin = tmp_path / "fakebin"
    fakebin.mkdir()
    fake_bun = fakebin / "bun"
    fake_bun.write_text(
        "#!/bin/sh\n"
        'if [ "$1" = "run" ] && [ "$2" = "fix" ]; then\n'
        f"    printf called >> {fix_calls}\n"
        "    exit 0\n"
        "fi\n"
        'if [ "$1" = "check" ]; then\n'
        f"    printf called >> {check_calls}\n"
        "    exit 0\n"
        "fi\n"
        "exit 2\n"
    )
    fake_bun.chmod(0o755)
    monkeypatch.setenv("PATH", f"{fakebin}{os.pathsep}{os.environ['PATH']}")

    (ws.repo_dir / "package.json").write_text(
        json.dumps({"scripts": {"check": "..."}}) + "\n",
        encoding="utf-8",
    )
    subprocess.run(["git", "-C", str(ws.repo_dir), "add", "package.json"], check=True, capture_output=True)
    subprocess.run(
        [
            "git",
            "-C",
            str(ws.repo_dir),
            "-c",
            "user.email=robomp-bot@example.invalid",
            "-c",
            "user.name=robomp-bot",
            "commit",
            "-m",
            "feat: x",
        ],
        check=True,
        capture_output=True,
        env=env,
    )

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            201,
            json={
                "number": 7,
                "html_url": "https://github.com/octo/widget/pull/7",
                "head": {"ref": ws.branch},
                "base": {"ref": "main"},
                "state": "open",
            },
        )

    github = GitHubClient("tok", transport=httpx.MockTransport(handler))
    loop, thread = _make_loop_in_background()
    try:
        bindings = ToolBindings(
            db=db,
            github=github,
            git_transport=LocalGitTransport(token=None),
            repo=_stub_repo(),
            issue=IssueInfo(
                repo="octo/widget",
                number=42,
                title="t",
                body="",
                state="open",
                author="alice",
                labels=(),
                is_pull_request=False,
            ),
            workspace=ws,
            loop=loop,
            author_name="robomp-bot",
            author_email="robomp-bot@example.invalid",
        )
        db.upsert_issue(
            key=bindings.issue_key,
            repo="octo/widget",
            number=42,
            state="reproducing",
            branch=ws.branch,
            session_dir=str(ws.session_dir),
        )
        tool = next(x for x in build(bindings) if x.name == "gh_open_pr")
        body = "## Repro\nrepro\n\n## Cause\ncause\n\n## Fix\nfix\n\n## Verification\nran tests\n\nFixes #42\n"
        result = tool.execute({"title": "fix: x", "body": body}, _ctx())
    finally:
        _stop_loop(loop, thread)

    assert not fix_calls.exists()
    assert check_calls.read_text() == "called"
    assert "opened #7" in result
