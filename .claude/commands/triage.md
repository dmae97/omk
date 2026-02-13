# Triage Command

Classify and label open GitHub issues that are missing labels.

## Arguments

- `$ARGUMENTS`: Scope filter — `open` (default), `closed`, or `all`. Append `--relabel` to re-classify issues that already have labels.

## Steps

### 1. Fetch Issues

Parse `$ARGUMENTS` to determine scope and whether `--relabel` is set.

```bash
# For open (default):
gh issue list --state open --json number,title,body,labels,comments,createdAt --limit 50

# For closed:
gh issue list --state closed --json number,title,body,labels,comments,createdAt --limit 30

# For all: run both commands and merge results
```

### 2. Filter Candidates

- If `--relabel` is NOT set, skip any issue that already has at least one label.
- If `--relabel` IS set, process all fetched issues.

### 3. Classify Each Issue

For each candidate issue, read the title, body, and **all comments** (comments often contain critical context). Apply labels from the categories below. An issue can receive multiple labels.

**Type labels** (pick exactly one):
| Label | Signals |
|---|---|
| `bug` | Crashes, errors, stack traces, regressions, "doesn't work", "broke" |
| `enhancement` | Feature requests, integrations, "would be nice", "could we add" |
| `question` | How-to, usage help, "is it possible", "how do I" |
| `documentation` | Docs missing, incorrect, or outdated |
| `invalid` | Spam, off-topic, not actionable |
| `duplicate` | Clearly duplicates another open issue (note the original in a comment) |

**Area labels** (pick all that apply):
| Label | Signals |
|---|---|
| `auth` | OAuth, login, API keys, tokens, authentication, authorization |
| `cli` | Slash commands, CLI arguments, flags, command parsing |
| `providers` | LLM provider-specific (Google, OpenAI, Anthropic, Gemini, Ollama, etc.) |
| `setup` | Installation, build errors, dependency issues, first-run problems |
| `tui` | TUI rendering, display glitches, terminal width, color, layout |
| `ux` | UX improvements that are not bugs — workflow, ergonomics, usability |

**Platform labels** (pick all that apply):
| Label | Signals |
|---|---|
| `platform:linux` | Mentions Linux, Docker, Ubuntu, Debian, Fedora, Arch |
| `platform:macos` | Mentions macOS, Mac, Homebrew, Darwin |
| `platform:windows` | Mentions Windows (native), PowerShell, cmd.exe |
| `platform:wsl` | Mentions WSL or Windows Subsystem for Linux — distinct from both native Windows and Linux |

**Meta labels** (use sparingly, only when clearly appropriate):
| Label | Signals |
|---|---|
| `good first issue` | Well-scoped, self-contained, good for new contributors |
| `help wanted` | Maintainers want community help |
| `wontfix` | Intentional behavior, out of scope |

### 4. Apply Labels

For each issue, apply the chosen labels. **Never remove existing labels.**

```bash
gh issue edit <number> --add-label "bug,tui,platform:linux"
```

### 5. Print Summary

After processing all issues, print a markdown summary table:

```
## Triage Summary

| # | Title | Added Labels | Skipped |
|---|-------|-------------|---------|
| 42 | TUI crashes on resize | bug, tui | |
| 38 | Add Ollama support | enhancement, providers | |
| 35 | How to configure API key | question, auth | |
| 30 | Dashboard colors | | Already labeled |
```

Include counts at the end: `Processed: X | Labeled: Y | Skipped: Z`

## Classification Tips

- When uncertain between `bug` and `enhancement`, check if existing behavior broke (bug) or new behavior is requested (enhancement).
- If an issue mentions a specific provider AND another area (e.g., "OpenAI auth fails"), apply both `providers` and `auth`.
- WSL issues get `platform:wsl` — not `platform:linux` or `platform:windows`.
- Don't apply `good first issue` or `help wanted` during automated triage — those require maintainer judgment.
- If the body is empty or unclear, read the comments before skipping. Users often clarify in replies.
