import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { ScriptCallback } from "../callback.js";
import {
  ensureCloudflared,
  getTunnelSpawnArgs,
  loadConfig,
  parseTunnelUrl,
} from "../config.js";
import type { CodocConfig } from "../config.js";
import { FileWatcher } from "../file-watcher.js";
import { GitOps } from "../git-ops.js";
import { createHttpHandler } from "../http.js";
import { IpcServer } from "../ipc.js";
import { IpcClient } from "../ipc.js";
import {
  getDefaultSocketPath,
  getDefaultTokensPath,
  readSessionIdFromStdin,
} from "../paths.js";
import { PresenceTracker } from "../presence.js";
import { SessionTracker } from "../session-tracker.js";
import { TokenStore } from "../token-store.js";
import { WebSocketServer } from "../websocket.js";

export interface ServerOptions {
  port: number;
  socketPath: string;
  tokensPath: string;
  callbackScript?: string;
  tunnelUrl?: string;
  defaultName?: string;
}

export interface ServerHandle {
  port: number;
  socketPath: string;
  tunnelUrl: string | null;
  shutdown: () => Promise<void>;
}

function isSocketActive(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(socketPath, () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => {
      resolve(false);
    });
    socket.setTimeout(2000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

export async function startServer(options: ServerOptions): Promise<ServerHandle> {
  const { port, socketPath, tokensPath, callbackScript, tunnelUrl, defaultName } =
    options;

  if (fs.existsSync(socketPath)) {
    const active = await isSocketActive(socketPath);
    if (active) {
      throw new Error("Server already running — socket is active");
    }
    fs.unlinkSync(socketPath);
  }

  const tokenStore = new TokenStore(tokensPath);
  const gitOpsMap = new Map<string, GitOps>();

  const codocGitBase = path.join(os.homedir(), ".codoc", "git");
  for (const entry of tokenStore.list()) {
    const fileHash = crypto
      .createHash("sha256")
      .update(entry.filePath)
      .digest("hex")
      .slice(0, 16);
    const gitBase = path.join(codocGitBase, fileHash);
    const gitDir = path.join(gitBase, ".git");
    if (fs.existsSync(gitDir)) {
      const gitOps = new GitOps(gitDir, gitBase);
      gitOpsMap.set(entry.token, gitOps);
    }
  }
  const sessionTracker = new SessionTracker();
  const presenceTracker = new PresenceTracker();
  presenceTracker.startCleanup();
  let wsServer: WebSocketServer | null = null;
  const scriptCallback = callbackScript ? new ScriptCallback(callbackScript) : null;
  const baseUrl = tunnelUrl ?? `http://127.0.0.1:${port}`;
  const lastSavedContentHash = new Map<string, string>();

  const handler = createHttpHandler(
    tokenStore,
    (token: string, content: string, author: string) => {
      const entry = tokenStore.resolve(token);
      if (entry) {
        lastSavedContentHash.set(
          entry.filePath,
          crypto.createHash("sha256").update(content).digest("hex"),
        );
      }
      if (wsServer) {
        wsServer.notifySaved(token, author);
      }
      if (scriptCallback) {
        if (entry) {
          const editUrl = `${baseUrl}/edit/${token}`;
          scriptCallback.execute(entry.filePath, "save", token, editUrl);
        }
      }
    },
    gitOpsMap,
    sessionTracker,
    defaultName,
    presenceTracker,
  );
  const httpServer = http.createServer(handler);

  const MAX_PORT_RETRIES = 10;
  const actualPort = await (async () => {
    for (let attempt = 0; attempt <= MAX_PORT_RETRIES; attempt++) {
      const candidatePort = port + attempt;
      try {
        return await new Promise<number>((resolve, reject) => {
          const onError = (err: NodeJS.ErrnoException) => {
            httpServer.removeListener("error", onError);
            reject(err);
          };
          httpServer.on("error", onError);
          httpServer.listen(candidatePort, "127.0.0.1", () => {
            httpServer.removeListener("error", onError);
            const addr = httpServer.address() as net.AddressInfo;
            resolve(addr.port);
          });
        });
      } catch (err: unknown) {
        const e = err as NodeJS.ErrnoException;
        if (e.code === "EADDRINUSE" && attempt < MAX_PORT_RETRIES) {
          continue;
        }
        throw e;
      }
    }
    throw new Error(`All ports ${port}-${port + MAX_PORT_RETRIES} are in use`);
  })();

  wsServer = new WebSocketServer(httpServer, tokenStore);
  const fileWatcher = new FileWatcher();

  sessionTracker.setOnStatusChange((token: string | null, online: boolean) => {
    if (wsServer && token) {
      wsServer.broadcastAgentStatus(token, online);
    }
  });

  presenceTracker.setOnChange((changedToken: string) => {
    if (wsServer) {
      const users = presenceTracker.getUsers(changedToken);
      wsServer.broadcastPresence(changedToken, users);
    }
  });

  const ipcServer = new IpcServer(socketPath, tokenStore, actualPort);
  ipcServer.setFileWatcher(fileWatcher);
  ipcServer.setSessionTracker(sessionTracker);
  ipcServer.setPresenceLeave((sessionId: string) => {
    presenceTracker.leave(sessionId);
  });

  for (const entry of tokenStore.list()) {
    const resolvedPath = entry.filePath;
    if (fs.existsSync(resolvedPath)) {
      fileWatcher.watch(resolvedPath, (changedPath: string, newContent: string) => {
        const contentHash = crypto
          .createHash("sha256")
          .update(newContent)
          .digest("hex");
        const lastHash = lastSavedContentHash.get(changedPath);
        if (lastHash === contentHash) {
          return;
        }
        const matchedEntry = tokenStore.list().find((e) => e.filePath === changedPath);
        if (matchedEntry) {
          wsServer.notifyFileChanged(matchedEntry.token, newContent, [], "external");
          if (scriptCallback) {
            const editUrl = `${baseUrl}/edit/${matchedEntry.token}`;
            scriptCallback.execute(
              matchedEntry.filePath,
              "external_change",
              matchedEntry.token,
              editUrl,
            );
          }
        }
      });
    }
  }

  ipcServer.setOnShare(
    async (
      params: Record<string, unknown>,
      result: { ok: boolean; data?: unknown },
    ) => {
      if (result.ok && result.data) {
        const data = result.data as { token: string; url: string };
        const filePath = params.filePath as string;
        const resolvedPath = path.resolve(filePath);
        if (gitOpsMap.has(data.token)) {
          return;
        }
        fileWatcher.watch(resolvedPath, (changedPath: string, newContent: string) => {
          const contentHash = crypto
            .createHash("sha256")
            .update(newContent)
            .digest("hex");
          const lastHash = lastSavedContentHash.get(changedPath);
          if (lastHash === contentHash) {
            return;
          }
          const entry = tokenStore.list().find((e) => e.filePath === changedPath);
          if (entry) {
            wsServer.notifyFileChanged(entry.token, newContent, [], "external");
            if (scriptCallback) {
              const editUrl = `${baseUrl}/edit/${entry.token}`;
              scriptCallback.execute(
                entry.filePath,
                "external_change",
                entry.token,
                editUrl,
              );
            }
          }
        });

        const fileHash = crypto
          .createHash("sha256")
          .update(resolvedPath)
          .digest("hex")
          .slice(0, 16);
        const gitBase = path.join(os.homedir(), ".codoc", "git", fileHash);
        const gitDir = path.join(gitBase, ".git");
        const gitOps = new GitOps(gitDir, gitBase);
        try {
          await gitOps.init();
          const gitFilePath = path.join(gitBase, "doc.md");
          fs.copyFileSync(resolvedPath, gitFilePath);
          await gitOps.commit("doc.md", "initial", "system");
          gitOpsMap.set(data.token, gitOps);
        } catch {
          // git init failure is non-fatal
        }
      }
    },
  );

  const shutdown = async (): Promise<void> => {
    presenceTracker.stopCleanup();
    await fileWatcher.close();
    wsServer.close();
    await ipcServer.stop();
    await new Promise<void>((resolve) => {
      httpServer.close(() => {
        resolve();
      });
    });
  };

  ipcServer.setTunnelUrl(tunnelUrl ?? null);

  ipcServer.onStop(() => {
    shutdown().catch(() => {});
  });

  await ipcServer.start();

  return {
    port: actualPort,
    socketPath,
    tunnelUrl: tunnelUrl ?? null,
    shutdown,
  };
}

function startTunnel(
  port: number,
  cloudflaredPath: string,
): Promise<{ tunnelUrl: string; tunnelProcess: childProcess.ChildProcess }> {
  return new Promise((resolve, reject) => {
    const spawnArgs = getTunnelSpawnArgs(port, cloudflaredPath);
    const proc = childProcess.spawn(spawnArgs.command, spawnArgs.args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    const timeout = setTimeout(() => {
      reject(new Error("Tunnel startup timed out after 30s"));
    }, 30000);

    const handleOutput = (data: Buffer) => {
      output += data.toString();
      const url = parseTunnelUrl(output);
      if (url) {
        clearTimeout(timeout);
        resolve({ tunnelUrl: url, tunnelProcess: proc });
      }
    };

    proc.stdout?.on("data", handleOutput);
    proc.stderr?.on("data", handleOutput);

    proc.on("error", (err: Error) => {
      clearTimeout(timeout);
      reject(err);
    });

    proc.on("exit", (code: number | null) => {
      clearTimeout(timeout);
      if (!output.includes("trycloudflare.com")) {
        reject(new Error(`cloudflared exited with code ${code}`));
      }
    });
  });
}

async function runServer(): Promise<void> {
  const socketPath = getDefaultSocketPath();

  const stdinSessionId = await readSessionIdFromStdin();
  const sessionId =
    stdinSessionId ?? process.env.SESSION_ID ?? `session-${process.pid}-${Date.now()}`;
  let alreadyRunning = false;

  if (fs.existsSync(socketPath)) {
    const active = await isSocketActive(socketPath);
    if (active) {
      alreadyRunning = true;
    }
  }

  if (!alreadyRunning && process.env.CODOC_DAEMON !== "1") {
    const cliPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "cli.js",
    );
    const child = childProcess.spawn(process.execPath, [cliPath, "server"], {
      env: { ...process.env, CODOC_DAEMON: "1" },
      detached: true,
      stdio: "ignore",
    });
    child.unref();

    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 100));
      if (fs.existsSync(socketPath) && (await isSocketActive(socketPath))) {
        alreadyRunning = true;
        break;
      }
    }
    if (!alreadyRunning) {
      console.error("Server failed to start within 5s");
      process.exitCode = 1;
      return;
    }
  }

  if (alreadyRunning) {
    let address = "";
    try {
      const client = new IpcClient(socketPath);
      const resp = await client.send({
        method: "session-start",
        params: { sessionId },
      });
      if (resp.ok) {
        const data = resp.data as { port: number; tunnelUrl: string | null };
        address = data.tunnelUrl ?? `http://127.0.0.1:${data.port}`;
      }
    } catch {
      // non-fatal
    }
    const msg = address ? `codoc server running at ${address}` : "codoc server running";
    process.stdout.write(`${JSON.stringify({ systemMessage: msg })}\n`);
    return;
  }

  const tokensPath = getDefaultTokensPath();
  const configPath = path.join(os.homedir(), ".codoc", "config.json");

  let config: CodocConfig;
  try {
    config = loadConfig(configPath);
  } catch (err: unknown) {
    const e = err as Error;
    console.error(`Config error: ${e.message}`);
    process.exitCode = 1;
    return;
  }

  let tunnelUrl: string | undefined;
  let tunnelProcess: childProcess.ChildProcess | null = null;

  if (config.tunnel === "cloudflare") {
    const cloudflaredPath = ensureCloudflared();
    if (!cloudflaredPath) {
      console.error("cloudflared not available, starting without tunnel");
    }
    if (cloudflaredPath)
      try {
        const result = await startTunnel(config.port, cloudflaredPath);
        tunnelUrl = result.tunnelUrl;
        tunnelProcess = result.tunnelProcess;
      } catch {
        // tunnel failure is non-fatal, server starts without it
      }
  }

  try {
    const handle = await startServer({
      port: config.port,
      socketPath,
      tokensPath,
      callbackScript: config.callbackScript,
      tunnelUrl,
      defaultName: config.defaultName,
    });

    const onSignal = () => {
      if (tunnelProcess) {
        tunnelProcess.kill();
      }
      handle
        .shutdown()
        .then(() => {
          process.exit(0);
        })
        .catch(() => {
          process.exit(1);
        });
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
  } catch (err: unknown) {
    const e = err as Error;
    if (tunnelProcess) {
      tunnelProcess.kill();
    }
    console.error(`Failed to start server: ${e.message}`);
    process.exitCode = 1;
  }
}

export function serverCommand(): Command {
  const cmd = new Command("server");
  cmd.description("Start codoc server").action(runServer);
  return cmd;
}
