{{#if context}}
{{SECTION_SEPERATOR "Background"}}
<context>
{{context}}
</context>
{{/if}}

{{SECTION_SEPERATOR "Task"}}
{{#if independentMode}}
This assignment is self-contained. No shared task context is available.
{{else}}
Your assignment is below. Your work begins now.
{{/if}}
<goal>
{{assignment}}
</goal>
