# OMK context compatibility

@AGENTS.md

`AGENTS.md` in this directory is the shared source of user instructions. Claude
Code supports the import above; OMK does not expand `@` imports and prefers
`AGENTS.md` over `CLAUDE.md` in the same directory. If reading this file as a
fallback, read the sibling `AGENTS.md` when it exists.

This file does not install Claude Code, configure credentials, or import a
provider's system prompt. A Claude model selected inside OMK still uses OMK's
available tools and commands, not Claude Code's tool names or configuration.

OMK does not discover `~/.claude/CLAUDE.md` as global context. Claude Code does
not automatically discover this OMK config directory either. Sharing these
instructions with another host is an explicit user choice; adapt imports for
that host instead of assuming identical loading, permissions, hooks, or skills.
