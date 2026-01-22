# Web Search

Search the web and use the results to inform responses.

<instruction>
- Provides up-to-date information for current events and recent data
- Returns search result information formatted as search result blocks, including links as markdown hyperlinks
- Use this tool for accessing information beyond Claude's knowledge cutoff
- Searches are performed automatically within a single API call
- Prefer primary sources (papers, official docs) and corroborate key claims with multiple sources
- Include links for cited sources in the final response
</instruction>

<parameters>
Common: system_prompt (guides response style)
Anthropic-specific: max_tokens
Perplexity-specific: model (sonar/sonar-pro), search_recency_filter, search_domain_filter, search_context_size, return_related_questions
Exa-specific: num_results
</parameters>
