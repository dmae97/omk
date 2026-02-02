# Ask

Ask user when you need clarification or input during task execution.

<conditions>
- Clarify ambiguous requirements before implementing
- Get decisions on implementation approach when multiple valid options exist
- Request preferences (styling, naming conventions, architecture patterns)
- Offer meaningful choices about task direction
</conditions>

<instruction>
- Use `recommended: <index>` to mark default (0-indexed); " (Recommended)" added automatically
- Use `questions` for multiple related questions instead of asking one at a time
- Set `multi: true` on question to allow multiple selections
</instruction>

<output>
Returns selected option(s) as text. For multi-part questions, returns map of question IDs to selected values.
</output>

<important>
- Provide 2-5 concise, distinct options
</important>

<critical>
**Exhaust all other options before asking.**
1. **Unknown file location?** → Search with grep/find first; ask only if search fails.
2. **Ambiguous syntax/format?** → Infer from context and codebase conventions; make reasonable choice.
3. **Missing details?** → Check docs, related files, commit history; fill gaps yourself.
4. **Implementation approach?** → Choose based on codebase patterns; ask only for genuinely novel architectural decisions.
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