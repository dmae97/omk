# MCP Server Management Command Guide

Complete guide for the `/mcp` command in oh-my-pi.

## Overview

The `/mcp` command provides interactive management of Model Context Protocol (MCP) servers. It allows you to add, remove, list, and test MCP servers through a user-friendly command-line interface.

## Commands

### `/mcp` or `/mcp help`
Shows help text with all available commands.

### `/mcp add`
Launch interactive wizard to add a new MCP server.

**Features:**
- Step-by-step guided setup
- Real-time validation
- Three authentication methods
- User or project-level configuration
- Automatic connection testing

**Wizard Flow:**
1. **Server Name** - Unique identifier (letters, numbers, dash, underscore, dot only)
2. **Transport Type** - Choose stdio/http/sse
3. **Configuration**:
   - **stdio**: Command + optional arguments
   - **http/sse**: Server URL
4. **Authentication** - Three options:
   - None (for local/trusted servers)
   - OAuth (web-based authentication)
   - Manual API key/token
5. **Scope** - User-level (`~/.omp/mcp.json`) or project-level (`.omp/mcp.json`)
6. **Confirmation** - Review and save

### `/mcp list`
List all configured MCP servers with connection status.

**Output:**
- Server name
- Connection status (connected/not connected)
- Transport type [stdio/http/sse]
- Organized by scope (user-level vs project-level)

### `/mcp remove <name>`
Remove an MCP server from configuration.

**Behavior:**
- Disconnects server if currently connected
- Removes from config file
- Reloads MCP manager
- Shows confirmation message

### `/mcp test <name>`
Test connection to an MCP server.

**Features:**
- Creates temporary test connection
- Lists server info and version
- Shows available tools (up to 10)
- Disconnects after test
- Provides helpful error messages

## Authentication Methods

### 1. No Authentication
For local or trusted MCP servers that don't require credentials.

**Use cases:**
- Local filesystem servers
- Development/testing servers
- Internal network servers

**Configuration:** No auth fields in config

### 2. Manual API Key/Token

#### Environment Variable (for stdio servers)
```json
{
  "type": "stdio",
  "command": "npx",
  "args": ["mcp-server"],
  "env": {
    "API_KEY": "sk-..."
  }
}
```

**Supports shell commands:**
```json
{
  "env": {
    "API_KEY": "!op read op://vault/mykey"
  }
}
```

#### HTTP Header (for http/sse servers)
```json
{
  "type": "http",
  "url": "https://api.example.com/mcp",
  "headers": {
    "Authorization": "Bearer sk-..."
  }
}
```

**Automatic Bearer prefix:** If header is "Authorization" and value doesn't start with "Bearer ", it's added automatically.

### 3. OAuth Flow

**Full OAuth 2.0 support with PKCE:**
- Authorization Code flow
- PKCE (Proof Key for Code Exchange) for enhanced security
- Automatic browser launch
- Local callback server
- Secure token storage in agent.db

**OAuth Configuration:**
- **Authorization URL**: OAuth authorize endpoint
- **Token URL**: OAuth token endpoint
- **Client ID**: Your OAuth client identifier
- **Client Secret**: Optional (for flows requiring it)
- **Scopes**: Space-separated permissions (optional)

**Token Storage:**
Tokens are stored securely in `~/.omp/agent.db` and referenced by credential ID:

```json
{
  "type": "http",
  "url": "https://api.example.com/mcp",
  "auth": {
    "type": "oauth",
    "credentialId": "mcp_oauth_1707409234567_abc123def"
  }
}
```

**Token Injection:**
- **HTTP/SSE servers**: Added to `Authorization` header as `Bearer <token>`
- **stdio servers**: Added to `OAUTH_ACCESS_TOKEN` environment variable

## Configuration Files

### User-level: `~/.omp/mcp.json`
Global configuration available to all projects.

### Project-level: `.omp/mcp.json`
Project-specific configuration (usually in project root).

### Example Configuration

**stdio server with API key:**
```json
{
  "mcpServers": {
    "filesystem": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user/data"],
      "env": {
        "LOG_LEVEL": "debug"
      }
    }
  }
}
```

**HTTP server with OAuth:**
```json
{
  "mcpServers": {
    "external-api": {
      "type": "http",
      "url": "https://api.example.com/mcp",
      "auth": {
        "type": "oauth",
        "credentialId": "mcp_oauth_1707409234567_abc123def"
      }
    }
  }
}
```

## Error Messages & Troubleshooting

### Common Errors

**"Server name can only contain letters, numbers, dash, underscore, and dot"**
- Server names must be alphanumeric with limited special characters
- Maximum 100 characters

**"Invalid URL format (must start with http:// or https://)"**
- URLs for HTTP/SSE servers must include protocol
- Example: `https://api.example.com/mcp`

**"Server already exists"**
- A server with this name is already configured
- Use `/mcp list` to see existing servers
- Choose a different name or remove the existing server first

**"ECONNREFUSED"**
- Server is not running or URL/port is incorrect
- Check server is started
- Verify URL and port number

**"401" or "403"**
- Authentication failed
- Check API key/token is correct
- For OAuth, re-authenticate

**"timeout"**
- Server is slow or unresponsive
- Try increasing timeout in config
- Check network connection

### Tips

1. **Test before committing**: Use `/mcp test <name>` after adding a server
2. **Start simple**: Begin with no authentication, add auth later if needed
3. **Check logs**: Server errors often indicate configuration issues
4. **Validate URLs**: Ensure URLs are accessible (try in browser first)
5. **Shell commands**: Use `!op read` for password manager integration

## Workflow Examples

### Adding a Local Filesystem Server

```
/mcp add
→ Name: "docs"
→ Transport: stdio
→ Command: npx
→ Args: -y @modelcontextprotocol/server-filesystem /home/user/docs
→ Auth: No authentication
→ Scope: Project level
→ Confirm: Yes
```

### Adding an API Server with OAuth

```
/mcp add
→ Name: "external-api"
→ Transport: http
→ URL: https://api.example.com/mcp
→ Auth: OAuth flow
→ Authorization URL: https://auth.example.com/oauth/authorize
→ Token URL: https://auth.example.com/oauth/token
→ Client ID: your_client_id
→ Client Secret: (leave empty if PKCE-only)
→ Scopes: read write
→ Confirm OAuth config
→ [Browser opens for authentication]
→ Scope: User level
→ Confirm: Yes
```

### Adding an HTTP Server with API Key

```
/mcp add
→ Name: "api-server"
→ Transport: http
→ URL: https://api.example.com/mcp
→ Auth: Manual API key/token
→ API Key: sk-1234567890abcdef
→ Location: HTTP header
→ Header Name: Authorization
→ Scope: User level
→ Confirm: Yes
```

### Testing and Managing

```bash
# List all servers
/mcp list

# Test a server
/mcp test docs

# Remove a server
/mcp remove docs
```

## Best Practices

1. **Use project-level config for project-specific servers**
   - Keep project dependencies in project
   - Easier to share with team

2. **Use user-level config for personal/global servers**
   - Credentials stay private
   - Available across all projects

3. **Secure sensitive data**
   - Use OAuth when available
   - Use shell commands for API keys: `!op read op://vault/key`
   - Never commit `.omp/mcp.json` files with plain API keys to version control

4. **Name servers descriptively**
   - Use purpose-based names: "github-tools", "docs-search"
   - Avoid generic names: "server1", "test"

5. **Test after adding**
   - Always run `/mcp test <name>` after adding a server
   - Verify tools are accessible
   - Check authentication works

## Advanced Features

### Shell Command References

Any environment variable or header value can reference a shell command:

```json
{
  "env": {
    "API_KEY": "!op read op://vault/mcp-key"
  }
}
```

The command is executed once and cached for the session.

### Automatic Token Refresh

OAuth tokens are automatically refreshed when needed (not yet implemented, but infrastructure is in place).

### Connection Pooling

MCP Manager maintains persistent connections to servers for better performance.

## Limitations

1. **No inline editing**: To modify a server, remove and re-add it
2. **No bulk operations**: Servers must be managed individually
3. **No server templates**: Each server configured from scratch

## Files Modified

- `packages/coding-agent/src/mcp/config-writer.ts` - Config file I/O
- `packages/coding-agent/src/mcp/oauth-flow.ts` - OAuth authentication
- `packages/coding-agent/src/mcp/manager.ts` - Added auth resolution
- `packages/coding-agent/src/modes/controllers/mcp-command-controller.ts` - Command routing
- `packages/coding-agent/src/modes/components/mcp-add-wizard.ts` - Interactive wizard
- `packages/coding-agent/src/sdk.ts` - Auth storage integration

## API Reference

For programmatic access, see:
- `MCPManager.setAuthStorage()` - Set auth storage for OAuth resolution
- `validateServerName()` - Validate server names
- `addMCPServer()` - Add server to config file
- `removeMCPServer()` - Remove server from config file
- `getMCPConfigPath()` - Get config file path
