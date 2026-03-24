import http from "node:http";
import net from "node:net";
import { Command } from "commander";
import { IpcClient, type IpcRequest, type IpcResponse } from "../ipc.js";
import { getDefaultSocketPath } from "../paths.js";

function httpPost(port: number, urlPath: string, body: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `http://127.0.0.1:${port}${urlPath}`,
      { method: "POST", headers: { "Content-Type": "application/json" } },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on("end", () => {
          resolve(data);
        });
      },
    );
    req.on("error", () => {
      resolve("{}");
    });
    req.write(body);
    req.end();
  });
}

async function getServerPort(socketPath: string): Promise<number | null> {
  try {
    const client = new IpcClient(socketPath);
    const resp = await client.send({ method: "status", params: {} });
    if (resp.ok && resp.data) {
      const data = resp.data as { port?: number };
      return data.port ?? null;
    }
  } catch {}
  return null;
}

async function runPoll(token: string, author: string): Promise<void> {
  const socketPath = getDefaultSocketPath();
  let presenceSessionId: string | null = null;
  let serverPort: number | null = null;
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  const cleanup = async () => {
    if (heartbeatInterval !== null) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  };

  const cleanupWithLeave = async () => {
    await cleanup();
    if (presenceSessionId && serverPort) {
      await httpPost(
        serverPort,
        `/api/presence/${token}/leave`,
        JSON.stringify({ sessionId: presenceSessionId }),
      );
    }
  };

  const onSigint = () => {
    cleanupWithLeave().finally(() => process.exit(0));
  };
  process.on("SIGINT", onSigint);

  try {
    serverPort = await getServerPort(socketPath);
    if (serverPort) {
      const joinResp = await httpPost(
        serverPort,
        `/api/presence/${token}/join`,
        JSON.stringify({ author, mode: "read" }),
      );
      try {
        const parsed = JSON.parse(joinResp);
        presenceSessionId = parsed.sessionId ?? null;
      } catch {}
    }

    if (presenceSessionId && serverPort) {
      const hbPort = serverPort;
      const hbToken = token;
      const hbSessionId = presenceSessionId;
      heartbeatInterval = setInterval(() => {
        httpPost(
          hbPort,
          `/api/presence/${hbToken}/heartbeat`,
          JSON.stringify({ sessionId: hbSessionId }),
        ).catch(() => {});
      }, 30000);
    }

    const response = await new Promise<IpcResponse>((resolve, reject) => {
      const socket = net.createConnection(socketPath, () => {
        const request: IpcRequest = {
          method: "poll",
          params: { token, presenceSessionId },
        };
        socket.write(`${JSON.stringify(request)}\n`);
      });

      let buffer = "";
      socket.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop()!;
        for (const line of lines) {
          if (line.trim().length === 0) continue;
          try {
            const resp: IpcResponse = JSON.parse(line);
            socket.end();
            resolve(resp);
          } catch (err: unknown) {
            socket.end();
            reject(err);
          }
          return;
        }
      });

      socket.on("error", (err: Error) => {
        reject(new Error(`Server not running: ${err.message}`));
      });
    });

    await cleanup();

    if (!response.ok) {
      console.error(response.error);
      process.exitCode = 1;
      return;
    }

    const data = response.data as { diff: string; newComments: unknown[] };
    if (data.diff) {
      process.stdout.write(`${data.diff}\n`);
    }
  } catch (err: unknown) {
    await cleanup();
    const e = err as Error;
    console.error(e.message);
    process.exitCode = 1;
  }
}

export function pollCommand(): Command {
  const cmd = new Command("poll");
  cmd
    .description("Wait for document changes")
    .argument("<token>", "File token to poll")
    .argument("<author>", "Your name (shown in presence)")
    .action(runPoll);
  return cmd;
}
