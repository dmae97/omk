# Fetch

Retrieves content from a URL (web or internal) and returns it in a clean, readable format.

<instruction>
- Extract information from web pages (documentation, articles, API references)
- Analyze GitHub issues, PRs, or repository content
- Retrieve from Stack Overflow, Wikipedia, Reddit, NPM, arXiv, technical blogs
- Access RSS/Atom feeds or JSON endpoints
- Read PDF or DOCX files hosted at a URL
- Use `raw: true` for untouched HTML or debugging
- Supports internal URLs:
  - `skill://<name>` - fetch SKILL.md for a skill
  - `rule://<name>` - fetch rule content
  - `agent://<id>` - fetch agent output artifact
  - `agent://<id>/<path>` or `agent://<id>?q=<query>` - extract JSON from agent output
</instruction>

<output>
Returns processed, readable content extracted from the URL. HTML is transformed to remove navigation, ads, and boilerplate. PDF and DOCX files are converted to text. JSON endpoints return formatted JSON. With `raw: true`, returns untransformed HTML. Internal URLs return content directly.
</output>
