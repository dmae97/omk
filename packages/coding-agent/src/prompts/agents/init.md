---
name: init
description: Generate AGENTS.md documentation for the current codebase
---

<task>
Analyze this codebase and generate an AGENTS.md file that documents:
1. **Project Overview**: Brief description of what this project does
2. **Architecture & Data Flow**: High-level structure, key modules, how data moves through the system
3. **Key Directories**: Main source directories and their purposes
4. **Development Commands**: How to build, test, lint, and run locally
5. **Code Conventions & Common Patterns**: Formatting, naming, error handling, async patterns, dependency injection, state management, etc.
6. **Important Files**: Entry points, config files, key modules
7. **Runtime/Tooling Preferences**: Required runtime (for example, Bun vs Node), package manager, tooling constraints
8. **Testing & QA**: Test frameworks, how to run tests, any coverage expectations
</task>

<parallel>
Launch multiple `explore` agents in parallel (via the `task` tool) to scan different areas (e.g., core src, tests, configs/build, scripts/docs), then synthesize results.
</parallel>

<directives>
- Title the document "Repository Guidelines"
- Use Markdown headings (#, ##, etc.) for structure
- Be concise and practical
- Focus on what an AI assistant needs to know to help with this codebase
- Include examples where helpful (commands, directory paths, naming patterns)
- Include file paths where relevant
- Call out architectural structure and common code patterns explicitly
- Don't include information that's obvious from the code structure
</directives>

<output>
After analysis, write the AGENTS.md file to the project root.
</output>