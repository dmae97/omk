> omp can create skills. Ask it to build one for your use case.

# Skills

Skills are self-contained capability packages that the agent loads on-demand. A skill provides specialized workflows, setup instructions, helper scripts, and reference documentation for specific tasks.

OMP follows the [Agent Skills](https://agentskills.io/specification) SKILL.md format (YAML frontmatter + markdown body) and exposes skills via `skill://` URLs.

**Example use cases:**
- Web search and content extraction (Brave Search API)
- Browser automation via Chrome DevTools Protocol
- Google Calendar, Gmail, Drive integration
- PDF/DOCX processing and creation
- Speech-to-text transcription
- YouTube transcript extraction

See [Skill Repositories](#skill-repositories) for ready-to-use skills.

## When to Use Skills

| Need | Solution |
|------|----------|
| Always-needed context (conventions, commands) | AGENTS.md |
| User triggers a specific prompt template | Slash command |
| Additional tool directly callable by the LLM (like read/write/edit/bash) | Custom tool |
| On-demand capability package (workflows, scripts, setup) | Skill |

Skills are loaded when:
- The agent decides the task matches a skill's description
- The user explicitly asks to use a skill (e.g., "use the pdf skill to extract tables")

**Good skill examples:**
- Browser automation with helper scripts and CDP workflow
- Google Calendar CLI with setup instructions and usage patterns
- PDF processing with multiple tools and extraction patterns
- Speech-to-text transcription with API setup

**Not a good fit for skills:**
- "Always use TypeScript strict mode" → put in AGENTS.md
- "Review my code" → make a slash command
- Need user confirmation dialogs or custom TUI rendering → make a custom tool

## Skill Structure

A skill is a directory with a `SKILL.md` file. Everything else is freeform. Example structure:

```
my-skill/
├── SKILL.md              # Required: frontmatter + instructions
├── scripts/              # Helper scripts (bash, python, node)
│   └── process.sh
├── references/           # Detailed docs loaded on-demand
│   └── api-reference.md
└── assets/               # Templates, images, etc.
    └── template.json
```

### SKILL.md Format

```markdown
---
name: my-skill
description: What this skill does and when to use it. Be specific.
---

# My Skill

## Setup

Run once before first use:
\`\`\`bash
cd /path/to/skill && npm install
\`\`\`

## Usage

\`\`\`bash
./scripts/process.sh <input>
\`\`\`

## Workflow

1. First step
2. Second step
3. Third step
```

### Frontmatter Fields

| Field | Required | Notes |
|-------|----------|-------|
| `name` | No | Defaults to the skill directory name. Use lowercase + hyphens for compatibility. |
| `description` | Yes (OMP/custom), recommended everywhere | Used for skill matching and shown in the system prompt. |

OMP ignores additional frontmatter fields, but other tooling may use them.

#### Naming Guidance

OMP does not enforce naming rules, but skill names must match exactly for `skill://<name>` and `/skill:<name>` lookups. For cross-tool compatibility, keep names lowercase, hyphenated, and aligned with the directory name.

### File References

Use `skill://` URLs to reference files inside a skill directory:

```markdown
Read the full skill:
\`\`\`
skill://my-skill
\`\`\`

Read a reference file:
\`\`\`
skill://my-skill/references/api-reference.md
\`\`\`
```

## Skill Locations

Skills are discovered from these sources (first match wins on name collisions):

- OMP user: `~/.omp/agent/skills/<skill>/SKILL.md` (legacy alias: `~/.pi/agent/skills/...`)
- OMP project: `<cwd>/.omp/skills/<skill>/SKILL.md` (legacy alias: `<cwd>/.pi/skills/...`)
- Claude Code: `~/.claude/skills/<skill>/SKILL.md` and `<cwd>/.claude/skills/<skill>/SKILL.md`
- Codex CLI: `~/.codex/skills/<skill>/SKILL.md` and `<cwd>/.codex/skills/<skill>/SKILL.md`
- Custom directories from `skills.customDirectories` (scanned recursively)

Discovery skips hidden directories and `node_modules`, and respects `.gitignore`, `.ignore`, and `.fdignore` rules.

## Configuration

Global settings live in `~/.omp/agent/config.yml` (migrated from legacy `settings.json`). Project overrides live in `<cwd>/.omp/settings.json` or `<cwd>/.pi/settings.json`.

```yaml
skills:
  enabled: true
  enableSkillCommands: true
  enableCodexUser: true
  enableClaudeUser: true
  enableClaudeProject: true
  enablePiUser: true
  enablePiProject: true
  customDirectories: []
  ignoredSkills: []
  includeSkills: []
```

| Setting | Default | Description |
|---------|---------|-------------|
| `enabled` | `true` | Master toggle for all skills |
| `enableSkillCommands` | `true` | Register `/skill:<name>` commands in interactive mode |
| `enableCodexUser` | `true` | Load from `~/.codex/skills/` |
| `enableClaudeUser` | `true` | Load from `~/.claude/skills/` |
| `enableClaudeProject` | `true` | Load from `<cwd>/.claude/skills/` |
| `enablePiUser` | `true` | Load from `~/.omp/agent/skills/` (or `~/.pi/agent/skills/`) |
| `enablePiProject` | `true` | Load from `<cwd>/.omp/skills/` (or `<cwd>/.pi/skills/`) |
| `customDirectories` | `[]` | Additional directories to scan recursively (use absolute paths) |
| `ignoredSkills` | `[]` | Glob patterns to exclude (e.g., `"deprecated-*"`) |
| `includeSkills` | `[]` | Glob patterns to include (empty = all) |

**Note:** `ignoredSkills` takes precedence over both `includeSkills` and the `--skills` CLI flag.

### CLI Filtering

Use `--skills` to filter skills for a specific invocation:

```bash
# Only load specific skills
omp --skills git,docker

# Glob patterns
omp --skills "git-*,docker-*"

# All skills matching a prefix
omp --skills "aws-*"
```

This overrides the `includeSkills` setting for the current session.

## How Skills Work

1. At startup, omp scans enabled skill locations and filters them by settings and CLI flags.
2. If the `read` tool is available, skill names + descriptions are injected into the system prompt as XML.
3. When a task matches a skill, the agent loads it with `read skill://<name>` or `skill://<name>/<path>`.
4. When skills are preloaded (e.g., Task tool with explicit skills), their full contents are inlined under `<preloaded_skills>` and no `read` call is needed.

This is progressive disclosure: only descriptions are always in context, full instructions load on-demand unless explicitly preloaded.

## Warnings

OMP emits warnings when:

- A skill directory or file cannot be read
- Two skills share the same name (the first loaded wins; later ones are skipped)

## Example: Web Search Skill

```
brave-search/
├── SKILL.md
├── search.js
└── content.js
```

**SKILL.md:**
```markdown
---
name: brave-search
description: Web search and content extraction via Brave Search API. Use for searching documentation, facts, or any web content.
---

# Brave Search

## Setup

\`\`\`bash
cd /path/to/brave-search && npm install
\`\`\`

## Search

\`\`\`bash
./search.js "query"              # Basic search
./search.js "query" --content    # Include page content
\`\`\`

## Extract Page Content

\`\`\`bash
./content.js https://example.com
\`\`\`
```

## Skill Repositories

For inspiration and ready-to-use skills:

- [Anthropic Skills](https://github.com/anthropics/skills) - Official skills for document processing (docx, pdf, pptx, xlsx), web development, and more
- [Pi Skills](https://github.com/badlogic/pi-skills) - Skills for web search, browser automation, Google APIs, transcription

## Disabling Skills

CLI:
```bash
omp --no-skills
```

Settings:
```yaml
skills:
  enabled: false
```

Use the granular `enable*` flags to disable individual sources (e.g., `enableClaudeUser: false` to skip `~/.claude/skills`).
