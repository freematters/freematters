import http from "node:http";
import { URL } from "node:url";
import { WebSocketServer } from "ws";
import type WebSocket from "ws";
import { Store } from "../store.js";
import { ClientHandler } from "./client-handler.js";
import { DaemonHandler } from "./daemon-handler.js";
import { Router } from "./router.js";
import type { GatewayConfig } from "./types.js";

export function validateApiKey(
  headerValue: string | undefined,
  validKeys: string[],
): boolean {
  if (!headerValue) return false;
  // Support "Bearer <key>" format
  const key = headerValue.startsWith("Bearer ") ? headerValue.slice(7) : headerValue;
  return validKeys.includes(key);
}

function parseBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

export function createGatewayServer(config: GatewayConfig) {
  const store = new Store(config.store_root);
  const router = new Router();
  const clientHandler = new ClientHandler(store, router);
  const daemonHandler = new DaemonHandler(router);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const path = url.pathname;
    const method = req.method ?? "GET";

    // Auth check for all /api/* routes
    if (path.startsWith("/api/")) {
      const authHeader = req.headers.authorization;
      const apiKeyHeader = req.headers["x-api-key"] as string | undefined;
      const keyValue = authHeader ?? apiKeyHeader;

      if (!keyValue) {
        sendJson(res, 401, { error: "Unauthorized" });
        return;
      }
      if (!validateApiKey(keyValue, config.api_keys)) {
        sendJson(res, 403, { error: "Forbidden" });
        return;
      }
    }

    // Route REST endpoints
    if (path === "/api/health" && method === "GET") {
      sendJson(res, 200, { status: "ok" });
      return;
    }

    if (path === "/api/runs" && method === "POST") {
      try {
        const body = (await parseBody(req)) as { workflow?: string; prompt?: string };
        if (!body.workflow) {
          sendJson(res, 400, { error: "workflow is required" });
          return;
        }
        const result = clientHandler.createRun(body.workflow, body.prompt);
        sendJson(res, 201, result);
      } catch {
        sendJson(res, 400, { error: "Invalid request body" });
      }
      return;
    }

    if (path === "/api/runs" && method === "GET") {
      const runs = clientHandler.listRuns();
      sendJson(res, 200, { runs });
      return;
    }

    // Match /api/runs/:id
    const runMatch = path.match(/^\/api\/runs\/([^/]+)$/);
    if (runMatch) {
      const runId = runMatch[1];

      if (method === "GET") {
        const run = clientHandler.getRun(runId);
        if (!run) {
          sendJson(res, 404, { error: "Run not found" });
          return;
        }
        sendJson(res, 200, run);
        return;
      }

      if (method === "DELETE") {
        const result = clientHandler.abortRun(runId);
        if (!result) {
          sendJson(res, 404, { error: "Run not found" });
          return;
        }
        sendJson(res, 200, result);
        return;
      }
    }

    sendJson(res, 404, { error: "Not found" });
  });

  // WebSocket servers
  const clientWss = new WebSocketServer({ noServer: true });
  const daemonWss = new WebSocketServer({ noServer: true });

  clientWss.on("connection", (ws: WebSocket) => {
    clientHandler.handleConnection(ws);
  });

  daemonWss.on("connection", (ws: WebSocket) => {
    daemonHandler.handleConnection(ws);
  });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const path = url.pathname;

    // Auth check for WebSocket upgrades
    const authHeader = req.headers.authorization;
    const apiKeyHeader = req.headers["x-api-key"] as string | undefined;
    const keyValue = authHeader ?? apiKeyHeader;

    if (!validateApiKey(keyValue, config.api_keys)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    if (path === "/ws/client") {
      clientWss.handleUpgrade(req, socket, head, (ws) => {
        clientWss.emit("connection", ws, req);
      });
    } else if (path === "/ws/daemon") {
      daemonWss.handleUpgrade(req, socket, head, (ws) => {
        daemonWss.emit("connection", ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  return {
    server,
    router,
    start(): Promise<void> {
      return new Promise((resolve) => {
        server.listen(config.port, config.host, () => resolve());
      });
    },
    stop(): Promise<void> {
      return new Promise((resolve, reject) => {
        // Close all WebSocket connections
        for (const client of clientWss.clients) {
          client.close();
        }
        for (const client of daemonWss.clients) {
          client.close();
        }
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}
