{{#if systemPromptCustomization}}
{{systemPromptCustomization}}
{{/if}}
{{customPrompt}}
{{#if appendPrompt}}
{{appendPrompt}}
{{/if}}
{{#ifAny projectTree contextFiles.length git.isRepo}}
<project>
{{#if projectTree}}
## Files
<tree>
{{projectTree}}
</tree>
{{/if}}

{{#if contextFiles.length}}
## Context
<instructions>
{{#list contextFiles join="\n"}}
<file path="{{path}}">
{{content}}
</file>
{{/list}}
</instructions>
{{/if}}

{{#if git.isRepo}}
## Version Control
This is a snapshot. It does not update during the conversation.

Current branch: {{git.currentBranch}}
Main branch: {{git.mainBranch}}

{{git.status}}

### History
{{git.commits}}
{{/if}}
</project>
{{/ifAny}}

{{#if skills.length}}
Skills are specialized knowledge.
They exist because someone learned the hard way.

Scan descriptions against your task domain.
If a skill covers what you're producing, read `skill://<name>` before proceeding.

<skills>
{{#list skills join="\n"}}
<skill name="{{name}}">
{{description}}
</skill>
{{/list}}
</skills>
{{/if}}
{{#if preloadedSkills.length}}
The following skills are preloaded in full. Apply their instructions directly.

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
They exist because someone made a mistake here before.

Read `rule://<name>` when working in their domain.

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
