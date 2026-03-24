import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import type { SessionState } from "../hooks/post-tool-use.js";
import { IpcClient } from "../ipc.js";
import { getDefaultSocketPath } from "../paths.js";

function isSocketActive(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const conn = net.createConnection(socketPath);
    conn.on("connect", () => {
      conn.destroy();
      resolve(true);
    });
    conn.on("error", () => {
      resolve(false);
    });
  });
}

async function waitForServer(socketPath: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(socketPath) && (await isSocketActive(socketPath))) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function runShare(file: string): Promise<void> {
  const socketPath = getDefaultSocketPath();
  const filePath = path.resolve(file);

  if (!fs.existsSync(socketPath) || !(await isSocketActive(socketPath))) {
    console.error("Waiting for codoc server to start...");
    const ready = await waitForServer(socketPath, 30000);
    if (!ready) {
      console.error(
        "codoc server did not start within 30s. Is the SessionStart hook configured?",
      );
      process.exitCode = 1;
      return;
    }
  }

  const client = new IpcClient(socketPath);

  try {
    const response = await client.send({
      method: "share",
      params: { filePath, readonly: false },
    });
    if (!response.ok) {
      console.error(`Error: ${response.error}`);
      process.exitCode = 1;
      return;
    }
    const data = response.data as {
      token: string;
      url: string;
      readonlyToken?: string;
      readonlyUrl?: string;
    };
    console.log(`Edit:     ${data.url}`);
    if (data.readonlyUrl) {
      console.log(`Readonly: ${data.readonlyUrl}`);
    }
    const baseUrl = data.url.replace(`/edit/${data.token}`, "");
    console.log(`Agent:    ${baseUrl}/HOWTO_FOR_AGENT/${data.token}.md`);
    console.log(`\nRun \`codoc poll ${data.token} <author>\` to wait for edits.`);

    try {
      const sessionsDir = path.join(os.homedir(), ".codoc", "sessions");
      if (!fs.existsSync(sessionsDir)) {
        fs.mkdirSync(sessionsDir, { recursive: true });
      }
      const sessionId = process.env.SESSION_ID ?? "default";
      const sessionFile = path.join(sessionsDir, `${sessionId}.json`);
      let state: SessionState;
      try {
        state = JSON.parse(fs.readFileSync(sessionFile, "utf-8"));
      } catch {
        state = { watchedTokens: [], baselines: {}, lastCheckAt: 0 };
      }
      if (!state.watchedTokens.includes(data.token)) {
        state.watchedTokens.push(data.token);
      }
      if (!state.baselines[data.token]) {
        const content = fs.readFileSync(filePath, "utf-8");
        const fileStat = fs.statSync(filePath);
        state.baselines[data.token] = {
          mtime: fileStat.mtimeMs,
          contentHash: crypto.createHash("sha256").update(content).digest("hex"),
          content,
        };
      }
      fs.writeFileSync(sessionFile, JSON.stringify(state, null, 2));
    } catch {
      // Non-critical: session file write failure does not block share
    }
  } catch (err: unknown) {
    const e = err as Error;
    console.error(`Failed to connect to server: ${e.message}`);
    console.error("Is the codoc server running? Start it with: codoc server");
    process.exitCode = 1;
  }
}

export function shareCommand(): Command {
  const cmd = new Command("share");
  cmd
    .description("Share a file for collaboration")
    .argument("<file>", "File to share")
    .action(runShare);
  return cmd;
}
