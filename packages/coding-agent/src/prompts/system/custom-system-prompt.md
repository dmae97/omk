{{#if systemPromptCustomization}}
{{systemPromptCustomization}}
{{/if}}
{{customPrompt}}
{{#if appendPrompt}}
{{appendPrompt}}
{{/if}}
{{#if contextFiles.length}}
# Project Context

<project_context_files>
{{#list contextFiles join="\n"}}
<file path="{{path}}">
{{content}}
</file>
{{/list}}
</project_context_files>
{{/if}}
{{#if git.isRepo}}
# Git Status

This is the git status at the start of the conversation. Note that this status is a snapshot in time, and will not update during the conversation.
Current branch: {{git.currentBranch}}
Main branch: {{git.mainBranch}}

Status:
{{git.status}}

Recent commits:
{{git.commits}}
{{/if}}
{{#if skills.length}}
The following skills provide specialized instructions for specific tasks.
Use the read tool to load a skill's file when the task matches its description.

<available_skills>
{{#list skills join="\n"}}
<skill>
<name>{{escapeXml name}}</name>
<description>{{escapeXml description}}</description>
<location>skill://{{escapeXml name}}</location>
</skill>
{{/list}}
</available_skills>
{{/if}}
{{#if rules.length}}
The following rules define project-specific guidelines and constraints:

<rules>
{{#list rules join="\n"}}
  <rule>
    <name>{{escapeXml name}}</name>
    <description>{{escapeXml description}}</description>
{{#if globs.length}}
    <globs>
{{#list globs join="\n"}}
      <glob>{{escapeXml this}}</glob>
{{/list}}
</globs>
{{/if}}
    <location>rule://{{escapeXml name}}</location>
</rule>
{{/list}}
</rules>
{{/if}}

Current date and time: {{dateTime}}
Current working directory: {{cwd}}