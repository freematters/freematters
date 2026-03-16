**Summary**
MCP (Model Context Protocol) is a JSON-RPC 2.0-based protocol for LLM clients to discover and invoke tools from external servers. The TypeScript SDK (`@modelcontextprotocol/sdk`) provides `McpServer` with `registerTool()` for defining tools with Zod schemas. MCP also includes an **elicitation** mechanism (`elicitation/create`) that allows tools to pause and request structured human input.

**Key Findings**

1. **Tool definition**: Tools have `name`, `description`, `inputSchema` (JSON Schema / Zod), optional `outputSchema`. Handlers return `{ content: [{ type: "text", text: "..." }] }`.

2. **In-process MCP in Agent SDK**: The Agent SDK's `createSdkMcpServer()` creates an in-process MCP server — no stdio/HTTP transport needed. Tools are registered with Zod schemas and passed directly to `query()`.

3. **Elicitation (human-in-the-loop)**: During tool execution, a server can call `ctx.mcpReq.elicitInput()` to present a form to the user. The call **blocks** until the user responds with `accept` (data), `decline`, or `cancel`. Schema is restricted to flat objects with primitives only.

4. **Transport options**: Stdio (local process), Streamable HTTP (remote). For `freefsm run`, the in-process approach via Agent SDK is ideal — no separate transport needed.

5. **No existing MCP code in freefsm** — this would be a new dependency.

**Trade-offs**
- In-process MCP via Agent SDK: simplest, no transport overhead, but tied to Agent SDK
- Standalone MCP server via stdio: works with any MCP client, but more infrastructure
- Elicitation is powerful but client support varies — Claude Code support needs verification

**Recommendations**
- Use the Agent SDK's `createSdkMcpServer()` for in-process tools (no standalone MCP server needed)
- Implement `request-input` as an MCP tool that uses elicitation if the host supports it, with a stdin fallback
- Add `@modelcontextprotocol/sdk` and `zod` as dependencies

**References**
- [MCP Specification — Tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
- [MCP Specification — Elicitation](https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [@modelcontextprotocol/sdk on npm](https://www.npmjs.com/package/@modelcontextprotocol/sdk)
