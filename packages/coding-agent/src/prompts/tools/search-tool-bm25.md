Search hidden MCP tool metadata when MCP tool discovery is enabled.

Use this tool to discover MCP tools that are loaded into the session but not exposed to the model by default.

{{#if hasDiscoverableMCPServers}}Discoverable MCP servers in this session: {{#list discoverableMCPServerSummaries join=", "}}{{this}}{{/list}}.{{/if}}
{{#if discoverableMCPToolCount}}Total discoverable MCP tools loaded: {{discoverableMCPToolCount}}.{{/if}}
Input:
- `query` — required natural-language or keyword query
- `limit` — optional maximum number of tools to return and activate (default `8`)

Behavior:
- Searches hidden MCP tool metadata using BM25-style relevance ranking
- Matches against MCP tool name, server name, description, and input schema keys
- Activates the top matching MCP tools for the rest of the current session
- Repeated searches add to the active MCP tool set; they do not remove earlier selections
- Newly activated MCP tools become available before the next model call in the same overall turn

Notes:
- If you are unsure, start with `limit` between 5 and 10 to see a broader set of tools.
- `query` is matched against MCP tool metadata fields:
  - `name`
  - `label`
  - `server_name`
  - `mcp_tool_name`
  - `description`
  - input schema property keys (`schema_keys`)

This is not repository search, file search, or code search. Use it only for MCP tool discovery.

Returns JSON with:
- `query`
- `activated_tools` — MCP tools activated by this search call
- `match_count` — number of ranked matches returned by the search
- `total_tools`
