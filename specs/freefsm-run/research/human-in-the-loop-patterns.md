**Summary**
Surveyed HITL patterns across LangGraph, AutoGen, CrewAI, MCP elicitation, and the current freefsm architecture. The strongest approach for `freefsm run` combines an MCP `request-input` tool with the Agent SDK's in-process server — the tool call blocks until human responds, providing a true programmatic pause.

**Key Findings**

1. **LangGraph (most mature)**: Uses `interrupt(payload)` + `Command(resume=value)` with persistent checkpointing. Waits indefinitely. Supports parallel interrupts, approval workflows, and input validation loops.

2. **AutoGen**: Post-run feedback (termination-based) is recommended over during-run blocking. Uses `HandoffTermination` to signal human input needed.

3. **MCP Elicitation**: Server calls `elicitation/create` → client shows form → user responds. **Blocks the tool call** until human responds. Three outcomes: accept/decline/cancel. Restricted to flat JSON Schema.

4. **Current freefsm gap**: No programmatic pause mechanism. "Wait for user" is enforced by prompt engineering only. The PostToolUse hook injects reminders but can't force a stop.

5. **Timeout handling**: No framework has robust built-in timeout. Must be implemented at application layer.

**Patterns Evaluated**

| Pattern | Mechanism | Pros | Cons |
|---------|-----------|------|------|
| **MCP tool blocking** | Tool handler awaits human input | True programmatic block, structured input | Requires MCP host support |
| **FSM input_required flag** | Hook forces agent to stop | Works with existing CLI+hooks | Relies on agent compliance |
| **File-based signaling** | Write request/response files | Host-agnostic, CI-friendly | UX friction, no real-time |
| **Checkpoint-and-resume** | Serialize state, new conversation turn | Already works in freefsm | No forced stop mechanism |

**Recommendations**
- For `freefsm run` with Agent SDK: implement `request-input` as an MCP tool using the in-process server. The tool handler uses a Promise that resolves when stdin input arrives (or elicitation if supported).
- The blocking MCP tool call is the cleanest pattern — the agent naturally waits for the tool result.
- Add optional timeout with configurable default (e.g., 5 minutes), returning a timeout error if exceeded.

**References**
- [LangGraph Human-in-the-Loop](https://langchain-ai.github.io/langgraph/concepts/human_in_the_loop/)
- [MCP Elicitation Spec](https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation)
- [AutoGen Human-in-the-Loop](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/human-in-the-loop.html)
