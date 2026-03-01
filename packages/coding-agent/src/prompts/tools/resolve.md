Resolves a pending preview action by either applying or discarding it.
- `action` is required:
  - `"apply"` persists the pending changes.
  - `"discard"` rejects the pending changes.
- `reason` is required and must explain why you chose to apply or discard.

This tool is only valid when a pending action exists (typically after a preview step).
If no pending action exists, the call fails with an error.