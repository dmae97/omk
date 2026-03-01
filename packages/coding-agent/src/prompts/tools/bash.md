Executes bash command in shell session for terminal operations like git, bun, cargo, python.

<instruction>
- You **MUST** use `cwd` parameter to set working directory instead of `cd dir && …`
- PTY mode is opt-in: set `pty: true` only when command expects a real terminal (for example `sudo`, `ssh` where you need input from the user); default is `false`
- You **MUST** use `;` only when later commands should run regardless of earlier failures
- `skill://` URIs are auto-resolved to filesystem paths before execution
	- `python skill://my-skill/scripts/init.py` runs the script from the skill directory
	- `skill://<name>/<relative-path>` resolves within the skill's base directory
- Internal URLs are also auto-resolved to filesystem paths before execution.
{{#if asyncEnabled}}
- Use `async: true` for long-running commands when you don't need immediate output; the call returns a background job ID and the result is delivered automatically as a follow-up.
- Use `read jobs://` to inspect all background jobs and `read jobs://<job-id>` for detailed status/output when needed.
- When you need to wait for async results before continuing, call `await` — it blocks until jobs complete. Do NOT poll `read jobs://` in a loop or yield and hope for delivery.
{{/if}}
</instruction>

<output>
Returns the output, and an exit code from command execution.
- If output truncated, full output can be retrieved from `artifact://<id>`, linked in metadata
- Exit codes shown on non-zero exit
</output>

<critical>
You **MUST** use specialized tools instead of bash for ALL file operations:

|Instead of (WRONG)|Use (CORRECT)|
|---|---|
|`cat file`, `head -n N file`|`read(path="file", limit=N)`|
|`cat -n file \|sed -n '50,150p'`|`read(path="file", offset=50, limit=100)`|
|`grep -A 20 'pat' file`|`grep(pattern="pat", path="file", post=20)`|
|`grep -rn 'pat' dir/`|`grep(pattern="pat", path="dir/")`|
|`rg 'pattern' dir/`|`grep(pattern="pattern", path="dir/")`|
|`find dir -name '*.ts'`|`find(pattern="dir/**/*.ts")`|
|`ls dir/`|`read(path="dir/")`|
|`cat <<'EOF' > file`|`write(path="file", content="...")`|
|`sed -i 's/old/new/' file`|`edit(path="file", edits=[...])`|
- If `ast_grep` / `ast_edit` tools are available in the session, you **MUST** use them for structural code search/rewrites instead of bash `grep`/`sed`/`awk`/`perl` pipelines
- Bash is for command execution, not syntax-aware code transformation; prefer `ast_grep` for discovery and `ast_edit` for codemods
- You **MUST NOT** use Bash for these operations like read, grep, find, edit, write, where specialized tools exist.
- You **MUST NOT** use `2>&1` | `2>/dev/null` pattern, stdout and stderr are already merged.
- You **MUST NOT** use `| head -n 50` or `| tail -n 100` pattern, use `head` and `tail` parameters instead.
</critical>