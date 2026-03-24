import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { type ServerHandle, startServer } from "../commands/server.js";
import { IpcClient } from "../ipc.js";

function uniquePath(prefix: string, ext: string): string {
  return path.join(
    os.tmpdir(),
    `codoc-mc-${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}${ext}`,
  );
}

function httpGet(
  port: number,
  urlPath: string,
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${port}${urlPath}`, (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.on("end", () => {
          resolve({ statusCode: res.statusCode!, body });
        });
      })
      .on("error", reject);
  });
}

function httpPost(
  port: number,
  urlPath: string,
  data: string,
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `http://127.0.0.1:${port}${urlPath}`,
      { method: "POST", headers: { "Content-Type": "application/json" } },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.on("end", () => {
          resolve({ statusCode: res.statusCode!, body });
        });
      },
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function connectWs(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on("open", () => {
      resolve(ws);
    });
    ws.on("error", reject);
  });
}

function waitForMessage(
  ws: WebSocket,
  timeoutMs: number,
): Promise<{ type: string; payload: unknown }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for WS message"));
    }, timeoutMs);
    ws.once("message", (data: WebSocket.Data) => {
      clearTimeout(timeout);
      resolve(JSON.parse(data.toString()));
    });
  });
}

function ipcPoll(
  socketPath: string,
  token: string,
  timeoutMs: number,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath, () => {
      socket.write(`${JSON.stringify({ method: "poll", params: { token } })}\n`);
    });
    let buffer = "";
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop()!;
      for (const line of lines) {
        if (line.trim().length === 0) continue;
        try {
          const resp = JSON.parse(line);
          socket.end();
          resolve(resp);
        } catch (err: unknown) {
          socket.end();
          reject(err);
        }
        return;
      }
    });
    socket.on("error", reject);
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      reject(new Error("poll timed out"));
    });
  });
}

function waitForMessageType(
  ws: WebSocket,
  expectedType: string,
  timeoutMs: number,
): Promise<{ type: string; payload: unknown }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for WS message type: ${expectedType}`));
    }, timeoutMs);
    const handler = (data: WebSocket.Data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === expectedType) {
        clearTimeout(timeout);
        ws.removeListener("message", handler);
        resolve(msg);
      }
    };
    ws.on("message", handler);
  });
}

function subscribeWs(
  ws: WebSocket,
  token: string,
): Promise<{ type: string; payload: unknown }> {
  const msgPromise = waitForMessage(ws, 5000);
  ws.send(JSON.stringify({ type: "file:subscribe", payload: { token } }));
  return msgPromise;
}

// ============================================================
// Scenario 1: Multiple browsers (WebSocket clients) see each other's edits
// ============================================================
describe("Multi-client Scenario 1: Multiple browsers see each other's edits", () => {
  let handle: ServerHandle | null = null;
  let socketPath: string;
  let tokensPath: string;
  let testFilePath: string;
  let token: string;

  beforeEach(async () => {
    socketPath = uniquePath("mc1-sock", ".sock");
    tokensPath = uniquePath("mc1-tokens", ".json");
    testFilePath = uniquePath("mc1-file", ".md");
    fs.writeFileSync(testFilePath, "# Collaborative Doc\n\nInitial content.\n");
    handle = await startServer({ port: 0, socketPath, tokensPath });
    await handle.startIpc();

    const client = new IpcClient(socketPath);
    const shareRes = await client.send({
      method: "share",
      params: { filePath: testFilePath },
    });
    token = (shareRes.data as { token: string }).token;
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  afterEach(async () => {
    if (handle) {
      await handle.shutdown();
      handle = null;
    }
    try {
      fs.unlinkSync(socketPath);
    } catch {}
    try {
      fs.unlinkSync(tokensPath);
    } catch {}
    try {
      fs.unlinkSync(testFilePath);
    } catch {}
  });

  it("browser A saves via HTTP, browser B receives file:saved via WebSocket", async () => {
    const wsA = await connectWs(handle!.port);
    const wsB = await connectWs(handle!.port);

    await subscribeWs(wsA, token);
    await subscribeWs(wsB, token);

    const savedPromiseB = waitForMessage(wsB, 5000);

    await httpPost(
      handle!.port,
      `/api/file/${token}`,
      JSON.stringify({
        content: "# Collaborative Doc\n\nEdited by A.\n",
        author: "browserA",
      }),
    );

    const savedMsg = await savedPromiseB;
    expect(savedMsg.type).toBe("file:saved");
    const payload = savedMsg.payload as { by: string; version: number };
    expect(payload.by).toBe("browserA");
    expect(payload.version).toBeGreaterThan(0);

    wsA.close();
    wsB.close();
  });

  it("three browsers connected: one saves, other two both receive notification", async () => {
    const wsA = await connectWs(handle!.port);
    const wsB = await connectWs(handle!.port);
    const wsC = await connectWs(handle!.port);

    await subscribeWs(wsA, token);
    await subscribeWs(wsB, token);
    await subscribeWs(wsC, token);

    const savedPromiseA = waitForMessage(wsA, 5000);
    const savedPromiseB = waitForMessage(wsB, 5000);
    const savedPromiseC = waitForMessage(wsC, 5000);

    await httpPost(
      handle!.port,
      `/api/file/${token}`,
      JSON.stringify({
        content: "# Collaborative Doc\n\nEdited by B.\n",
        author: "browserB",
      }),
    );

    const [msgA, msgB, msgC] = await Promise.all([
      savedPromiseA,
      savedPromiseB,
      savedPromiseC,
    ]);

    expect(msgA.type).toBe("file:saved");
    expect(msgB.type).toBe("file:saved");
    expect(msgC.type).toBe("file:saved");

    expect((msgA.payload as { by: string }).by).toBe("browserB");
    expect((msgB.payload as { by: string }).by).toBe("browserB");
    expect((msgC.payload as { by: string }).by).toBe("browserB");

    wsA.close();
    wsB.close();
    wsC.close();
  });

  it("external file change triggers file:changed on all connected browsers", async () => {
    const wsA = await connectWs(handle!.port);
    const wsB = await connectWs(handle!.port);

    await subscribeWs(wsA, token);
    await subscribeWs(wsB, token);

    const changedA = waitForMessage(wsA, 5000);
    const changedB = waitForMessage(wsB, 5000);

    await new Promise((resolve) => setTimeout(resolve, 300));
    fs.writeFileSync(testFilePath, "# Collaborative Doc\n\nExternal edit.\n");

    const [msgA, msgB] = await Promise.all([changedA, changedB]);

    expect(msgA.type).toBe("file:changed");
    expect(msgB.type).toBe("file:changed");
    expect((msgA.payload as { diff: string }).diff).toContain("External edit");
    expect((msgB.payload as { diff: string }).diff).toContain("External edit");

    wsA.close();
    wsB.close();
  });

  it("sequential saves from different browsers are received in order with increasing versions", async () => {
    const wsObserver = await connectWs(handle!.port);
    await subscribeWs(wsObserver, token);

    const messages: Array<{ type: string; payload: unknown }> = [];
    const collectThree = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Only got ${messages.length}/3 messages`));
      }, 10000);
      wsObserver.on("message", (data: WebSocket.Data) => {
        messages.push(JSON.parse(data.toString()));
        if (messages.length >= 3) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    await httpPost(
      handle!.port,
      `/api/file/${token}`,
      JSON.stringify({ content: "v1\n", author: "userA" }),
    );
    await httpPost(
      handle!.port,
      `/api/file/${token}`,
      JSON.stringify({ content: "v2\n", author: "userB" }),
    );
    await httpPost(
      handle!.port,
      `/api/file/${token}`,
      JSON.stringify({ content: "v3\n", author: "userC" }),
    );

    await collectThree;

    expect(messages.length).toBe(3);
    for (const msg of messages) {
      expect(msg.type).toBe("file:saved");
    }

    const versions = messages.map((m) => (m.payload as { version: number }).version);
    expect(versions[0]).toBeLessThan(versions[1]);
    expect(versions[1]).toBeLessThan(versions[2]);

    const authors = messages.map((m) => (m.payload as { by: string }).by);
    expect(authors).toEqual(["userA", "userB", "userC"]);

    wsObserver.close();
  });
});

// ============================================================
// Scenario 2: Browser + local codoc poll simultaneous connection
// ============================================================
describe("Multi-client Scenario 2: Browser + local codoc poll", () => {
  let handle: ServerHandle | null = null;
  let socketPath: string;
  let tokensPath: string;
  let testFilePath: string;
  let token: string;

  beforeEach(async () => {
    socketPath = uniquePath("mc2-sock", ".sock");
    tokensPath = uniquePath("mc2-tokens", ".json");
    testFilePath = uniquePath("mc2-file", ".md");
    fs.writeFileSync(testFilePath, "# Browser + Poll Doc\n\nOriginal.\n");
    handle = await startServer({ port: 0, socketPath, tokensPath });
    await handle.startIpc();

    const client = new IpcClient(socketPath);
    const shareRes = await client.send({
      method: "share",
      params: { filePath: testFilePath },
    });
    token = (shareRes.data as { token: string }).token;
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  afterEach(async () => {
    if (handle) {
      await handle.shutdown();
      handle = null;
    }
    try {
      fs.unlinkSync(socketPath);
    } catch {}
    try {
      fs.unlinkSync(tokensPath);
    } catch {}
    try {
      fs.unlinkSync(testFilePath);
    } catch {}
  });

  it("browser saves, local poll receives diff", async () => {
    const ws = await connectWs(handle!.port);
    await subscribeWs(ws, token);

    const pollPromise = ipcPoll(socketPath, token, 10000);

    await new Promise((resolve) => setTimeout(resolve, 500));

    await httpPost(
      handle!.port,
      `/api/file/${token}`,
      JSON.stringify({
        content: "# Browser + Poll Doc\n\nEdited by browser.\n",
        author: "browser",
      }),
    );

    const pollRes = await pollPromise;
    expect(pollRes.ok).toBe(true);
    const pollData = pollRes.data as { diff: string; newComments: unknown[] };
    expect(pollData.diff).toContain("Edited by browser");

    ws.close();
  });

  it("external file change notifies both browser (WebSocket) and local poll (IPC)", async () => {
    const ws = await connectWs(handle!.port);
    await subscribeWs(ws, token);

    const pollPromise = ipcPoll(socketPath, token, 10000);
    const wsPromise = waitForMessageType(ws, "file:changed", 10000);

    await new Promise((resolve) => setTimeout(resolve, 500));
    fs.writeFileSync(testFilePath, "# Browser + Poll Doc\n\nExternal edit for both.\n");

    const [pollRes, wsMsg] = await Promise.all([pollPromise, wsPromise]);

    expect(pollRes.ok).toBe(true);
    expect((pollRes.data as { diff: string }).diff).toContain("External edit for both");

    expect(wsMsg.type).toBe("file:changed");
    expect((wsMsg.payload as { diff: string }).diff).toContain(
      "External edit for both",
    );

    ws.close();
  });

  it("local poll receives diff when browser saves, browser gets file:saved", async () => {
    const ws = await connectWs(handle!.port);
    await subscribeWs(ws, token);

    const pollPromise = ipcPoll(socketPath, token, 10000);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const savedPromise = waitForMessage(ws, 5000);

    await httpPost(
      handle!.port,
      `/api/file/${token}`,
      JSON.stringify({
        content: "# Browser + Poll Doc\n\nBidirectional test.\n",
        author: "browser",
      }),
    );

    const [pollRes, savedMsg] = await Promise.all([pollPromise, savedPromise]);

    expect(pollRes.ok).toBe(true);
    expect((pollRes.data as { diff: string }).diff).toContain("Bidirectional test");

    expect(savedMsg.type).toBe("file:saved");
    expect((savedMsg.payload as { by: string }).by).toBe("browser");

    ws.close();
  });
});

// ============================================================
// Scenario 3: Browser + local poll + remote agent (HTTP polling) all connected
// ============================================================
describe("Multi-client Scenario 3: Browser + local poll + remote agent (API poll)", () => {
  let handle: ServerHandle | null = null;
  let socketPath: string;
  let tokensPath: string;
  let testFilePath: string;
  let token: string;

  beforeEach(async () => {
    socketPath = uniquePath("mc3-sock", ".sock");
    tokensPath = uniquePath("mc3-tokens", ".json");
    testFilePath = uniquePath("mc3-file", ".md");
    fs.writeFileSync(testFilePath, "# Three-way Doc\n\nInitial content.\n");
    handle = await startServer({ port: 0, socketPath, tokensPath });
    await handle.startIpc();

    const client = new IpcClient(socketPath);
    const shareRes = await client.send({
      method: "share",
      params: { filePath: testFilePath },
    });
    token = (shareRes.data as { token: string }).token;
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  afterEach(async () => {
    if (handle) {
      await handle.shutdown();
      handle = null;
    }
    try {
      fs.unlinkSync(socketPath);
    } catch {}
    try {
      fs.unlinkSync(tokensPath);
    } catch {}
    try {
      fs.unlinkSync(testFilePath);
    } catch {}
  });

  it("browser saves: local poll gets diff, remote agent sees updated content via HTTP GET", async () => {
    const ws = await connectWs(handle!.port);
    await subscribeWs(ws, token);

    const initialRes = await httpGet(handle!.port, `/api/file/${token}`);
    const initialContent = JSON.parse(initialRes.body).content as string;

    const pollPromise = ipcPoll(socketPath, token, 10000);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const newContent = "# Three-way Doc\n\nBrowser edit.\n";
    await httpPost(
      handle!.port,
      `/api/file/${token}`,
      JSON.stringify({ content: newContent, author: "browser" }),
    );

    const pollRes = await pollPromise;
    expect(pollRes.ok).toBe(true);
    expect((pollRes.data as { diff: string }).diff).toContain("Browser edit");

    const remoteRes = await httpGet(handle!.port, `/api/file/${token}`);
    const remoteContent = JSON.parse(remoteRes.body).content as string;
    expect(remoteContent).toBe(newContent);
    expect(remoteContent).not.toBe(initialContent);

    ws.close();
  });

  it("remote agent saves via API: browser gets file:saved, local poll gets diff", async () => {
    const ws = await connectWs(handle!.port);
    await subscribeWs(ws, token);

    const pollPromise = ipcPoll(socketPath, token, 10000);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const savedPromise = waitForMessage(ws, 5000);

    const newContent = "# Three-way Doc\n\nAgent edit via API.\n";
    await httpPost(
      handle!.port,
      `/api/file/${token}`,
      JSON.stringify({ content: newContent, author: "remote-agent" }),
    );

    const [pollRes, savedMsg] = await Promise.all([pollPromise, savedPromise]);

    expect(pollRes.ok).toBe(true);
    expect((pollRes.data as { diff: string }).diff).toContain("Agent edit via API");

    expect(savedMsg.type).toBe("file:saved");
    expect((savedMsg.payload as { by: string }).by).toBe("remote-agent");

    const diskContent = fs.readFileSync(testFilePath, "utf-8");
    expect(diskContent).toBe(newContent);

    ws.close();
  });

  it("external file change (agent edits disk): all three clients get notified", async () => {
    const ws = await connectWs(handle!.port);
    await subscribeWs(ws, token);

    const initialRes = await httpGet(handle!.port, `/api/file/${token}`);
    const initialContent = JSON.parse(initialRes.body).content as string;

    const pollPromise = ipcPoll(socketPath, token, 10000);
    const wsPromise = waitForMessageType(ws, "file:changed", 10000);

    await new Promise((resolve) => setTimeout(resolve, 500));
    fs.writeFileSync(testFilePath, "# Three-way Doc\n\nDisk edit by agent.\n");

    const [pollRes, wsMsg] = await Promise.all([pollPromise, wsPromise]);

    expect(pollRes.ok).toBe(true);
    expect((pollRes.data as { diff: string }).diff).toContain("Disk edit by agent");

    expect(wsMsg.type).toBe("file:changed");
    expect((wsMsg.payload as { diff: string }).diff).toContain("Disk edit by agent");

    const remoteRes = await httpGet(handle!.port, `/api/file/${token}`);
    const remoteContent = JSON.parse(remoteRes.body).content as string;
    expect(remoteContent).toContain("Disk edit by agent");
    expect(remoteContent).not.toBe(initialContent);

    ws.close();
  });

  it("remote agent HTTP polling detects content hash change", async () => {
    const res1 = await httpGet(handle!.port, `/api/file/${token}`);
    const content1 = JSON.parse(res1.body).content as string;
    const hash1 = Buffer.from(content1).toString("base64");

    await httpPost(
      handle!.port,
      `/api/file/${token}`,
      JSON.stringify({
        content: "# Three-way Doc\n\nUpdated by someone.\n",
        author: "someone",
      }),
    );

    const res2 = await httpGet(handle!.port, `/api/file/${token}`);
    const content2 = JSON.parse(res2.body).content as string;
    const hash2 = Buffer.from(content2).toString("base64");

    expect(hash1).not.toBe(hash2);
    expect(content2).toContain("Updated by someone");
  });

  it("presence API tracks all three client types simultaneously", async () => {
    const joinBrowser = await httpPost(
      handle!.port,
      `/api/presence/${token}/join`,
      JSON.stringify({ author: "browser-user", mode: "write" }),
    );
    expect(joinBrowser.statusCode).toBe(200);
    const browserSessionId = JSON.parse(joinBrowser.body).sessionId;

    const joinLocal = await httpPost(
      handle!.port,
      `/api/presence/${token}/join`,
      JSON.stringify({ author: "local-agent", mode: "read" }),
    );
    expect(joinLocal.statusCode).toBe(200);
    const localSessionId = JSON.parse(joinLocal.body).sessionId;

    const joinRemote = await httpPost(
      handle!.port,
      `/api/presence/${token}/join`,
      JSON.stringify({ author: "remote-agent", mode: "write" }),
    );
    expect(joinRemote.statusCode).toBe(200);
    const remoteSessionId = JSON.parse(joinRemote.body).sessionId;

    const presenceRes = await httpGet(handle!.port, `/api/presence/${token}`);
    expect(presenceRes.statusCode).toBe(200);
    const users = JSON.parse(presenceRes.body).users as Array<{
      author: string;
      mode: string;
    }>;
    const authors = users.map((u) => u.author);
    expect(authors).toContain("browser-user");
    expect(authors).toContain("local-agent");
    expect(authors).toContain("remote-agent");

    await httpPost(
      handle!.port,
      `/api/presence/${token}/leave`,
      JSON.stringify({ sessionId: browserSessionId }),
    );
    await httpPost(
      handle!.port,
      `/api/presence/${token}/leave`,
      JSON.stringify({ sessionId: localSessionId }),
    );
    await httpPost(
      handle!.port,
      `/api/presence/${token}/leave`,
      JSON.stringify({ sessionId: remoteSessionId }),
    );

    const afterLeave = await httpGet(handle!.port, `/api/presence/${token}`);
    const remaining = JSON.parse(afterLeave.body).users as unknown[];
    expect(remaining.length).toBe(0);
  });

  it("rapid sequential saves from different sources: all notifications delivered correctly", async () => {
    const ws = await connectWs(handle!.port);
    await subscribeWs(ws, token);

    const messages: Array<{ type: string; payload: unknown }> = [];
    const collectThree = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Only got ${messages.length}/3 messages`));
      }, 10000);
      ws.on("message", (data: WebSocket.Data) => {
        messages.push(JSON.parse(data.toString()));
        if (messages.length >= 3) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    await httpPost(
      handle!.port,
      `/api/file/${token}`,
      JSON.stringify({ content: "save1\n", author: "browser" }),
    );
    await httpPost(
      handle!.port,
      `/api/file/${token}`,
      JSON.stringify({ content: "save2\n", author: "remote-agent" }),
    );
    await httpPost(
      handle!.port,
      `/api/file/${token}`,
      JSON.stringify({ content: "save3\n", author: "local-agent" }),
    );

    await collectThree;

    const authors = messages.map((m) => (m.payload as { by: string }).by);
    expect(authors).toEqual(["browser", "remote-agent", "local-agent"]);

    const versions = messages.map((m) => (m.payload as { version: number }).version);
    expect(versions[0]).toBeLessThan(versions[1]);
    expect(versions[1]).toBeLessThan(versions[2]);

    const finalRes = await httpGet(handle!.port, `/api/file/${token}`);
    expect(JSON.parse(finalRes.body).content).toBe("save3\n");

    ws.close();
  });
});

// ============================================================
// Scenario 4: History records correctness across clients
// ============================================================
describe("Multi-client Scenario 4: History records correctness", () => {
  let handle: ServerHandle | null = null;
  let socketPath: string;
  let tokensPath: string;
  let testFilePath: string;
  let token: string;

  beforeEach(async () => {
    socketPath = uniquePath("mc4-sock", ".sock");
    tokensPath = uniquePath("mc4-tokens", ".json");
    testFilePath = uniquePath("mc4-file", ".md");
    fs.writeFileSync(testFilePath, "# History Doc\n\nInitial.\n");
    handle = await startServer({ port: 0, socketPath, tokensPath });
    await handle.startIpc();

    const client = new IpcClient(socketPath);
    const shareRes = await client.send({
      method: "share",
      params: { filePath: testFilePath },
    });
    token = (shareRes.data as { token: string }).token;
    await new Promise((resolve) => setTimeout(resolve, 800));
  });

  afterEach(async () => {
    if (handle) {
      await handle.shutdown();
      handle = null;
    }
    try {
      fs.unlinkSync(socketPath);
    } catch {}
    try {
      fs.unlinkSync(tokensPath);
    } catch {}
    try {
      fs.unlinkSync(testFilePath);
    } catch {}
  });

  it("saves from different authors create correct history entries visible to all clients", async () => {
    await httpPost(
      handle!.port,
      `/api/file/${token}`,
      JSON.stringify({ content: "edit by browser\n", author: "browser-user" }),
    );
    await httpPost(
      handle!.port,
      `/api/file/${token}`,
      JSON.stringify({ content: "edit by agent\n", author: "remote-agent" }),
    );
    await httpPost(
      handle!.port,
      `/api/file/${token}`,
      JSON.stringify({ content: "edit by local\n", author: "local-agent" }),
    );

    const histRes = await httpGet(handle!.port, `/api/history/${token}`);
    expect(histRes.statusCode).toBe(200);
    const history = JSON.parse(histRes.body) as Array<{
      hash: string;
      author: string;
      message: string;
    }>;

    // initial + share commit + 3 saves = at least 4 entries
    expect(history.length).toBeGreaterThanOrEqual(4);

    // History is reverse chronological; most recent first
    const recentAuthors = history.slice(0, 3).map((e) => e.author);
    expect(recentAuthors).toContain("local-agent");
    expect(recentAuthors).toContain("remote-agent");
    expect(recentAuthors).toContain("browser-user");

    // All clients see the same history via HTTP GET
    const histRes2 = await httpGet(handle!.port, `/api/history/${token}`);
    const history2 = JSON.parse(histRes2.body) as Array<{ hash: string }>;
    expect(history2.map((e) => e.hash)).toEqual(history.map((e) => e.hash));
  });

  it("history content at each commit hash matches what was saved", async () => {
    await httpPost(
      handle!.port,
      `/api/file/${token}`,
      JSON.stringify({ content: "version A\n", author: "userA" }),
    );
    await httpPost(
      handle!.port,
      `/api/file/${token}`,
      JSON.stringify({ content: "version B\n", author: "userB" }),
    );

    const histRes = await httpGet(handle!.port, `/api/history/${token}`);
    const history = JSON.parse(histRes.body) as Array<{
      hash: string;
      author: string;
    }>;

    // Find commits by author
    const commitB = history.find((e) => e.author === "userB");
    const commitA = history.find((e) => e.author === "userA");
    expect(commitB).toBeDefined();
    expect(commitA).toBeDefined();

    const contentB = await httpGet(
      handle!.port,
      `/api/history/${token}/${commitB!.hash}`,
    );
    expect(JSON.parse(contentB.body).content).toBe("version B\n");

    const contentA = await httpGet(
      handle!.port,
      `/api/history/${token}/${commitA!.hash}`,
    );
    expect(JSON.parse(contentA.body).content).toBe("version A\n");
  });

  it("diff API returns correct original vs modified across multi-client edits", async () => {
    await httpPost(
      handle!.port,
      `/api/file/${token}`,
      JSON.stringify({ content: "committed content\n", author: "browser" }),
    );

    // Write directly to disk without going through HTTP (simulates agent edit)
    await new Promise((resolve) => setTimeout(resolve, 300));
    fs.writeFileSync(testFilePath, "committed content\nlocal unsaved edit\n");

    const diffRes = await httpGet(handle!.port, `/api/diff/${token}`);
    expect(diffRes.statusCode).toBe(200);
    const diffData = JSON.parse(diffRes.body);
    expect(diffData.original).toBe("committed content\n");
    expect(diffData.modified).toBe("committed content\nlocal unsaved edit\n");
    expect(diffData.diff).toContain("local unsaved edit");
  });

  it("browser (WebSocket) and remote agent (HTTP) see identical history", async () => {
    await httpPost(
      handle!.port,
      `/api/file/${token}`,
      JSON.stringify({ content: "ws check\n", author: "browser" }),
    );

    // Browser reads via WebSocket subscribe
    const ws = await connectWs(handle!.port);
    const contentMsg = await subscribeWs(ws, token);
    const wsContent = (contentMsg.payload as { content: string }).content;

    // Remote agent reads via HTTP GET
    const httpRes = await httpGet(handle!.port, `/api/file/${token}`);
    const httpContent = JSON.parse(httpRes.body).content as string;

    expect(wsContent).toBe(httpContent);
    expect(wsContent).toBe("ws check\n");

    // Both see same history
    const histRes = await httpGet(handle!.port, `/api/history/${token}`);
    expect(histRes.statusCode).toBe(200);
    const history = JSON.parse(histRes.body) as Array<{ hash: string }>;
    expect(history.length).toBeGreaterThanOrEqual(2);

    ws.close();
  });
});

// ============================================================
// Scenario 5: Poll receives final state when multiple changes happen
// ============================================================
describe("Multi-client Scenario 5: Poll with multiple intermediate changes", () => {
  let handle: ServerHandle | null = null;
  let socketPath: string;
  let tokensPath: string;
  let testFilePath: string;
  let token: string;

  beforeEach(async () => {
    socketPath = uniquePath("mc5-sock", ".sock");
    tokensPath = uniquePath("mc5-tokens", ".json");
    testFilePath = uniquePath("mc5-file", ".md");
    fs.writeFileSync(testFilePath, "# Poll Final State\n\nOriginal.\n");
    handle = await startServer({ port: 0, socketPath, tokensPath });
    await handle.startIpc();

    const client = new IpcClient(socketPath);
    const shareRes = await client.send({
      method: "share",
      params: { filePath: testFilePath },
    });
    token = (shareRes.data as { token: string }).token;
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  afterEach(async () => {
    if (handle) {
      await handle.shutdown();
      handle = null;
    }
    try {
      fs.unlinkSync(socketPath);
    } catch {}
    try {
      fs.unlinkSync(tokensPath);
    } catch {}
    try {
      fs.unlinkSync(testFilePath);
    } catch {}
  });

  it("poll resolves on first change and diff reflects content at that moment", async () => {
    const pollPromise = ipcPoll(socketPath, token, 10000);
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Single save triggers poll
    await httpPost(
      handle!.port,
      `/api/file/${token}`,
      JSON.stringify({ content: "first edit\n", author: "userA" }),
    );

    const pollRes = await pollPromise;
    expect(pollRes.ok).toBe(true);
    const diff = (pollRes.data as { diff: string }).diff;
    expect(diff).toContain("first edit");
    // The diff should show removal of original and addition of new
    expect(diff).toContain("- Original.");
    expect(diff).toContain("+ first edit");
  });

  it("consecutive polls each capture the next change correctly", async () => {
    // First poll
    const poll1 = ipcPoll(socketPath, token, 10000);
    await new Promise((resolve) => setTimeout(resolve, 500));

    await httpPost(
      handle!.port,
      `/api/file/${token}`,
      JSON.stringify({ content: "after first save\n", author: "userA" }),
    );

    const res1 = await poll1;
    expect(res1.ok).toBe(true);
    expect((res1.data as { diff: string }).diff).toContain("after first save");

    // Second poll starts from the new baseline
    const poll2 = ipcPoll(socketPath, token, 10000);
    await new Promise((resolve) => setTimeout(resolve, 500));

    await httpPost(
      handle!.port,
      `/api/file/${token}`,
      JSON.stringify({ content: "after second save\n", author: "userB" }),
    );

    const res2 = await poll2;
    expect(res2.ok).toBe(true);
    const diff2 = (res2.data as { diff: string }).diff;
    expect(diff2).toContain("after second save");
    // Should show diff from "after first save" to "after second save"
    expect(diff2).toContain("- after first save");
    expect(diff2).toContain("+ after second save");
  });

  it("remote agent HTTP polling after multiple saves sees final content", async () => {
    // Simulate remote agent's HTTP polling pattern:
    // capture initial hash, make multiple saves, then check for change

    const res1 = await httpGet(handle!.port, `/api/file/${token}`);
    const initialContent = JSON.parse(res1.body).content as string;

    await httpPost(
      handle!.port,
      `/api/file/${token}`,
      JSON.stringify({ content: "intermediate 1\n", author: "browser" }),
    );
    await httpPost(
      handle!.port,
      `/api/file/${token}`,
      JSON.stringify({ content: "intermediate 2\n", author: "local-agent" }),
    );
    await httpPost(
      handle!.port,
      `/api/file/${token}`,
      JSON.stringify({ content: "final content\n", author: "remote-agent" }),
    );

    // Remote agent polls and gets the final state
    const res2 = await httpGet(handle!.port, `/api/file/${token}`);
    const finalContent = JSON.parse(res2.body).content as string;

    expect(finalContent).toBe("final content\n");
    expect(finalContent).not.toBe(initialContent);
    // Intermediate states are gone from current content
    expect(finalContent).not.toContain("intermediate");
  });

  it("WebSocket observer sees all intermediate file:saved events with correct diffs", async () => {
    const ws = await connectWs(handle!.port);
    await subscribeWs(ws, token);

    const messages: Array<{ type: string; payload: unknown }> = [];
    const collectThree = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Only got ${messages.length}/3 saved messages`));
      }, 10000);
      ws.on("message", (data: WebSocket.Data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === "file:saved") {
          messages.push(msg);
          if (messages.length >= 3) {
            clearTimeout(timeout);
            resolve();
          }
        }
      });
    });

    await httpPost(
      handle!.port,
      `/api/file/${token}`,
      JSON.stringify({ content: "step 1\n", author: "alice" }),
    );
    await httpPost(
      handle!.port,
      `/api/file/${token}`,
      JSON.stringify({ content: "step 2\n", author: "bob" }),
    );
    await httpPost(
      handle!.port,
      `/api/file/${token}`,
      JSON.stringify({ content: "step 3\n", author: "charlie" }),
    );

    await collectThree;

    // Each save event has correct author and incrementing version
    const authors = messages.map((m) => (m.payload as { by: string }).by);
    expect(authors).toEqual(["alice", "bob", "charlie"]);

    const versions = messages.map((m) => (m.payload as { version: number }).version);
    expect(versions[0]).toBeLessThan(versions[1]);
    expect(versions[1]).toBeLessThan(versions[2]);

    ws.close();
  });

  it("history records every save even if poll only captured first change", async () => {
    // Start poll
    const pollPromise = ipcPoll(socketPath, token, 10000);
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Multiple rapid saves
    await httpPost(
      handle!.port,
      `/api/file/${token}`,
      JSON.stringify({ content: "save 1\n", author: "alice" }),
    );
    await httpPost(
      handle!.port,
      `/api/file/${token}`,
      JSON.stringify({ content: "save 2\n", author: "bob" }),
    );
    await httpPost(
      handle!.port,
      `/api/file/${token}`,
      JSON.stringify({ content: "save 3\n", author: "charlie" }),
    );

    // Poll resolves on first change
    const pollRes = await pollPromise;
    expect(pollRes.ok).toBe(true);

    // History should contain ALL saves regardless of poll behavior
    const histRes = await httpGet(handle!.port, `/api/history/${token}`);
    expect(histRes.statusCode).toBe(200);
    const history = JSON.parse(histRes.body) as Array<{
      hash: string;
      author: string;
    }>;

    const saveAuthors = history.map((e) => e.author);
    expect(saveAuthors).toContain("alice");
    expect(saveAuthors).toContain("bob");
    expect(saveAuthors).toContain("charlie");

    // Verify content at each commit
    const aliceCommit = history.find((e) => e.author === "alice");
    const bobCommit = history.find((e) => e.author === "bob");
    const charlieCommit = history.find((e) => e.author === "charlie");

    const aliceContent = await httpGet(
      handle!.port,
      `/api/history/${token}/${aliceCommit!.hash}`,
    );
    expect(JSON.parse(aliceContent.body).content).toBe("save 1\n");

    const bobContent = await httpGet(
      handle!.port,
      `/api/history/${token}/${bobCommit!.hash}`,
    );
    expect(JSON.parse(bobContent.body).content).toBe("save 2\n");

    const charlieContent = await httpGet(
      handle!.port,
      `/api/history/${token}/${charlieCommit!.hash}`,
    );
    expect(JSON.parse(charlieContent.body).content).toBe("save 3\n");
  });
});
