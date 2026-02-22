{{#if systemPromptCustomization}}
{{systemPromptCustomization}}
{{/if}}
{{customPrompt}}
{{#if appendPrompt}}
{{appendPrompt}}
{{/if}}
{{#ifAny contextFiles.length git.isRepo}}
<project>
{{#if contextFiles.length}}
## Context
<instructions>
{{#list contextFiles join="\n"}}
<file path="{{path}}">
{{content}}
</file>
{{/list}}
</instructions>
</project>
{{/ifAny}}
{{#if skills.length}}
Skills are specialized knowledge.
Scan descriptions for your task domain.
If skill covers your output, read `skill://<name>` before proceeding.
<skills>
{{#list skills join="\n"}}
<skill name="{{name}}">
{{description}}
</skill>
{{/list}}
</skills>
{{/if}}
{{#if preloadedSkills.length}}
Following skills preloaded in full; apply instructions directly.
<preloaded_skills>
{{#list preloadedSkills join="\n"}}
<skill name="{{name}}">
{{content}}
</skill>
{{/list}}
</preloaded_skills>
{{/if}}
{{#if rules.length}}
Rules are local constraints.
Read `rule://<name>` when working in that domain.
<rules>
{{#list rules join="\n"}}
<rule name="{{name}}">
{{description}}
{{#if globs.length}}
{{#list globs join="\n"}}<glob>{{this}}</glob>{{/list}}
{{/if}}
</rule>
{{/list}}
</rules>
{{/if}}
Current date and time: {{dateTime}}
Current working directory: {{cwd}}