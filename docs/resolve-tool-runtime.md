# Resolve tool runtime internals

This document explains how preview/apply workflows are modeled in coding-agent and how custom tools can participate via `pushPendingAction`.

## Scope and key files

- [`src/tools/resolve.ts`](../packages/coding-agent/src/tools/resolve.ts)
- [`src/tools/pending-action.ts`](../packages/coding-agent/src/tools/pending-action.ts)
- [`src/tools/ast-edit.ts`](../packages/coding-agent/src/tools/ast-edit.ts)
- [`src/extensibility/custom-tools/types.ts`](../packages/coding-agent/src/extensibility/custom-tools/types.ts)
- [`src/extensibility/custom-tools/loader.ts`](../packages/coding-agent/src/extensibility/custom-tools/loader.ts)
- [`src/sdk.ts`](../packages/coding-agent/src/sdk.ts)

## What `resolve` does

`resolve` is a hidden tool that finalizes a pending preview action.

- `action: "apply"` executes `apply(reason)` on the pending action and persists changes.
- `action: "discard"` invokes `reject(reason)` if provided; otherwise drops the action with a default "Discarded" message.

If no pending action exists, `resolve` fails with:

- `No pending action to resolve. Nothing to apply or discard.`

## Pending actions are a stack (LIFO)

Pending actions are stored in `PendingActionStore` as a push/pop stack:

- `push(action)` adds a new pending action on top.
- `peek()` inspects the current top action.
- `pop()` removes and returns the top action.
- `hasPending` indicates whether the stack is non-empty.

`resolve` always consumes the **topmost** pending action first (`pop()`), so multiple preview-producing tools resolve in reverse order of registration.

## Built-in producer example (`ast_edit`)

`ast_edit` previews structural replacements first. When the preview has replacements and is not applied yet, it pushes a pending action that contains:

- label (human-readable summary)
- `sourceToolName` (`ast_edit`)
- `apply(reason: string)` callback that reruns AST edit with `dryRun: false`

`resolve(action="apply", reason="...")` passes `reason` into this callback.

## Custom tools: `pushPendingAction`

Custom tools can register resolve-compatible pending actions through `CustomToolAPI.pushPendingAction(...)`.

`CustomToolPendingAction`:

- `label: string` (required)
- `apply(reason: string): Promise<AgentToolResult<unknown>>` (required) — invoked on apply; `reason` is the string passed to `resolve`
- `reject?(reason: string): Promise<AgentToolResult<unknown> | undefined>` (optional) — invoked on discard; return value replaces the default "Discarded" message if provided
- `details?: unknown` (optional)
- `sourceToolName?: string` (optional, defaults to `"custom_tool"`)

### Minimal usage example

```ts
import type { CustomToolFactory } from "@oh-my-pi/pi-coding-agent";

const factory: CustomToolFactory = pi => ({
	name: "batch_rename_preview",
	label: "Batch Rename Preview",
	description: "Previews renames and defers commit to resolve",
	parameters: pi.typebox.Type.Object({
		files: pi.typebox.Type.Array(pi.typebox.Type.String()),
	}),

	async execute(_toolCallId, params) {
		const previewSummary = `Prepared rename plan for ${params.files.length} files`;

		pi.pushPendingAction({
			label: `Batch rename: ${params.files.length} files`,
			sourceToolName: "batch_rename_preview",
			apply: async (reason) => {
				// apply writes here
				return {
					content: [{ type: "text", text: `Applied batch rename. Reason: ${reason}` }],
				};
			},
			reject: async (reason) => {
				// optional: cleanup or notify on discard
				return {
					content: [{ type: "text", text: `Discarded batch rename. Reason: ${reason}` }],
				};
			},
		});

		return {
			content: [{ type: "text", text: `${previewSummary}. Call resolve to apply or discard.` }],
		};
	},
});

export default factory;
```

## Runtime availability and failures

`pushPendingAction` is wired by the custom tool loader using the active session `PendingActionStore`.

If the runtime has no pending-action store, `pushPendingAction` throws:

- `Pending action store unavailable for custom tools in this runtime.`

## Tool-choice behavior

When `PendingActionStore.hasPending` is true, the agent runtime biases tool choice to `resolve` so pending previews are explicitly finalized before normal tool flow continues.

## Developer guidance

- Use pending actions only for destructive or high-impact operations that should support explicit apply/discard.
- Keep `label` concise and specific; it is shown in resolve renderer output.
- Ensure `apply(reason)` is deterministic and idempotent enough for one-shot execution; `reason` is informational and should not change behavior.
- Implement `reject(reason)` when the discard needs cleanup (temp state, locks, notifications); omit it for stateless previews where the default message suffices.
- If your tool can stage multiple previews, remember LIFO semantics: latest pushed action resolves first.
