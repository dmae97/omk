# User context setup

OMK's shared defaults are provider-neutral, editable markdown. They do not ship
an operator's personal configuration, install skills, or enable external services.

## Initialize an installed OMK

```bash
omk init --global --dry-run
omk init --global
```

The first command previews the operation without creating even the target directory.
The second creates missing documents in `~/.omk/agent/`. Both are offline and return
before migrations, settings, credentials, sessions, extensions, and model startup.
There is no install hook: installing or updating the npm package does not alter
user instructions, including when installed with `--ignore-scripts`.

Choose another user config directory with the existing environment override:

```bash
OMK_CODING_AGENT_DIR="/path/to/omk-config" omk init --global --dry-run
OMK_CODING_AGENT_DIR="/path/to/omk-config" omk init --global
```

Use the same override when starting OMK. PowerShell users can set
`$env:OMK_CODING_AGENT_DIR` before running the commands. Paths with spaces and
non-ASCII characters are supported. The destination must be a real directory,
not a file or symlink; parent directories should be trusted and user-controlled.
New files use owner-only permissions on POSIX. Existing directory modes are unchanged.

`--global` is required; `init` without a scope or with unsupported flags exits `2`.
`--help` exits `0`. Setup and preservation succeed with `0`; file or template errors
exit `1`. `--offline` is accepted but not needed for this command.

## Documents and loading

| File | Purpose | Loading |
| --- | --- | --- |
| `AGENTS.md` | Work, verification, permissions, skills, runtime identity | Preferred global context entry point |
| `INTERNET.md` | Source selection, freshness, citations, network permissions | Read on demand when web work is needed |
| `CLAUDE.md` | Thin interoperability entry point referring to `AGENTS.md` | OMK fallback; another host needs explicit configuration |

OMK's entry-point search order within each directory is `AGENTS.md`, `AGENTS.MD`,
`CLAUDE.md`, then `CLAUDE.MD`; only the first readable file is used. Global context
loads before ancestor and working-directory context. Markdown links and Claude Code
`@` imports are not expanded by OMK. `INTERNET.md` and `SOUL.md` are not automatically
loaded by filename. The starter `AGENTS.md` tells the agent to read `INTERNET.md`
when relevant, so ordinary coding tasks do not carry the whole web guide.

Existing compatibility files `AGENTS.override.md`, `AGENTS.GODMODE.md`, `GODMODE.md`,
and `ENI.override.md` are also discovered in global and ancestor directories.
Setup does not generate, import, modify, or delete them. Review old files yourself
when migrating: installing a new guide does not retire an old override.

`--no-context-files` disables discovery. Claude models inside OMK omit discovered
context by default; `OMK_CLAUDE_CONTEXT_FILES=1` restores it. Setup does not change
that provider behavior or write the environment override. See [Usage](usage.md#context-files)
and [Environment variables](environment-variables.md).

## Preserve and customize

- No `--force` or automatic overwrite mode is provided. Re-running setup preserves
  existing files, including symlinks and directories at a document filename.
- If any case variant of `AGENTS.md` or `CLAUDE.md` already exists, setup skips both
  entry-point templates. This avoids shadowing a Claude-only or uppercase setup,
  and avoids a new compatibility import pointing to the wrong filename.
- A missing `INTERNET.md` can still be created. Any existing case variant is preserved.
- `settings.json`, authentication, models, MCP configuration, installed packages,
  skills, shell profiles, other hosts' directories, and project files are untouched.
- Required templates are read before writing. An I/O failure while writing can leave
  earlier files created; setup is not a multi-file transaction. Review the output
  before retrying. Exclusive file creation prevents overwriting a concurrent file.

Back up existing documents before manually merging the defaults. Put project commands
in the project's `AGENTS.md`, local preferences in your global file or
`AGENTS.override.md`, and no credentials in either. Keep changes small and reload
with `/reload` or restart OMK. Already-recorded conversation text is not erased by reload.

For optional user-installed skills and `defaultActiveSkills`, see [Skills](skills.md)
and [Settings](settings.md). Neither a skill nor a markdown policy grants tool access.

## Distribution and interoperability

The templates live in [`examples/context/`](../examples/context/) inside the package.
Existing npm `files` and binary asset-copy rules include `examples/`; the initializer
resolves that directory from the installed package, not from a developer's checkout.
`OMK_PACKAGE_DIR` retains its documented package-root override.

The same templates can be reviewed and copied manually from a source checkout.
`CLAUDE.md` uses a sibling `@AGENTS.md` import for Claude Code, but OMK does not install
it into `~/.claude/`. Opt into sharing from that host with an import to the actual
file path. Other hosts retain their own tool names, hooks, permission model, and
configuration; using a Claude model in OMK is not running Claude Code.

Public defaults are authored in the repository. Do not create a distribution by
copying a maintainer's agent home, credentials, private skills, or session history.
