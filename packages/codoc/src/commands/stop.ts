import fs from "node:fs";
import { Command } from "commander";
import { IpcClient } from "../ipc.js";
import { getDefaultSocketPath, readSessionIdFromStdin } from "../paths.js";

export interface StopResult {
  ok: boolean;
  message: string;
}

export async function runStop(
  socketPath: string,
  force: boolean,
  sessionId: string,
): Promise<StopResult> {
  if (!fs.existsSync(socketPath)) {
    return { ok: true, message: "Server not running" };
  }

  const client = new IpcClient(socketPath);

  try {
    if (force) {
      const response = await client.send({ method: "stop", params: {} });
      if (response.ok) {
        return { ok: true, message: "Server stopped." };
      }
      return { ok: false, message: response.error ?? "Unknown error" };
    }

    const response = await client.send({
      method: "session-end",
      params: { sessionId },
    });
    if (response.ok) {
      const data = response.data as { sessions: number; stopping: boolean } | undefined;
      if (data?.stopping) {
        return { ok: true, message: "Last session ended, server stopping." };
      }
      return {
        ok: true,
        message: `Session ended. ${data?.sessions ?? "?"} session(s) remaining.`,
      };
    }
    return { ok: false, message: response.error ?? "Unknown error" };
  } catch {
    return { ok: true, message: "Server not running" };
  }
}

export function stopCommand(): Command {
  const cmd = new Command("stop");
  cmd
    .description("Stop running server")
    .option("--force", "Force stop regardless of active sessions")
    .action(async (opts: { force?: boolean }) => {
      const socketPath = getDefaultSocketPath();
      const stdinSessionId = await readSessionIdFromStdin();
      const sessionId =
        stdinSessionId ??
        process.env.SESSION_ID ??
        `session-${process.pid}-${Date.now()}`;
      const result = await runStop(socketPath, opts.force === true, sessionId);
      console.log(result.message);
      if (!result.ok) {
        process.exitCode = 1;
      }
    });
  return cmd;
}
