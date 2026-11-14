# OMK AdaptOrch dispatch bridge

Python bridge from an OMK task to AdaptOrch's engine. It runs under AdaptOrch's own
interpreter and is not part of any npm package.

| Step | Engine call | Bridge output |
| --- | --- | --- |
| 1. Role split | `adaptorch.aeg_te.routing.route_topologies(profile, Budget, templates)` | `role_plan` |
| 2. DAG routing | `TaskDAG.from_payload` + `TopologyRouter().route(dag)` | `dag`, `routing` |
| 3. Dispatch | `compile_ready_schedule` + `execute_ready_schedule` for `parallel`/`hybrid`; `run_bounded_stage` per router stage otherwise | `scheduling`, `outputs` |

## Input

`dispatch.schema.json` (`omk.adaptorch.dispatch.v1`) accepts one of two forms:

- Role plan: `task`, `profile`, `budget.max_cost`, optional `templates` and `role_tokens`.
- Explicit DAG: `task`, `subtasks`, `dependencies` (`from`/`to`, optional `coupling`).

`scheduling` sets `max_workers`, `max_in_flight_tokens`, `priority`
(`critical_path`/`fifo`) and `timeout_s`. Token values are work proxies for admission and
priority, not token or USD limits.

The edges between roles are an OMK convention, not engine semantics. Inside one template
instance, roles are grouped by rank (`locator`/`selector` 0, patchers and
`strong_rewriter` 1, `cross_reviewer` 2, `apply_repairer` 3) and each group depends on the
previous one. A `selector` also depends on the final group of every other template
instance.

With the engine's default templates, `strong_direct_anchor` has the highest utility every
round, so the plan repeats that template until the budget runs out. Pass `templates` to
get a mixed role plan; the engine's AEG-TE pipeline takes the same override.

`example-request.json` carries an OMK pool of four templates: `omk_patch_anchor` (seeded
by `always_include`), `omk_explore_then_patch` (locator, then patch),
`omk_patch_review_repair` (patch, review, repair) and `omk_select_then_rewrite`. Its
priors are hand-set so the greedy utility alternates: explore wins round 1 on diversity,
review wins round 2 on apply probability and regression risk, and the anchor's
utility stays below both, so it is not repeated. They are not measured values.
`topology_utility` ignores `profile`, so the plan depends only on the pool and
`budget.max_cost`.

## Run

```bash
PY="${ADAPTORCH_REPO:-$HOME/Project/adaptorch}/.venv/bin/python"

# Plan only: no node runs.
"$PY" scripts/adaptorch-dispatch/omk_dispatch_cli.py --input scripts/adaptorch-dispatch/example-request.json

# Execute: the command runs once per ready node, reads the node request JSON
# (node_id, role, description, upstream, round) on stdin and prints the node output.
"$PY" scripts/adaptorch-dispatch/omk_dispatch_cli.py --input request.json \
  --node-timeout 600 --handler-cmd ./my-node-runner.sh
```

A handler that calls `omk -p` or another model runner makes provider calls; choose that
command explicitly. From Python, call `await dispatch(request, handler)` with an
`async def handler(node: NodeRequest) -> str`.

The report sets `claim_boundary.is_correctness_proof` to `false`: a routing decision or
a completed schedule says nothing about whether node outputs are correct.

## Test

```bash
cd scripts/adaptorch-dispatch
PYTHONDONTWRITEBYTECODE=1 "$PY" -m pytest -q -p no:cacheprovider test_omk_dispatch.py
```
