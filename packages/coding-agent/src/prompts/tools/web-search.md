# Web Search

Search the web for up-to-date information beyond Claude's knowledge cutoff.

<instruction>
- Prefer primary sources (papers, official docs) and corroborate key claims with multiple sources
- Include links for cited sources in the final response
</instruction>

<output>
Returns search results formatted as blocks with:
- Result summaries and relevant excerpts
- Links as markdown hyperlinks for citation
- Provider-dependent structure based on selected backend
</output>

<important>
Searches are performed automatically within a single API call—no pagination or follow-up requests needed.
</important>