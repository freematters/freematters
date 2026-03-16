**Summary**
The Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) wraps Claude Code as a subprocess, exposing an async generator-based agent loop. Custom tools are registered via in-process MCP servers using `createSdkMcpServer()` and `tool()`. The SDK manages the entire tool execution loop internally — you iterate over messages and the agent handles tool calls automatically.

**Key Findings**

1. **Entry point**: `query()` returns `AsyncGenerator<SDKMessage>`. Single-turn uses a string prompt; multi-turn uses an async generator of messages. A V2 preview (`unstable_v2_createSession`) offers simpler multi-turn with `session.send()` / `session.stream()`.

2. **Custom MCP tools**: Register via `createSdkMcpServer({ tools: [tool("name", "desc", zodSchema, handler)] })`. Pass to `query()` via `mcpServers` option. Tool names get prefixed as `mcp__{server}__{tool}`. **Custom tools require streaming input mode** (async generator, not plain string).

3. **Tool lifecycle**: The SDK executes built-in tools automatically. For custom MCP tools, it calls your handler function. Hooks (`PreToolUse`, `PostToolUse`, `Stop`) let you intercept the lifecycle.

4. **FSM driving approaches**:
   - **Approach A (recommended)**: Register `fsm_current` and `fsm_goto` as custom MCP tools. The agent calls them to read state and transition.
   - **Approach B**: Use PostToolUse hook to inject state reminders (current freefsm approach).
   - **Approach C**: Define subagents per FSM state with isolated prompts and tool restrictions.

5. **Key options**: `maxTurns` (limit per state), `maxBudgetUsd` (cost cap), `systemPrompt` (inject FSM guide), `resume`/`sessionId` (resume across restarts), `canUseTool` (dynamic permissions per state).

**Trade-offs**
- SDK wraps Claude Code subprocess → adds process overhead but gets full tool ecosystem (Read, Edit, Bash, etc.)
- Custom MCP tools are in-process → low latency, no separate server needed
- V2 preview is simpler but unstable; V1 async generator is more complex but stable

**Recommendations**
- Use Approach A (custom MCP tools for FSM operations) for `freefsm run`
- Start with V1 `query()` API for stability, plan migration path to V2
- Register `fsm_goto`, `fsm_current`, and `request_input` as MCP tools on a single server

**References**
- [Agent SDK Overview](https://platform.claude.com/docs/en/agent-sdk/overview)
- [TypeScript SDK Reference](https://platform.claude.com/docs/en/agent-sdk/typescript)
- [Custom Tools](https://platform.claude.com/docs/en/agent-sdk/custom-tools)
- [@anthropic-ai/claude-agent-sdk on npm](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)
