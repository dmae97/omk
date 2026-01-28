<task-summary>
<header>{{successCount}}/{{totalCount}} succeeded{{#if hasCancelledNote}} ({{cancelledCount}} cancelled){{/if}} [{{duration}}]</header>

{{#each summaries}}
<agent id="{{id}}" agent="{{agent}}">
<status>{{status}}</status>
{{#if meta}}<meta lines="{{meta.lineCount}}" size="{{meta.charSize}}" />{{/if}}
{{#if truncated}}
<preview full-path="agent://{{id}}">
{{preview}}
</preview>
{{else}}
<result>
{{preview}}
</result>
{{/if}}
</agent>
{{#unless @last}}
---
{{/unless}}
{{/each}}

{{#if schemaOverridden}}
<schema-note>
Note: Agent '{{agentName}}' has a fixed output schema:
{{requiredSchema}}
</schema-note>
{{/if}}

{{#if patchApplySummary}}
<patch-summary>
{{patchApplySummary}}
</patch-summary>
{{/if}}
</task-summary>