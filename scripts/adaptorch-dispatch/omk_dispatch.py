"""OMK -> AdaptOrch dispatch bridge: role plan, DAG routing, ready-driven execution.

Run with AdaptOrch's interpreter (``$ADAPTORCH_REPO/.venv/bin/python``). Pipeline:
1. ``route_topologies`` picks role templates under a cost budget (AEG-TE priors);
2. the roles become a ``TaskDAG`` routed by ``TopologyRouter``;
3. ``execute_ready_schedule`` admits ready nodes (parallel/hybrid), else staged.

The role-to-DAG edge mapping below is an OMK convention, not engine semantics.
Routing and a completed schedule are advisory evidence, never a correctness proof.
Nodes run only through the caller's handler; nothing here calls a provider.
"""

from __future__ import annotations

import asyncio
import dataclasses
import time
from collections.abc import Callable, Coroutine, Mapping
from typing import Any

from adaptorch.aeg_te.models import InstanceProfile, TopologyTemplate
from adaptorch.aeg_te.routing import Budget, route_topologies
from adaptorch.dag import TaskDAG
from adaptorch.dag_scheduling import READY_SCHEDULING_TOPOLOGIES, DAGSchedulingConfig
from adaptorch.guardrail_schedule import partition_guardrail_stages
from adaptorch.ready_executor import execute_ready_schedule
from adaptorch.ready_schedule import compile_ready_schedule
from adaptorch.router import TopologyRouter
from adaptorch.stage_scheduler import run_bounded_stage
from adaptorch.types import RoutingDecision

SCHEMA = "omk.adaptorch.dispatch.v1"
REPORT_SCHEMA = "omk.adaptorch.dispatch-report.v1"
# Rank inside one template instance: each rank group depends on the previous one.
ROLE_RANK = {"locator": 0, "selector": 0, "patcher": 1, "strong_patcher": 1,
             "strong_rewriter": 1, "cross_reviewer": 2, "apply_repairer": 3}
ROLE_BRIEF = {
    "locator": "find the files and symbols the change must touch",
    "selector": "pick the strongest candidate from upstream evidence",
    "patcher": "write an independent candidate patch",
    "strong_patcher": "write the anchor patch directly",
    "strong_rewriter": "rewrite a patch from upstream evidence",
    "cross_reviewer": "review the upstream patch and list defects",
    "apply_repairer": "repair the reviewed patch so it applies and passes checks",
}
# Work proxies for critical-path priority; not token or USD limits.
DEFAULT_ROLE_TOKENS = {"locator": 400, "selector": 400, "patcher": 800, "strong_patcher": 1200,
                       "strong_rewriter": 1200, "cross_reviewer": 600, "apply_repairer": 600}
_PROFILE_KEYS = {"repo", "repo_family", "task_type", "issue_terms", "retrieved_files", "difficulty"}
_TEMPLATE_KEYS = {field.name for field in dataclasses.fields(TopologyTemplate)}


@dataclasses.dataclass(frozen=True, slots=True)
class NodeRequest:
    node_id: str
    role: str | None
    description: str
    upstream: Mapping[str, str]
    round: int


NodeHandler = Callable[[NodeRequest], Coroutine[Any, Any, str]]


def build_role_payload(request: Mapping[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Step 1: AEG-TE utility routing -> TaskDAG payload plus the role plan."""
    raw = dict(request.get("profile") or {})
    unknown = set(raw) - _PROFILE_KEYS
    if unknown:
        raise ValueError(f"unknown profile keys: {sorted(unknown)}")
    for key in ("issue_terms", "retrieved_files"):
        raw[key] = tuple(raw.get(key, ()))
    pool = None
    if request.get("templates") is not None:
        pool = []
        for item in request["templates"]:
            if not {"name", "roles"} <= set(item) <= _TEMPLATE_KEYS:
                raise ValueError(f"template keys must include name, roles within {sorted(_TEMPLATE_KEYS)}")
            pool.append(TopologyTemplate(**{**item, "roles": tuple(item["roles"])}))
    budget = Budget(float(request["budget"]["max_cost"]))
    templates = route_topologies(InstanceProfile(**raw), budget, pool)
    tokens = {**DEFAULT_ROLE_TOKENS, **dict(request.get("role_tokens") or {})}
    task = request["task"]
    subtasks: list[dict[str, Any]] = []
    deps: list[dict[str, str]] = []
    plan: list[dict[str, Any]] = []
    terminals: list[str] = []
    selectors: list[str] = []
    for index, template in enumerate(templates):
        groups: dict[int, list[str]] = {}
        for slot, role in enumerate(template.roles):
            if role not in ROLE_RANK:
                raise ValueError(f"role {role!r} has no OMK rank mapping")
            node_id = f"t{index}.{template.name}.{slot}.{role}"
            brief = f"[{template.name}#{index}] {role}: {ROLE_BRIEF[role]}. Task: {task}"
            subtasks.append({"id": node_id, "role": role, "estimated_tokens": int(tokens[role]),
                             "description": brief})
            groups.setdefault(ROLE_RANK[role], []).append(node_id)
            if role == "selector":
                selectors.append(node_id)
        ranks = sorted(groups)
        for previous, current in zip(ranks, ranks[1:], strict=False):
            deps += [{"from": a, "to": b} for a in groups[previous] for b in groups[current]]
        if not any(node in selectors for node in groups[ranks[0]]):
            terminals += groups[ranks[-1]]
        plan.append({"instance": index, "template": template.name, "roles": list(template.roles)})
    # A selector consumes the final evidence of every non-selector template instance.
    deps += [{"from": t, "to": s} for s in selectors for t in terminals]
    return {"subtasks": subtasks, "dependencies": deps}, plan


def build_payload(request: Mapping[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]] | None]:
    if request.get("schema") != SCHEMA:
        raise ValueError(f"schema must be {SCHEMA}")
    if not isinstance(request.get("task"), str) or not request["task"].strip():
        raise ValueError("task must be a non-empty string")
    explicit = "subtasks" in request
    if explicit == any(k in request for k in ("budget", "profile", "templates", "role_tokens")):
        raise ValueError("give either subtasks or profile+budget, not both or neither")
    if explicit:
        return {"subtasks": list(request["subtasks"]),
                "dependencies": list(request.get("dependencies") or [])}, None
    if "budget" not in request:
        raise ValueError("role plan mode requires budget.max_cost")
    return build_role_payload(request)


def plan(request: Mapping[str, Any]) -> tuple[TaskDAG, RoutingDecision, dict[str, Any]]:
    """Steps 1-2 without execution: payload -> TaskDAG -> TopologyRouter decision."""
    payload, role_plan = build_payload(request)
    dag = TaskDAG.from_payload(payload)
    decision = TopologyRouter().route(dag)
    report = {
        "schema": REPORT_SCHEMA,
        "role_plan": role_plan,
        "dag": payload,
        "routing": {"topology": decision.topology, "reason": decision.reason,
                    "stages": [list(stage) for stage in decision.stages],
                    "features": dataclasses.asdict(decision.features)},
        "claim_boundary": {"is_correctness_proof": False, "execution": "handler-owned"},
    }
    return dag, decision, report


async def dispatch(request: Mapping[str, Any], handler: NodeHandler) -> dict[str, Any]:
    """Step 3: run every node through ``handler`` once its predecessors published."""
    dag, decision, report = plan(request)
    options = dict(request.get("scheduling") or {})
    max_workers = int(options.get("max_workers", 4))
    timeout_s = options.get("timeout_s")
    deadline = None if timeout_s is None else time.monotonic() + float(timeout_s)
    roles = {item["id"]: item.get("role") for item in report["dag"]["subtasks"]}
    outputs: dict[str, str] = {}
    rounds: dict[str, int] = {}

    async def run_node(node_id: str) -> tuple[str, str]:
        rounds[node_id] = rounds.get(node_id, 0) + 1
        upstream = {p: outputs[p] for p in dag.predecessors(node_id) if p in outputs}
        node = NodeRequest(node_id, roles.get(node_id), dag.subtasks[node_id].description,
                           upstream, rounds[node_id])
        return node_id, await handler(node)

    if decision.topology in READY_SCHEDULING_TOPOLOGIES:
        config = DAGSchedulingConfig(priority=options.get("priority", "critical_path"),
                                     max_in_flight_tokens=options.get("max_in_flight_tokens"))
        stages = partition_guardrail_stages(dag, tuple(tuple(layer) for layer in dag.layers()))
        schedule = compile_ready_schedule(dag, stages, decision.topology, config, max_workers)
        result = await execute_ready_schedule(schedule, config, run_node, outputs, max_workers, deadline)
        report["scheduling"] = {"policy": "dependency_ready", **dataclasses.asdict(result)}
    else:
        # sequential/hierarchical/debate keep the router's stage barriers.
        for stage in decision.stages:
            remaining = None if deadline is None else max(0.0, deadline - time.monotonic())
            pairs = await asyncio.wait_for(run_bounded_stage(stage, run_node, max_workers), remaining)
            outputs.update(pairs)
        report["scheduling"] = {"policy": "staged", "stages_run": len(decision.stages)}
    report["outputs"] = outputs
    return report
