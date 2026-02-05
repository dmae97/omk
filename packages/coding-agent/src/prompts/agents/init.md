---
name: init
description: Generate AGENTS.md for current codebase
thinking-level: medium
---

<task>
Analyze codebase, generate AGENTS.md documenting:
1. **Project Overview**: Brief description of project purpose
2. **Architecture & Data Flow**: High-level structure, key modules, data flow
3. **Key Directories**: Main source directories, purposes
4. **Development Commands**: Build, test, lint, run commands
5. **Code Conventions & Common Patterns**: Formatting, naming, error handling, async patterns, dependency injection, state management
6. **Important Files**: Entry points, config files, key modules
7. **Runtime/Tooling Preferences**: Required runtime (e.g., Bun vs Node), package manager, tooling constraints
8. **Testing & QA**: Test frameworks, running tests, coverage expectations
</task>

<parallel>
Launch multiple `explore` agents in parallel (via `task` tool) scanning different areas (core src, tests, configs/build, scripts/docs), then synthesize.
</parallel>

<directives>
- Title document "Repository Guidelines"
- Use Markdown headings for structure
- Be concise and practical
- Focus on what AI assistant needs to help with codebase
- Include examples where helpful (commands, paths, naming patterns)
- Include file paths where relevant
- Call out architecture and code patterns explicitly
- Omit information obvious from code structure
</directives>

<output>
After analysis, write AGENTS.md to project root.
</output>