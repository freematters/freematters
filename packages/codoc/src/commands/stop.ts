import fs from "node:fs";
import { Command } from "commander";
import { IpcClient } from "../ipc.js";
import { getDefaultSocketPath } from "../paths.js";

export interface StopResult {
  ok: boolean;
  message: string;
}

export async function runStop(socketPath: string): Promise<StopResult> {
  if (!fs.existsSync(socketPath)) {
    return { ok: true, message: "Server not running" };
  }

  const client = new IpcClient(socketPath);

  try {
    const response = await client.send({ method: "stop", params: {} });
    if (response.ok) {
      return { ok: true, message: "Server stopped." };
    }
    return { ok: false, message: response.error ?? "Unknown error" };
  } catch {
    return { ok: true, message: "Server not running" };
  }
}

export function stopCommand(): Command {
  const cmd = new Command("stop");
  cmd.description("Stop running server").action(async () => {
    const socketPath = getDefaultSocketPath();
    const result = await runStop(socketPath);
    process.stdout.write(
      `${JSON.stringify({ systemMessage: `codoc: ${result.message}` })}\n`,
    );
  });
  return cmd;
}
