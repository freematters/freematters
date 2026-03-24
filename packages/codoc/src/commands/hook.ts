import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { handlePostToolUse } from "../hooks/post-tool-use.js";
import { IpcClient, type IpcRequest } from "../ipc.js";
import { getDefaultSocketPath, getDefaultTokensPath } from "../paths.js";

function getDefaultSessionsDir(): string {
  return path.join(os.homedir(), ".codoc", "sessions");
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk: string) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      resolve(data);
    });
  });
}

async function runPostToolUse(): Promise<void> {
  try {
    const stdinData = await readStdin();
    let parsed: { session_id?: string } = {};
    try {
      parsed = JSON.parse(stdinData);
    } catch {
      return;
    }

    const sessionId = parsed.session_id;
    if (!sessionId) {
      return;
    }

    const sessionsDir = getDefaultSessionsDir();
    const tokensPath = getDefaultTokensPath();

    const result = await handlePostToolUse(sessionId, sessionsDir, tokensPath);

    if (result) {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    }

    try {
      const socketPath = getDefaultSocketPath();
      const client = new IpcClient(socketPath);
      const request: IpcRequest = { method: "heartbeat", params: { sessionId } };
      await client.send(request);
    } catch {
      // server not running, skip heartbeat
    }
  } catch {
    // silent failure per spec
  }
}

async function runHook(event: string): Promise<void> {
  switch (event) {
    case "post-tool-use":
      await runPostToolUse();
      break;
    default:
      break;
  }
}

export function hookCommand(): Command {
  const cmd = new Command("_hook");
  cmd
    .description("Internal hook handler")
    .argument("<event>", "Hook event name")
    .action(runHook);
  cmd.helpOption("-h, --help", "Display help");
  return cmd;
}
