# Ask

Ask user when you need clarification or input during task execution.

<conditions>
- Multiple approaches exist with significantly different tradeoffs user should weigh
</conditions>

<instruction>
- Use `recommended: <index>` to mark default (0-indexed); " (Recommended)" added automatically
- Use `questions` for multiple related questions instead of asking one at a time
- Set `multi: true` on question to allow multiple selections
</instruction>

<output>
Returns selected option(s) as text. For multi-part questions, returns map of question IDs to selected values.
</output>

<caution>
- Provide 2-5 concise, distinct options
</caution>

<critical>
**Default to action. Do NOT ask unless you are genuinely blocked and user preference is required to avoid a wrong outcome.**
1. **Resolve ambiguity yourself** using repo conventions, existing patterns, and reasonable defaults.
2. **Exhaust existing sources** (code, configs, docs, history) before asking anything.
3. **If multiple choices are acceptable**, pick the most conservative/standard option and proceed; state the choice.
4. **Only ask when options have materially different tradeoffs and the user must decide.**
**Do NOT include "Other" option in your options array.** UI automatically adds "Other (type your own)" to every question; adding your own creates duplicates.
</critical>

<example name="single">
question: "Which authentication method should this API use?"
options: [{"label": "JWT"}, {"label": "OAuth2"}, {"label": "Session cookies"}]
recommended: 0
</example>

<example name="multi-part">
questions: [
  {"id": "auth", "question": "Which auth method?", "options": [{"label": "JWT"}, {"label": "OAuth2"}], "recommended": 0},
  {"id": "cache", "question": "Enable caching?", "options": [{"label": "Yes"}, {"label": "No"}]},
  {"id": "features", "question": "Which features to include?", "options": [{"label": "Logging"}, {"label": "Metrics"}, {"label": "Tracing"}], "multi": true}
]
</example>