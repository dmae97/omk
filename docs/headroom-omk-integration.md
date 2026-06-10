# Headroom OMK Integration Guide

## Overview

This guide explains the OMK-native target layout for integrating [Headroom](https://github.com/chopratejas/headroom) with OMK (Open Multi-agent Kit) for token savings and parallel sub-agent orchestration. Treat paths below as runtime installation targets unless local evidence confirms they already exist.

## OMK Runtime Integration Targets

### 1. Headroom Skill
- **Target location when installed**: `$OMK_RUNTIME_HOME/.agents/skills/headroom/SKILL.md`
- **Purpose**: Provides headroom context compression capabilities
- **Usage**: `/skill:headroom` or automatic loading

### 2. Parallel Agents Extension
- **Target location when installed**: `$OMK_RUNTIME_HOME/extensions/parallel-agents/index.ts`
- **Purpose**: Spawn and manage multiple sub-agents in parallel
- **Tools**: 
  - `spawn_parallel_agents` - Spawn multiple agents
  - `check_parallel_agents` - Check agent status
  - `coordinate_agent_results` - Coordinate results

### 3. Orchestrator Extension
- **Target location when installed**: `$OMK_RUNTIME_HOME/extensions/orchestrator/index.ts`
- **Purpose**: Orchestrate sub-agents toward a common goal
- **Tools**:
  - `orchestrate_goal` - Main orchestration tool
  - `orchestrator_status` - Check orchestrator status
  - `equip_agent` - Equip agents with skills/hooks/MCP

### 4. Headroom Integration Extension
- **Target location when installed**: `$OMK_RUNTIME_HOME/extensions/headroom-integration/index.ts`
- **Purpose**: Integrate headroom compression into OMK
- **Tools**:
  - `headroom_install` - Install headroom
  - `headroom_compress` - Compress context
  - `headroom_stats` - Get compression statistics
  - `headroom_proxy` - Start proxy server

## Installation

### 1. Install Headroom
```bash
pip install "headroom-ai[all]"
```

### 2. Verify Installation
```bash
python3 -c "import headroom; print(headroom.__version__)"
```

## Usage Examples

### Example 1: Basic Context Compression

```
User: Compress this large code output using headroom

Agent: I'll use the headroom_compress tool to compress your context.

[Agent uses headroom_compress tool with the large content]

Result: 60-95% token savings while preserving answer quality.
```

### Example 2: Parallel Sub-Agent Work

```
User: I need to analyze 3 different codebases in parallel

Agent: I'll spawn 3 parallel sub-agents for this task.

[Agent uses spawn_parallel_agents tool]

Result: 3 agents spawned, each working on different codebase.
```

### Example 3: Orchestrated Goal Achievement

```
User: Build a complete authentication system with JWT, OAuth, and session management

Agent: I'll orchestrate multiple sub-agents toward this goal.

[Agent uses orchestrate_goal tool with multiple agents]

Result: 5 agents orchestrated, each handling different auth component.
```

## Detailed Usage

### Using Headroom Skill

1. **Manual Loading**: Use `/skill:headroom` to load the skill
2. **Automatic Loading**: The skill loads automatically when needed
3. **Commands**: 
   - `/headroom:compress` - Compress current context
   - `/headroom:stats` - Show compression statistics
   - `/headroom:retrieve` - Retrieve original content

### Using Parallel Agents

1. **Spawn Agents**:
   ```typescript
   spawn_parallel_agents({
     goal: "Analyze codebase security",
     agents: [
       {
         id: "agent-1",
         task: "Scan for SQL injection vulnerabilities",
         skills: ["security-scanner"],
         hooks: ["pre-commit"],
         mcpServers: ["vulnerability-db"]
       },
       {
         id: "agent-2", 
         task: "Check authentication flaws",
         skills: ["auth-analyzer"],
         hooks: ["post-commit"],
         mcpServers: ["auth-patterns"]
       }
     ],
     coordination: "Share findings and cross-validate"
   })
   ```

2. **Check Status**:
   ```typescript
   check_parallel_agents()
   ```

3. **Coordinate Results**:
   ```typescript
   coordinate_agent_results({
     goal: "Analyze codebase security",
     mergeStrategy: "combine"
   })
   ```

### Using Orchestrator

1. **Set Goal and Orchestrate**:
   ```typescript
   orchestrate_goal({
     goal: "Build REST API with authentication",
     subAgents: [
       {
         id: "api-designer",
         task: "Design API endpoints and schemas",
         skills: ["api-design", "openapi"],
         hooks: ["validation"],
         mcpServers: ["api-standards"]
       },
       {
         id: "auth-specialist",
         task: "Implement JWT authentication",
         skills: ["jwt", "oauth2"],
         hooks: ["security-check"],
         mcpServers: ["auth-providers"]
       },
       {
         id: "database-engineer",
         task: "Design and implement database schema",
         skills: ["database-design", "migration"],
         hooks: ["backup"],
         mcpServers: ["database-tools"]
       }
     ],
     strategy: "parallel",
     timeout: 600
   })
   ```

2. **Check Orchestrator Status**:
   ```typescript
   orchestrator_status()
   ```

3. **Equip Agent**:
   ```typescript
   equip_agent({
     agentId: "auth-specialist",
     skills: ["rate-limiting"],
     hooks: ["logging"],
     mcpServers: ["monitoring"]
   })
   ```

### Using Headroom Integration

1. **Install Headroom** (if not installed):
   ```typescript
   headroom_install({ force: false })
   ```

2. **Compress Context**:
   ```typescript
   headroom_compress({
     content: "Large code output or logs...",
     contentType: "auto",
     compressionLevel: "medium"
   })
   ```

3. **Get Statistics**:
   ```typescript
   headroom_stats({ detailed: true })
   ```

4. **Start Proxy** (for automatic compression):
   ```typescript
   headroom_proxy({
     port: 8787,
     background: true
   })
   ```

## Integration with Existing OMK Workflows

### 1. Token-Saving Workflow

```
1. Receive large context (tool outputs, logs, files)
2. Use headroom_compress to reduce token usage
3. Send compressed context to LLM
4. LLM can retrieve originals via CCR if needed
```

### 2. Parallel Analysis Workflow

```
1. Identify tasks that can be parallelized
2. Use spawn_parallel_agents to create sub-agents
3. Each sub-agent works independently
4. Use coordinate_agent_results to merge findings
```

### 3. Goal-Oriented Orchestration

```
1. Define complex goal requiring multiple skills
2. Use orchestrate_goal to create sub-agents
3. Each sub-agent equipped with specific skills/hooks/MCP
4. Orchestrator manages coordination and result merging
```

## Best Practices

### For Token Savings
1. **Compress early**: Apply compression to tool outputs before they enter context
2. **Use content routing**: Let headroom auto-detect content type
3. **Monitor savings**: Use headroom_stats to track compression effectiveness
4. **Enable CCR**: Use reversible compression for important context

### For Parallel Agents
1. **Clear task division**: Each agent should have distinct, non-overlapping tasks
2. **Proper equipment**: Equip agents with relevant skills, hooks, and MCP servers
3. **Coordination strategy**: Choose appropriate strategy (parallel, sequential, pipeline, adaptive)
4. **Result merging**: Define clear strategy for combining agent results

### For Orchestration
1. **Goal clarity**: Define clear, measurable goals
2. **Agent specialization**: Each agent should handle specific aspect of goal
3. **Dependency management**: Define dependencies between agents
4. **Resource allocation**: Allocate appropriate skills/hooks/MCP to each agent

## Configuration

### Headroom Configuration
Headroom can be configured via:
- Environment variables
- Config file (`~/.headroom/config.toml`)
- Per-call overrides

### OMK Configuration
Extensions are auto-discovered from:
- `$OMK_RUNTIME_HOME/extensions/` (global)
- `.omk/extensions/` (project-local)

Skills are auto-discovered from:
- `$OMK_RUNTIME_HOME/.agents/skills/` (global)
- `.agents/skills/` (project-local)

## Troubleshooting

### Common Issues

1. **Headroom not installed**
   - Solution: Use `headroom_install` tool or `pip install "headroom-ai[all]"`

2. **Extensions not loading**
   - Solution: Check file permissions and TypeScript syntax
   - Use `/reload` to reload extensions

3. **Agents not spawning**
   - Solution: Check agent configuration and dependencies
   - Use `check_parallel_agents` to monitor status

4. **Compression not working**
   - Solution: Verify headroom installation with `headroom_stats`
   - Check content type detection

### Performance Tips

1. **Parallel vs Sequential**: Use parallel for independent tasks, sequential for dependent tasks
2. **Compression level**: Balance between compression ratio and processing time
3. **Agent count**: Too many agents can cause coordination overhead
4. **Timeout settings**: Set appropriate timeouts for long-running tasks

## Advanced Features

### Custom Skills for Agents
Create custom skills for specific agent tasks:
```markdown
# Custom Security Scanner Skill
Use this skill when scanning for security vulnerabilities.

## Steps
1. Analyze code patterns
2. Check for common vulnerabilities
3. Generate security report
```

### Custom Hooks
Create hooks for pre/post processing:
```typescript
// Pre-commit hook for code validation
omk.on("tool_call", async (event, ctx) => {
  if (event.toolName === "write") {
    // Validate code before writing
    const validation = await validateCode(event.input.content);
    if (!validation.valid) {
      return { block: true, reason: validation.error };
    }
  }
});
```

### MCP Server Integration
Equip agents with MCP servers for external tool access:
```typescript
equip_agent({
  agentId: "database-engineer",
  mcpServers: ["postgres-mcp", "redis-mcp", "elasticsearch-mcp"]
});
```

## Examples

### Example 1: Security Audit
```
Goal: Perform comprehensive security audit
Agents:
1. SQL Injection Scanner
2. XSS Vulnerability Detector  
3. Authentication Analyzer
4. Authorization Checker
Strategy: Parallel
Coordination: Cross-validate findings
```

### Example 2: Code Refactoring
```
Goal: Refactor legacy authentication system
Agents:
1. Code Analyzer (understand current system)
2. Pattern Designer (design new patterns)
3. Migration Planner (plan migration steps)
4. Test Writer (write comprehensive tests)
Strategy: Pipeline
Coordination: Sequential with result passing
```

### Example 3: Feature Development
```
Goal: Build real-time notification system
Agents:
1. WebSocket Specialist
2. Database Designer
3. API Developer
4. Frontend Integrator
5. Test Automator
Strategy: Adaptive
Coordination: Dependency-based execution
```

## Conclusion

This integration provides:
1. **Token Savings**: 60-95% reduction in token usage through headroom compression
2. **Parallel Processing**: Multiple sub-agents working simultaneously
3. **Goal Orchestration**: Coordinated work toward complex objectives
4. **Flexible Equipment**: Custom skills, hooks, and MCP servers for each agent

Use these tools to enhance your OMK workflow with efficient context compression and parallel agent orchestration.