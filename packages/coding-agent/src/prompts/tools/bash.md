# Bash

Executes bash command in shell session for terminal operations like git, bun, cargo, python.

<instruction>
- You MUST use `cwd` parameter to set working directory instead of `cd dir && …`
- PTY mode is opt-in: set `pty: true` only when command expects a real terminal (for example `sudo`, `ssh` where you need input from the user); default is `false`
- You MUST use `;` only when later commands should run regardless of earlier failures
- `skill://` URIs are auto-resolved to filesystem paths before execution
	- `python skill://my-skill/scripts/init.py` runs the script from the skill directory
	- `skill://<name>/<relative-path>` resolves within the skill's base directory
- Internal URLs are also auto-resolved to filesystem paths before execution.
{{#if asyncEnabled}}
- Use `async: true` for long-running commands when you don't need immediate output; the call returns a background job ID and the result is delivered automatically as a follow-up.
- Use `read jobs://` to inspect all background jobs and `read jobs://<job-id>` for detailed status/output when needed.
- When you need to wait for async results before continuing, you MUST call `poll_jobs` — it blocks until jobs complete. You MUST NOT poll `read jobs://` in a loop or yield and hope for delivery.
{{/if}}
</instruction>

<output>
Returns the output, and an exit code from command execution.
- Exit codes shown on non-zero exit
</output>

<critical>
- You MUST NOT use Bash for these operations like read, grep, find, edit, write, where specialized tools exist.
- You MUST NOT use `2>&1` | `2>/dev/null` pattern, stdout and stderr are already merged.
- You MUST NOT use `| head -n 50` or `| tail -n 100` pattern, use `head` and `tail` parameters instead.
</critical>