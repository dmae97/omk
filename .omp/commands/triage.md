# Triage Command

Classify and label **newly opened** GitHub issues that are missing labels.

## Arguments

- `$ARGUMENTS`: Optional window flag `--days <n>` (default: `7`). Only open issues created within this window are triaged.

## Steps

### 1. Fetch Issues

Parse `$ARGUMENTS` to determine the new-issue window (`--days`, default `7`).

```bash
# Build cutoff date (UTC) for "new" issues
CUTOFF_DATE="$(python - <<'PY'
from datetime import datetime, timedelta, timezone
print((datetime.now(timezone.utc) - timedelta(days=7)).strftime('%Y-%m-%d'))
PY
 )"

# Fetch only newly created open issues (default 7-day window)
gh issue list --state open --search "created:>=${CUTOFF_DATE}" --json number,title,body,labels,comments,createdAt --limit 50

### 2. Filter New Candidates

- Skip any issue older than the cutoff window; this command only triages new issues.
- Skip issues with label `triaged` (already handled).
- For remaining issues, if type + area + platform are already present, skip unless metadata is clearly missing.

### 3. Classify Each Issue

For each candidate issue, read the title, body, and **all comments** (comments often contain critical context). Apply labels from the categories below. An issue can receive multiple labels. For each category, skip it only if the issue already has a label in that category — always fill in missing categories.

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

For each issue, apply the chosen labels and add `triaged`. **Never remove existing labels.**

```bash
gh issue edit <number> --add-label "bug,tui,platform:linux,triaged"
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
