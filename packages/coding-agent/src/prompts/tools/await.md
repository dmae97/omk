Blocks until one or more background jobs complete, fail, or are cancelled.

You **MUST** use this instead of polling `read jobs://` in a loop when you need to wait for background task or bash results before continuing.

Returns the status and results of all watched jobs once at least one finishes.
