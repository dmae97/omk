"""Offline tests for the OMK AdaptOrch dispatch bridge (no provider calls)."""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import pytest

from omk_dispatch import SCHEMA, NodeRequest, build_payload, dispatch, plan
from omk_dispatch_cli import command_handler, main

HERE = Path(__file__).parent


def role_request(max_cost: float = 6.0, **extra: object) -> dict[str, object]:
    return {"schema": SCHEMA, "task": "fix bug", "profile": {"difficulty": 0.6},
            "budget": {"max_cost": max_cost}, **extra}


def test_role_plan_seeds_anchor_and_respects_budget() -> None:
    _, _, report = plan(role_request(6.0))
    names = [item["template"] for item in report["role_plan"]]
    assert names[0] == "strong_direct_anchor"
    assert len(report["dag"]["subtasks"]) == sum(len(i["roles"]) for i in report["role_plan"])
    assert report["routing"]["topology"] in {
        "parallel", "sequential", "hierarchical", "hybrid", "multi_model_ensemble", "multi_turn_debate"}
    assert report["claim_boundary"]["is_correctness_proof"] is False


# always_include seeds every template once; the budget equals their summed cost.
DIVERSE = [
    {"name": "anchor", "roles": ["strong_patcher"], "cost": 1.0, "always_include": True},
    {"name": "review", "roles": ["patcher", "cross_reviewer", "apply_repairer"], "cost": 2.0,
     "always_include": True},
    {"name": "split", "roles": ["locator", "locator", "strong_patcher"], "cost": 2.0,
     "always_include": True},
    {"name": "synth", "roles": ["selector", "strong_rewriter"], "cost": 1.0, "always_include": True},
]


def test_default_priors_repeat_anchor() -> None:
    _, _, report = plan(role_request(4.0))
    assert {i["template"] for i in report["role_plan"]} == {"strong_direct_anchor"}
    assert report["dag"]["dependencies"] == []


def test_custom_templates_build_ranked_edges_and_selector_fan_in() -> None:
    payload, role_plan = build_payload(role_request(6.0, templates=DIVERSE))
    assert role_plan is not None
    assert [i["template"] for i in role_plan] == ["anchor", "review", "split", "synth"]
    assert payload["dependencies"]
    edges = {(e["from"], e["to"]) for e in payload["dependencies"]}
    selector = next(s["id"] for s in payload["subtasks"] if s["role"] == "selector")
    fan_in = {source for source, target in edges if target == selector}
    assert {s.split(".")[1] for s in fan_in} == {"anchor", "review", "split"}
    assert all(s.endswith(("strong_patcher", "apply_repairer")) for s in fan_in)
    _, decision, _ = plan(role_request(6.0, templates=DIVERSE))
    assert decision.topology in {"hybrid", "hierarchical", "sequential", "multi_turn_debate"}


def test_bad_template_rejected() -> None:
    with pytest.raises(ValueError):
        plan(role_request(4.0, templates=[{"name": "x", "roles": ["wizard"]}]))
    with pytest.raises(ValueError):
        plan(role_request(4.0, templates=[{"name": "x", "roles": ["patcher"], "prompt": "p"}]))


def test_role_edges_follow_rank_order() -> None:
    payload, _ = build_payload(role_request(6.0, templates=DIVERSE))
    assert payload["dependencies"]
    rank = {"locator": 0, "selector": 0, "patcher": 1, "strong_patcher": 1,
            "strong_rewriter": 1, "cross_reviewer": 2, "apply_repairer": 3}
    roles = {s["id"]: s["role"] for s in payload["subtasks"]}
    for edge in payload["dependencies"]:
        source, target = edge["from"], edge["to"]
        if roles[target] == "selector":
            continue
        assert source.split(".")[0] == target.split(".")[0]
        assert rank[roles[source]] < rank[roles[target]]


def test_role_plan_executes_end_to_end() -> None:
    order: list[str] = []

    async def handler(node: NodeRequest) -> str:
        assert all(p in order for p in node.upstream)
        order.append(node.node_id)
        return node.role or ""

    request = role_request(6.0, templates=DIVERSE, scheduling={"max_workers": 2})
    report = asyncio.run(dispatch(request, handler))
    assert len(order) == len(report["dag"]["subtasks"]) == len(set(order))
    assert order[-1].endswith("strong_rewriter")


def test_explicit_dag_runs_ready_and_passes_upstream() -> None:
    request = {"schema": SCHEMA, "task": "t",
               "subtasks": [{"id": i, "description": f"node {i}", "estimated_tokens": 10}
                            for i in ("a", "b", "c", "d")],
               "dependencies": [{"from": "a", "to": "c"}, {"from": "b", "to": "c"},
                                {"from": "c", "to": "d"}, {"from": "a", "to": "d"}],
               "scheduling": {"max_workers": 2, "timeout_s": 30}}
    seen: dict[str, NodeRequest] = {}

    async def handler(node: NodeRequest) -> str:
        seen[node.node_id] = node
        await asyncio.sleep(0)
        return f"out:{node.node_id}"

    report = asyncio.run(dispatch(request, handler))
    assert report["outputs"] == {n: f"out:{n}" for n in "abcd"}
    assert dict(seen["c"].upstream) == {"a": "out:a", "b": "out:b"}
    assert set(seen["d"].upstream) == {"a", "c"}
    if report["routing"]["topology"] in {"parallel", "hybrid"}:
        assert report["scheduling"]["policy"] == "dependency_ready"
        assert report["scheduling"]["completed"] == 4
        assert report["scheduling"]["peak_in_flight"] <= 2
    else:
        assert report["scheduling"]["policy"] == "staged"


def test_chain_uses_staged_sequential() -> None:
    request = {"schema": SCHEMA, "task": "t",
               "subtasks": [{"id": i, "description": i} for i in ("a", "b")],
               "dependencies": [{"from": "a", "to": "b"}]}

    async def handler(node: NodeRequest) -> str:
        return node.node_id + "|" + ",".join(node.upstream.values())

    report = asyncio.run(dispatch(request, handler))
    assert report["routing"]["topology"] == "sequential"
    assert report["scheduling"]["policy"] == "staged"
    assert report["outputs"] == {"a": "a|", "b": "b|a|"}


def test_handler_failure_propagates() -> None:
    request = {"schema": SCHEMA, "task": "t",
               "subtasks": [{"id": i, "description": i} for i in ("a", "b", "c")]}

    async def handler(node: NodeRequest) -> str:
        if node.node_id == "b":
            raise RuntimeError("boom")
        return "ok"

    with pytest.raises(RuntimeError, match="boom"):
        asyncio.run(dispatch(request, handler))


@pytest.mark.parametrize("bad", [
    {"schema": "other", "task": "t", "subtasks": [{"id": "a", "description": "a"}]},
    {"schema": SCHEMA, "task": " ", "subtasks": [{"id": "a", "description": "a"}]},
    {"schema": SCHEMA, "task": "t"},
    {"schema": SCHEMA, "task": "t", "budget": {"max_cost": 2}, "subtasks": [{"id": "a", "description": "a"}]},
    {"schema": SCHEMA, "task": "t", "profile": {"secret_field": 1}, "budget": {"max_cost": 2}},
])
def test_invalid_requests_rejected(bad: dict[str, object]) -> None:
    with pytest.raises(ValueError):
        plan(bad)


def test_command_handler_round_trip() -> None:
    script = "import json,sys; d=json.load(sys.stdin); print(d['node_id'], len(d['upstream']), end='')"
    handle = command_handler([sys.executable, "-c", script], 30.0)
    node = NodeRequest("x", "patcher", "desc", {"a": "1"}, 1)
    assert asyncio.run(handle(node)) == "x 1"


def test_command_handler_nonzero_exit() -> None:
    handle = command_handler([sys.executable, "-c", "import sys; sys.exit(3)"], 30.0)
    with pytest.raises(RuntimeError, match="exited 3"):
        asyncio.run(handle(NodeRequest("x", None, "d", {}, 1)))


def test_cli_invalid_request_exits_2(tmp_path: Path) -> None:
    bad = tmp_path / "bad.json"
    bad.write_text(json.dumps({"schema": SCHEMA, "task": "t"}), encoding="utf-8")
    assert main(["--input", str(bad)]) == 2


def test_cli_plan_only_example(tmp_path: Path) -> None:
    out = tmp_path / "report.json"
    assert main(["--input", str(HERE / "example-request.json"), "--output", str(out)]) == 0
    report = json.loads(out.read_text(encoding="utf-8"))
    assert "outputs" not in report and report["role_plan"]


def test_example_pool_mixes_explore_verify_patch() -> None:
    request = json.loads((HERE / "example-request.json").read_text(encoding="utf-8"))
    _, _, report = plan(request)
    assert [i["template"] for i in report["role_plan"]] == [
        "omk_patch_anchor", "omk_explore_then_patch", "omk_patch_review_repair",
        "omk_explore_then_patch"]
    roles = {s["role"] for s in report["dag"]["subtasks"]}
    assert {"locator", "strong_patcher", "patcher", "cross_reviewer", "apply_repairer"} <= roles
    assert report["dag"]["dependencies"]
