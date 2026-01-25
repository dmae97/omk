## Code Review Request

### Mode

{{mode}}

### Changed Files ({{len files}} files, +{{totalAdded}}/-{{totalRemoved}} lines)

{{#if files.length}}
{{#table files headers="File|+/-|Type"}}
{{path}} | +{{linesAdded}}/-{{linesRemoved}} | {{ext}}
{{/table}}
{{else}}
_No files to review._
{{/if}}
{{#if excluded.length}}
### Excluded Files ({{len excluded}})

{{#list excluded prefix="- " join="\n"}}
`{{path}}` (+{{linesAdded}}/-{{linesRemoved}}) — {{reason}}
{{/list}}
{{/if}}

### Distribution Guidelines

Based on the diff weight (~{{totalLines}} lines across {{len files}} files), {{#when agentCount "==" 1}}use **1 reviewer agent**.{{else}}spawn **{{agentCount}} reviewer agents** in parallel.{{/when}}

{{#if multiAgent}}
Group files by locality (related changes together). For example:
- Files in the same directory or module → same agent
- Files that implement related functionality → same agent
- Test files with their implementation files → same agent

Use the Task tool with `agent: "reviewer"` and the batch `tasks` array to run reviews in parallel.
{{/if}}

### Reviewer Instructions

Each reviewer agent should:
1. Focus ONLY on its assigned files
2. {{#if skipDiff}}Run `git diff` or `git show` to get the diff for assigned files{{else}}Use the diff hunks provided below (don't re-run git diff){{/if}}
3. Read full file context as needed via the `read` tool
4. Call `report_finding` for each issue found
5. Call `complete` with verdict when done

{{#if skipDiff}}
### Diff Previews

_Full diff too large ({{len files}} files). Showing first ~{{linesPerFile}} lines per file. Reviewers should fetch full diffs for assigned files._

{{#list files join="\n\n"}}
#### {{path}}

{{#codeblock lang="diff"}}
{{hunksPreview}}
{{/codeblock}}
{{/list}}
{{else}}

### Diff

<diff>
{{rawDiff}}
</diff>
{{/if}}