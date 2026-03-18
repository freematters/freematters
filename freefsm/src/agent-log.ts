import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

// ANSI colors
export const colors = {
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  magenta: "\x1b[35m",
  red: "\x1b[31m",
  reset: "\x1b[0m",
};

function ts(): string {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

export function agentLog(msg: string, color: string = colors.dim): void {
  process.stderr.write(
    `${colors.dim}[${ts()}]${colors.reset} ${color}${msg}${colors.reset}\n`,
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

export function formatToolArgs(
  name: string,
  input: Record<string, unknown> | undefined,
): string {
  if (!input) return "";

  switch (name) {
    case "fsm_goto":
      return `(${input.on} → ${input.target})`;
    case "fsm_current":
      return "()";
    case "request_input":
      return `("${input.prompt}")`;
    case "Read":
      return `(${input.file_path}${input.offset ? `:${input.offset}` : ""})`;
    case "Write":
      return `(${input.file_path})`;
    case "Edit":
      return `(${input.file_path}, "${truncate(String(input.old_string ?? ""), 60)}" → "${truncate(String(input.new_string ?? ""), 60)}")`;
    case "Glob":
      return `(${input.pattern}${input.path ? `, ${input.path}` : ""})`;
    case "Grep":
      return `(/${input.pattern}/${input.path ? `, ${input.path}` : ""})`;
    case "Bash":
      return `($ ${truncate(String(input.command ?? ""), 120)})`;
    case "Agent":
      return `(${input.description ?? input.prompt ?? ""})`;
    default:
      return `(${JSON.stringify(input)})`;
  }
}

function logToolUse(name: string, input: Record<string, unknown> | undefined): void {
  const toolName = name ?? "unknown";
  const args = formatToolArgs(toolName, input);
  const ts_ = new Date().toISOString().replace("T", " ").replace("Z", "");
  process.stderr.write(
    `${colors.dim}[${ts_}]${colors.reset} ${colors.cyan}⚡ ${toolName}${colors.reset}${colors.dim}${args}${colors.reset}\n`,
  );
}

/**
 * Log an SDK message to stderr with colors and formatting.
 */
export function logSdkMessage(
  message: SDKMessage,
  opts?: { sessionNum?: number },
): void {
  if (message.type === "assistant") {
    const msg = message as {
      type: "assistant";
      message: {
        content: Array<{
          type: string;
          text?: string;
          name?: string;
          input?: Record<string, unknown>;
        }>;
      };
    };
    for (const block of msg.message.content) {
      if (block.type === "text" && block.text) {
        agentLog(`assistant: ${block.text}`, colors.yellow);
      } else if (block.type === "tool_use") {
        logToolUse(block.name ?? "unknown", block.input);
      }
    }
  } else if (message.type === "result") {
    const resultMsg = message as SDKMessage & {
      type: "result";
      subtype?: string;
      result?: string;
      duration_ms?: number;
      num_turns?: number;
      is_error?: boolean;
    };
    const prefix = opts?.sessionNum ? `session #${opts.sessionNum} ` : "";
    agentLog(
      `${prefix}ended: ${resultMsg.subtype ?? "unknown"} turns=${resultMsg.num_turns ?? 0} duration=${resultMsg.duration_ms ?? 0}ms`,
      colors.cyan,
    );
    if (resultMsg.is_error) {
      agentLog(`error: ${resultMsg.result}`, colors.red);
    }
  }
}
