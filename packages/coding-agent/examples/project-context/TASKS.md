# Tasks

Use small, independently verifiable steps. Keep exactly one item `active` when work is underway; do not start a new item before recording the current item's outcome.

## Status values

- `pending`: not started
- `active`: the single current step
- `done`: acceptance evidence passed and recorded in `PROGRESS.md`
- `blocked`: a concrete blocker prevents progress

## Queue

| ID | Status | Step | Acceptance condition | Depends on |
| --- | --- | --- | --- | --- |
| T01 | active | Fill in the product and project constraints in `PRD.md` and `RULES.md`. | Target users, goals, non-goals, acceptance conditions, and prohibited actions are explicit. | None |
| T02 | pending | Record the initial architecture and design direction. | Stack, folder ownership, data flow, and relevant design decisions are documented. | T01 |
| T03 | pending | Implement the first thin vertical slice. | Its focused acceptance check passes and the result is recorded. | T02 |

## Adding work

- Split independent outcomes into separate items.
- Give every item an observable acceptance condition.
- Keep discovery, implementation, verification, and documentation together when they form one outcome.
