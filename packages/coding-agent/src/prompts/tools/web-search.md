# Web Search

Search the web for up-to-date information beyond Claude's knowledge cutoff.

<instruction>
- Prefer primary sources (papers, official docs) and corroborate key claims with multiple sources
- Include links for cited sources in the final response
</instruction>

<parameters>
- `system_prompt`: Guides response style (all providers)
- `max_tokens`: Response length limit (Anthropic only)
- `model`: `sonar` or `sonar-pro` (Perplexity only)
- `search_recency_filter`: `day`, `week`, `month`, `year` (Perplexity only)
- `search_domain_filter`: Domain allowlist/blocklist (Perplexity only)
- `search_context_size`: Amount of context to retrieve (Perplexity only)
- `return_related_questions`: Include follow-up suggestions (Perplexity only)
- `num_results`: Number of results to return (Exa only)
</parameters>

<output>
Returns search results formatted as blocks with:
- Result summaries and relevant excerpts
- Links as markdown hyperlinks for citation
- Provider-dependent structure based on selected backend
</output>

<important>
Searches are performed automatically within a single API call—no pagination or follow-up requests needed.
</important>
