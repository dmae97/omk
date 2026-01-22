# Ask

Ask the user a question when you need clarification or input during task execution.

<conditions>
- Clarify ambiguous requirements before implementing
- Get decisions on implementation approach when multiple valid options exist
- Request user preferences (styling, naming conventions, architecture patterns)
- Offer meaningful choices about task direction
</conditions>

<important>
- Place recommended option first with " (Recommended)" suffix
- 2-5 concise, distinct options
- Users can always select "Other" for custom input
- **Do NOT include an "Other" option in your options array.** The UI automatically adds "Other (type your own)" to every question. Adding your own creates duplicate "Other" options.
</important>

<example name="single">
question: "Which authentication method should this API use?"
options: [{"label": "JWT (Recommended)"}, {"label": "OAuth2"}, {"label": "Session cookies"}]
</example>

<example name="multi-part">
When you have multiple related questions, use the `questions` array instead of asking one at a time. Each question has its own id, options, and optional `multi` flag.

questions: [
  {"id": "auth", "question": "Which auth method?", "options": [{"label": "JWT"}, {"label": "OAuth2"}]},
  {"id": "cache", "question": "Enable caching?", "options": [{"label": "Yes"}, {"label": "No"}]},
  {"id": "features", "question": "Which features to include?", "options": [{"label": "Logging"}, {"label": "Metrics"}, {"label": "Tracing"}], "multi": true}
]
</example>

<critical>
**Exhaust all other options before asking.** Questions interrupt user flow.

1. **Unknown file location?** → Search with grep/find first. Only ask if search fails.
2. **Ambiguous syntax/format?** → Infer from context and codebase conventions. Make a reasonable choice.
3. **Missing details?** → Check docs, related files, commit history. Fill gaps yourself.
4. **Implementation approach?** → Choose based on codebase patterns. Ask only for genuinely novel architectural decisions.

If you can make a reasonable inference from the user's request, **do it**. Users communicate intent, not specifications—your job is to translate intent into correct implementation.
</critical>
