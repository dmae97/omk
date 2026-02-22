# Bash

Executes bash command in shell session for terminal operations like git, bun, cargo, python.

<instruction>
- Use `cwd` parameter to set working directory instead of `cd dir && ...`
- Use `;` only when later commands should run regardless of earlier failures
- `skill://` URIs are auto-resolved to filesystem paths before execution
	- `python skill://my-skill/scripts/init.py` runs the script from the skill directory
	- `skill://<name>/<relative-path>` resolves within the skill's base directory
- `agent://`, `artifact://`, `plan://`, `memory://`, `rule://`, and `docs://` URIs are also auto-resolved to filesystem paths before execution
{{#if asyncEnabled}}
- Use `async: true` for long-running commands when you don't need immediate output; the call returns a background job ID and the result is delivered automatically as a follow-up.
- Use `read jobs://` to inspect all background jobs and `read jobs://<job_id>` for detailed status/output when needed.
- Do NOT `sleep`, busy-wait, or poll in loops for async completion. Continue with other work or yield; completion arrives automatically.
{{/if}}
</instruction>

<output>
Returns the output, and an exit code from command execution.
- If output truncated, full output stored under $ARTIFACTS and referenced as `artifact://<id>` in metadata
- Exit codes shown on non-zero exit
</output>

<critical>
- Do NOT use Bash for these operations like read, grep, find, edit, write, where specialized tools exist.
- Do NOT use `2>&1` pattern, stdout and stderr are already merged.
- Do NOT use `| head -n 50` or `| tail -n 100` pattern, use `head` and `tail` parameters instead.
</critical>