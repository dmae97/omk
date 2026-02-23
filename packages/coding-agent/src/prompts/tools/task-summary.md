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

{{#if mergeSummary}}
<merge-summary>
{{mergeSummary}}
</merge-summary>
{{/if}}
</task-summary>