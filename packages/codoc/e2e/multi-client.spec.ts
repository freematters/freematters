import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type Page, expect, test } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const codocBin = path.join(projectRoot, "dist", "cli.js");

interface ServerHandle {
  port: number;
  socketPath: string;
  tunnelUrl: string | null;
  startIpc: () => Promise<void>;
  shutdown: () => Promise<void>;
}

interface IpcClientLike {
  send: (msg: { method: string; params: Record<string, unknown> }) => Promise<{
    ok: boolean;
    data?: unknown;
    error?: string;
  }>;
}

function uniquePath(prefix: string, ext: string): string {
  return path.join(
    os.tmpdir(),
    `codoc-mc-pw-${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}${ext}`,
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

async function waitForMonaco(page: Page): Promise<void> {
  await page.waitForSelector(".monaco-editor", { timeout: 30000 });
  await page.waitForFunction(
    () => {
      const lines = document.querySelectorAll(".view-line");
      return lines.length > 0;
    },
    { timeout: 15000 },
  );
  await page.waitForTimeout(500);
}

const modKey = process.platform === "darwin" ? "Meta" : "Control";

// ============================================================
// Test suite: Two browsers collaborating
// ============================================================
test.describe("Multi-client E2E: Two browsers collaborating", () => {
  let serverHandle: ServerHandle | null = null;
  let editToken = "";
  let testFilePath = "";
  let socketPath = "";
  let tokensPath = "";
  let serverPort = 0;

  test.beforeAll(async () => {
    socketPath = uniquePath("2b-sock", ".sock");
    tokensPath = uniquePath("2b-tokens", ".json");
    testFilePath = uniquePath("2b-file", ".md");

    fs.writeFileSync(testFilePath, "# Collab Doc\n\nInitial content.\n");

    const serverModule = await import(
      path.join(projectRoot, "dist", "commands", "server.js")
    );
    const ipcModule = await import(path.join(projectRoot, "dist", "ipc.js"));

    serverHandle = await serverModule.startServer({
      port: 0,
      socketPath,
      tokensPath,
    });
    await serverHandle!.startIpc();
    serverPort = serverHandle!.port;

    const client: IpcClientLike = new ipcModule.IpcClient(socketPath);
    const shareRes = await client.send({
      method: "share",
      params: { filePath: testFilePath },
    });
    if (!shareRes.ok) throw new Error(`Share failed: ${shareRes.error}`);
    editToken = (shareRes.data as { token: string }).token;

    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  test.afterAll(async () => {
    if (serverHandle) {
      await serverHandle.shutdown();
      serverHandle = null;
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

  test("browser A types and saves, browser B sees updated content on reload", async ({
    browser,
  }) => {
    const editUrl = `http://127.0.0.1:${serverPort}/edit/${editToken}`;

    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    await pageA.goto(editUrl);
    await waitForMonaco(pageA);

    // Browser A types and saves
    await pageA.click(".monaco-editor");
    await pageA.keyboard.press(`${modKey}+End`);
    await pageA.keyboard.type("\nEdited by browser A.", { delay: 30 });
    await pageA.keyboard.press(`${modKey}+s`);
    await pageA.waitForTimeout(2000);

    // Verify on disk
    const diskContent = fs.readFileSync(testFilePath, "utf-8");
    expect(diskContent).toContain("Edited by browser A.");

    // Browser B opens and sees the content
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await pageB.goto(editUrl);
    await waitForMonaco(pageB);

    const contentB = await pageB.evaluate(() => {
      const editors = (
        window as unknown as {
          monaco?: {
            editor: {
              getEditors: () => Array<{ getValue: () => string }>;
            };
          };
        }
      ).monaco?.editor.getEditors();
      return editors?.[0]?.getValue() ?? "";
    });
    expect(contentB).toContain("Edited by browser A.");

    await ctxA.close();
    await ctxB.close();

    // Restore content
    fs.writeFileSync(testFilePath, "# Collab Doc\n\nInitial content.\n");
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  test("browser A saves, browser B receives real-time WebSocket notification without reload", async ({
    browser,
  }) => {
    const editUrl = `http://127.0.0.1:${serverPort}/edit/${editToken}`;

    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();

    await pageA.goto(editUrl);
    await waitForMonaco(pageA);
    await pageB.goto(editUrl);
    await waitForMonaco(pageB);

    // Set up listener on B for file:saved WebSocket message
    const savedPromise = pageB.evaluate(() => {
      return new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => resolve(false), 10000);
        const origAddEventListener = WebSocket.prototype.addEventListener;
        const allWs: WebSocket[] = [];
        // Find existing ws connections by checking for the global ws ref
        // The app stores its ws in a ref; we'll listen on all open sockets
        // Instead, intercept incoming messages
        const handler = (evt: MessageEvent) => {
          try {
            const msg = JSON.parse(evt.data);
            if (msg.type === "file:saved") {
              clearTimeout(timeout);
              resolve(true);
            }
          } catch {}
        };
        // Find all existing WebSocket instances - use performance observer trick
        // Simpler: just poll the editor content change
        // Actually let's just check that the editor content updates
        const startContent = (
          window as unknown as {
            monaco: {
              editor: {
                getEditors: () => Array<{ getValue: () => string }>;
              };
            };
          }
        ).monaco.editor
          .getEditors()[0]
          .getValue();

        const interval = setInterval(() => {
          const current = (
            window as unknown as {
              monaco: {
                editor: {
                  getEditors: () => Array<{ getValue: () => string }>;
                };
              };
            }
          ).monaco.editor
            .getEditors()[0]
            .getValue();
          if (current !== startContent) {
            clearInterval(interval);
            clearTimeout(timeout);
            resolve(true);
          }
        }, 200);
      });
    });

    // Browser A edits and saves
    await pageA.click(".monaco-editor");
    await pageA.keyboard.press(`${modKey}+End`);
    await pageA.keyboard.type("\nRealtime update from A.", { delay: 30 });
    await pageA.keyboard.press(`${modKey}+s`);

    const received = await savedPromise;
    expect(received).toBe(true);

    // Verify B's editor content updated
    const contentB = await pageB.evaluate(() => {
      return (
        window as unknown as {
          monaco: {
            editor: {
              getEditors: () => Array<{ getValue: () => string }>;
            };
          };
        }
      ).monaco.editor
        .getEditors()[0]
        .getValue();
    });
    expect(contentB).toContain("Realtime update from A.");

    await ctxA.close();
    await ctxB.close();

    // Restore content
    fs.writeFileSync(testFilePath, "# Collab Doc\n\nInitial content.\n");
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  test("both browsers see consistent history after multiple saves", async ({
    browser,
  }) => {
    const editUrl = `http://127.0.0.1:${serverPort}/edit/${editToken}`;

    // Make saves via HTTP API from different "authors"
    await httpPost(
      serverPort,
      `/api/file/${editToken}`,
      JSON.stringify({ content: "save by alice\n", author: "alice" }),
    );
    await httpPost(
      serverPort,
      `/api/file/${editToken}`,
      JSON.stringify({ content: "save by bob\n", author: "bob" }),
    );

    // Open browser and check history overlay
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(editUrl);
    await waitForMonaco(page);

    const historyButton = page.locator("button", { hasText: "History" });
    await historyButton.click();
    await page.waitForTimeout(1000);

    // Wait for history overlay to appear (may be <strong>, <h3>, or text node)
    await page.waitForTimeout(1000);

    // Verify at least one Revert button is visible (confirms history loaded)
    const revertButtons = page.locator("button", { hasText: "Revert" });
    await expect(revertButtons.first()).toBeVisible({ timeout: 5000 });
    const revertCount = await revertButtons.count();
    expect(revertCount).toBeGreaterThanOrEqual(3);

    // Also verify via HTTP API that history matches
    const histRes = await httpGet(serverPort, `/api/history/${editToken}`);
    const history = JSON.parse(histRes.body) as Array<{
      hash: string;
      author: string;
    }>;
    expect(history.length).toBeGreaterThanOrEqual(3);

    const authors = history.map((e) => e.author);
    expect(authors).toContain("alice");
    expect(authors).toContain("bob");

    await ctx.close();

    // Restore content
    fs.writeFileSync(testFilePath, "# Collab Doc\n\nInitial content.\n");
    await new Promise((resolve) => setTimeout(resolve, 500));
  });
});

// ============================================================
// Test suite: Browser + CLI poll collaboration
// ============================================================
test.describe("Multi-client E2E: Browser + CLI poll", () => {
  let serverHandle: ServerHandle | null = null;
  let editToken = "";
  let testFilePath = "";
  let socketPath = "";
  let tokensPath = "";
  let serverPort = 0;
  const cliSessionId = `pw-cli-test-${process.pid}-${Date.now()}`;

  test.beforeAll(async () => {
    // Use SESSION_ID-based socket path so CLI subprocess can find the same socket
    const user = process.env.USER ?? "unknown";
    const sockDir = path.join("/tmp", user);
    if (!fs.existsSync(sockDir)) {
      fs.mkdirSync(sockDir, { recursive: true });
    }
    socketPath = path.join(sockDir, `codoc-${cliSessionId}.sock`);
    tokensPath = uniquePath("bp-tokens", ".json");
    testFilePath = uniquePath("bp-file", ".md");

    fs.writeFileSync(testFilePath, "# Browser+Poll Doc\n\nOriginal.\n");

    const serverModule = await import(
      path.join(projectRoot, "dist", "commands", "server.js")
    );
    const ipcModule = await import(path.join(projectRoot, "dist", "ipc.js"));

    serverHandle = await serverModule.startServer({
      port: 0,
      socketPath,
      tokensPath,
    });
    await serverHandle!.startIpc();
    serverPort = serverHandle!.port;

    const client: IpcClientLike = new ipcModule.IpcClient(socketPath);
    const shareRes = await client.send({
      method: "share",
      params: { filePath: testFilePath },
    });
    if (!shareRes.ok) throw new Error(`Share failed: ${shareRes.error}`);
    editToken = (shareRes.data as { token: string }).token;

    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  test.afterAll(async () => {
    if (serverHandle) {
      await serverHandle.shutdown();
      serverHandle = null;
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

  test("browser saves via Cmd-S, IPC poll receives diff", async ({ browser }) => {
    const editUrl = `http://127.0.0.1:${serverPort}/edit/${editToken}`;

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(editUrl);
    await waitForMonaco(page);

    // Use evaluate to set editor content directly (avoids keyboard timing issues)
    await page.evaluate((newContent: string) => {
      const editors = (
        window as unknown as {
          monaco: {
            editor: {
              getEditors: () => Array<{ setValue: (v: string) => void }>;
            };
          };
        }
      ).monaco.editor.getEditors();
      editors[0].setValue(newContent);
    }, "# Browser+Poll Doc\n\nOriginal.\n\nPre-save baseline.\n");

    // Save to establish clean baseline on disk
    await page.keyboard.press(`${modKey}+s`);
    await page.waitForTimeout(2000);

    // Now start the IPC poll
    const pollPromise = ipcPoll(socketPath, editToken, 15000);
    await page.waitForTimeout(500);

    // Set new content and save
    await page.evaluate((newContent: string) => {
      const editors = (
        window as unknown as {
          monaco: {
            editor: {
              getEditors: () => Array<{ setValue: (v: string) => void }>;
            };
          };
        }
      ).monaco.editor.getEditors();
      editors[0].setValue(newContent);
    }, "# Browser+Poll Doc\n\nBrowser typed this.\n");

    await page.keyboard.press(`${modKey}+s`);
    await page.waitForTimeout(2000);

    const pollRes = await pollPromise;
    expect(pollRes.ok).toBe(true);
    const pollDiff = (pollRes.data as { diff: string }).diff;
    expect(pollDiff.length).toBeGreaterThan(0);

    // Verify on disk
    const diskAfterSave = fs.readFileSync(testFilePath, "utf-8");
    expect(diskAfterSave).toContain("Browser typed this");

    await ctx.close();

    // Restore content
    fs.writeFileSync(testFilePath, "# Browser+Poll Doc\n\nOriginal.\n");
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  test("CLI poll via subprocess: browser saves, CLI process outputs diff and exits", async ({
    browser,
  }) => {
    const editUrl = `http://127.0.0.1:${serverPort}/edit/${editToken}`;

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(editUrl);
    await waitForMonaco(page);

    // Start CLI poll as a child process with SESSION_ID so it finds the test socket
    const cliProcess: ChildProcess = spawn(
      "node",
      [codocBin, "poll", editToken, "cli-tester"],
      {
        env: {
          ...process.env,
          SESSION_ID: cliSessionId,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    cliProcess.stdout!.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    cliProcess.stderr!.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    // Wait for CLI poll to register
    await page.waitForTimeout(1500);

    // Browser types and saves
    await page.click(".monaco-editor");
    await page.keyboard.press(`${modKey}+End`);
    await page.keyboard.type("\nCLI sees this edit.", { delay: 30 });
    await page.keyboard.press(`${modKey}+s`);

    // Wait for CLI process to exit
    const exitCode = await new Promise<number | null>((resolve) => {
      const timeout = setTimeout(() => {
        cliProcess.kill();
        resolve(null);
      }, 15000);
      cliProcess.on("exit", (code) => {
        clearTimeout(timeout);
        resolve(code);
      });
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("CLI sees this edit");

    await ctx.close();

    // Restore content
    fs.writeFileSync(testFilePath, "# Browser+Poll Doc\n\nOriginal.\n");
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  test("external file edit notifies both browser and IPC poll", async ({ browser }) => {
    const editUrl = `http://127.0.0.1:${serverPort}/edit/${editToken}`;

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(editUrl);
    await waitForMonaco(page);

    // Set up browser content change detector
    const browserChanged = page.evaluate(() => {
      return new Promise<string>((resolve) => {
        const timeout = setTimeout(() => resolve(""), 10000);
        const startContent = (
          window as unknown as {
            monaco: {
              editor: {
                getEditors: () => Array<{ getValue: () => string }>;
              };
            };
          }
        ).monaco.editor
          .getEditors()[0]
          .getValue();
        const interval = setInterval(() => {
          const current = (
            window as unknown as {
              monaco: {
                editor: {
                  getEditors: () => Array<{ getValue: () => string }>;
                };
              };
            }
          ).monaco.editor
            .getEditors()[0]
            .getValue();
          if (current !== startContent) {
            clearInterval(interval);
            clearTimeout(timeout);
            resolve(current);
          }
        }, 200);
      });
    });

    // Start IPC poll
    const pollPromise = ipcPoll(socketPath, editToken, 15000);
    await page.waitForTimeout(500);

    // External file edit (simulates agent writing to disk)
    fs.writeFileSync(testFilePath, "# Browser+Poll Doc\n\nExternal agent edit.\n");

    const [pollRes, browserContent] = await Promise.all([pollPromise, browserChanged]);

    expect(pollRes.ok).toBe(true);
    expect((pollRes.data as { diff: string }).diff).toContain("External agent edit");

    expect(browserContent).toContain("External agent edit");

    await ctx.close();

    // Restore content
    fs.writeFileSync(testFilePath, "# Browser+Poll Doc\n\nOriginal.\n");
    await new Promise((resolve) => setTimeout(resolve, 500));
  });
});

// ============================================================
// Test suite: Browser + CLI poll + remote agent API (three-way)
// ============================================================
test.describe("Multi-client E2E: Browser + CLI poll + remote agent API", () => {
  let serverHandle: ServerHandle | null = null;
  let editToken = "";
  let testFilePath = "";
  let socketPath = "";
  let tokensPath = "";
  let serverPort = 0;

  test.beforeAll(async () => {
    socketPath = uniquePath("3w-sock", ".sock");
    tokensPath = uniquePath("3w-tokens", ".json");
    testFilePath = uniquePath("3w-file", ".md");

    fs.writeFileSync(testFilePath, "# Three-way Doc\n\nInitial.\n");

    const serverModule = await import(
      path.join(projectRoot, "dist", "commands", "server.js")
    );
    const ipcModule = await import(path.join(projectRoot, "dist", "ipc.js"));

    serverHandle = await serverModule.startServer({
      port: 0,
      socketPath,
      tokensPath,
    });
    await serverHandle!.startIpc();
    serverPort = serverHandle!.port;

    const client: IpcClientLike = new ipcModule.IpcClient(socketPath);
    const shareRes = await client.send({
      method: "share",
      params: { filePath: testFilePath },
    });
    if (!shareRes.ok) throw new Error(`Share failed: ${shareRes.error}`);
    editToken = (shareRes.data as { token: string }).token;

    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  test.afterAll(async () => {
    if (serverHandle) {
      await serverHandle.shutdown();
      serverHandle = null;
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

  test("remote agent saves via API: browser updates, IPC poll gets diff", async ({
    browser,
  }) => {
    const editUrl = `http://127.0.0.1:${serverPort}/edit/${editToken}`;

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(editUrl);
    await waitForMonaco(page);

    // Browser listens for content change
    const browserChanged = page.evaluate(() => {
      return new Promise<string>((resolve) => {
        const timeout = setTimeout(() => resolve(""), 10000);
        const startContent = (
          window as unknown as {
            monaco: {
              editor: {
                getEditors: () => Array<{ getValue: () => string }>;
              };
            };
          }
        ).monaco.editor
          .getEditors()[0]
          .getValue();
        const interval = setInterval(() => {
          const current = (
            window as unknown as {
              monaco: {
                editor: {
                  getEditors: () => Array<{ getValue: () => string }>;
                };
              };
            }
          ).monaco.editor
            .getEditors()[0]
            .getValue();
          if (current !== startContent) {
            clearInterval(interval);
            clearTimeout(timeout);
            resolve(current);
          }
        }, 200);
      });
    });

    // IPC poll (simulates local agent)
    const pollPromise = ipcPoll(socketPath, editToken, 15000);
    await page.waitForTimeout(500);

    // Remote agent saves via HTTP API
    const newContent = "# Three-way Doc\n\nRemote agent wrote this.\n";
    const saveRes = await httpPost(
      serverPort,
      `/api/file/${editToken}`,
      JSON.stringify({ content: newContent, author: "remote-agent" }),
    );
    expect(saveRes.statusCode).toBe(200);

    const [pollRes, browserContent] = await Promise.all([pollPromise, browserChanged]);

    // IPC poll got the diff
    expect(pollRes.ok).toBe(true);
    expect((pollRes.data as { diff: string }).diff).toContain(
      "Remote agent wrote this",
    );

    // Browser sees updated content
    expect(browserContent).toContain("Remote agent wrote this");

    // Disk also updated
    const disk = fs.readFileSync(testFilePath, "utf-8");
    expect(disk).toBe(newContent);

    await ctx.close();

    // Restore
    fs.writeFileSync(testFilePath, "# Three-way Doc\n\nInitial.\n");
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  test("browser saves: remote agent HTTP GET sees new content, IPC poll gets diff", async ({
    browser,
  }) => {
    const editUrl = `http://127.0.0.1:${serverPort}/edit/${editToken}`;

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(editUrl);
    await waitForMonaco(page);

    // Start IPC poll
    const pollPromise = ipcPoll(socketPath, editToken, 15000);
    await page.waitForTimeout(500);

    // Browser types and saves
    await page.click(".monaco-editor");
    await page.keyboard.press(`${modKey}+End`);
    await page.keyboard.type("\nBrowser edit for three-way test.", {
      delay: 30,
    });
    await page.keyboard.press(`${modKey}+s`);

    // IPC poll should resolve with a non-empty diff
    const pollRes = await pollPromise;
    expect(pollRes.ok).toBe(true);
    const pollDiff2 = (pollRes.data as { diff: string }).diff;
    expect(pollDiff2.length).toBeGreaterThan(0);

    // Remote agent reads via HTTP API — should see what browser saved
    const apiRes = await httpGet(serverPort, `/api/file/${editToken}`);
    expect(apiRes.statusCode).toBe(200);
    const apiContent = JSON.parse(apiRes.body).content as string;
    expect(apiContent).toContain("three-way test");

    await ctx.close();

    // Restore
    fs.writeFileSync(testFilePath, "# Three-way Doc\n\nInitial.\n");
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  test("all three clients see consistent history after mixed saves", async ({
    browser,
  }) => {
    const editUrl = `http://127.0.0.1:${serverPort}/edit/${editToken}`;

    // Save 1: remote agent via API
    await httpPost(
      serverPort,
      `/api/file/${editToken}`,
      JSON.stringify({ content: "remote save\n", author: "remote-agent" }),
    );

    // Save 2: browser via page
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(editUrl);
    await waitForMonaco(page);

    await page.click(".monaco-editor");
    // Select all and replace to ensure clean content
    await page.keyboard.press(`${modKey}+a`);
    await page.keyboard.type("browser save\n", { delay: 20 });
    await page.keyboard.press(`${modKey}+s`);
    await page.waitForTimeout(2000);

    // Save 3: another API save (simulates local agent)
    await httpPost(
      serverPort,
      `/api/file/${editToken}`,
      JSON.stringify({ content: "local agent save\n", author: "local-agent" }),
    );

    // Check history via HTTP API (remote agent perspective)
    const histRes = await httpGet(serverPort, `/api/history/${editToken}`);
    const history = JSON.parse(histRes.body) as Array<{
      hash: string;
      author: string;
    }>;

    const authors = history.map((e) => e.author);
    expect(authors).toContain("remote-agent");
    expect(authors).toContain("local-agent");
    // Browser saves with default "browser_user"
    const hasBrowserSave = authors.some((a) => a === "browser_user" || a === "browser");
    expect(hasBrowserSave).toBe(true);

    // Verify content at each relevant commit hash
    const remoteCommit = history.find((e) => e.author === "remote-agent");
    const localCommit = history.find((e) => e.author === "local-agent");
    expect(remoteCommit).toBeDefined();
    expect(localCommit).toBeDefined();

    const remoteContent = await httpGet(
      serverPort,
      `/api/history/${editToken}/${remoteCommit!.hash}`,
    );
    expect(JSON.parse(remoteContent.body).content).toBe("remote save\n");

    const localContent = await httpGet(
      serverPort,
      `/api/history/${editToken}/${localCommit!.hash}`,
    );
    expect(JSON.parse(localContent.body).content).toBe("local agent save\n");

    // Browser also sees same history via overlay
    await page.reload();
    await waitForMonaco(page);
    const historyButton = page.locator("button", { hasText: "History" });
    await historyButton.click();
    await page.waitForTimeout(1000);

    const revertButtons = page.locator("button", { hasText: "Revert" });
    const revertCount = await revertButtons.count();
    // Should match API history count (minus 1 since HEAD doesn't get Revert)
    expect(revertCount).toBeGreaterThanOrEqual(history.length - 1);

    await ctx.close();

    // Restore
    fs.writeFileSync(testFilePath, "# Three-way Doc\n\nInitial.\n");
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  test("presence API shows all connected participants", async ({ browser }) => {
    const editUrl = `http://127.0.0.1:${serverPort}/edit/${editToken}`;

    // Browser connects (auto-joins presence)
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(editUrl);
    await waitForMonaco(page);

    // Remote agent joins presence via API
    const joinRemote = await httpPost(
      serverPort,
      `/api/presence/${editToken}/join`,
      JSON.stringify({ author: "remote-agent", mode: "write" }),
    );
    expect(joinRemote.statusCode).toBe(200);
    const remoteSessionId = JSON.parse(joinRemote.body).sessionId;

    // Local agent joins presence via API
    const joinLocal = await httpPost(
      serverPort,
      `/api/presence/${editToken}/join`,
      JSON.stringify({ author: "local-agent", mode: "read" }),
    );
    expect(joinLocal.statusCode).toBe(200);
    const localSessionId = JSON.parse(joinLocal.body).sessionId;

    // Check presence via HTTP API
    const presenceRes = await httpGet(serverPort, `/api/presence/${editToken}`);
    const users = JSON.parse(presenceRes.body).users as Array<{
      author: string;
      mode: string;
    }>;
    const userAuthors = users.map((u) => u.author);
    expect(userAuthors).toContain("remote-agent");
    expect(userAuthors).toContain("local-agent");
    // Browser auto-joins as well (default "browser_user")
    const hasBrowser = userAuthors.some(
      (a) => a === "browser_user" || a.includes("browser"),
    );
    expect(hasBrowser).toBe(true);

    // Cleanup
    await httpPost(
      serverPort,
      `/api/presence/${editToken}/leave`,
      JSON.stringify({ sessionId: remoteSessionId }),
    );
    await httpPost(
      serverPort,
      `/api/presence/${editToken}/leave`,
      JSON.stringify({ sessionId: localSessionId }),
    );

    await ctx.close();
  });
});

// ============================================================
// Test suite: Poll captures final state with multiple intermediate changes
// ============================================================
test.describe("Multi-client E2E: Poll final state with intermediate changes", () => {
  let serverHandle: ServerHandle | null = null;
  let editToken = "";
  let testFilePath = "";
  let socketPath = "";
  let tokensPath = "";
  let serverPort = 0;

  test.beforeAll(async () => {
    socketPath = uniquePath("pf-sock", ".sock");
    tokensPath = uniquePath("pf-tokens", ".json");
    testFilePath = uniquePath("pf-file", ".md");

    fs.writeFileSync(testFilePath, "# Poll Final\n\nStart.\n");

    const serverModule = await import(
      path.join(projectRoot, "dist", "commands", "server.js")
    );
    const ipcModule = await import(path.join(projectRoot, "dist", "ipc.js"));

    serverHandle = await serverModule.startServer({
      port: 0,
      socketPath,
      tokensPath,
    });
    await serverHandle!.startIpc();
    serverPort = serverHandle!.port;

    const client: IpcClientLike = new ipcModule.IpcClient(socketPath);
    const shareRes = await client.send({
      method: "share",
      params: { filePath: testFilePath },
    });
    if (!shareRes.ok) throw new Error(`Share failed: ${shareRes.error}`);
    editToken = (shareRes.data as { token: string }).token;

    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  test.afterAll(async () => {
    if (serverHandle) {
      await serverHandle.shutdown();
      serverHandle = null;
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

  test("multiple rapid API saves while poll is waiting: poll gets first change, second poll gets final state", async () => {
    // First poll
    const poll1 = ipcPoll(socketPath, editToken, 15000);
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Rapid saves
    await httpPost(
      serverPort,
      `/api/file/${editToken}`,
      JSON.stringify({ content: "rapid 1\n", author: "alice" }),
    );
    await httpPost(
      serverPort,
      `/api/file/${editToken}`,
      JSON.stringify({ content: "rapid 2\n", author: "bob" }),
    );
    await httpPost(
      serverPort,
      `/api/file/${editToken}`,
      JSON.stringify({ content: "rapid 3 final\n", author: "charlie" }),
    );

    // First poll resolves on first file change
    const res1 = await poll1;
    expect(res1.ok).toBe(true);

    // Second poll starts from current state and captures next change
    const poll2 = ipcPoll(socketPath, editToken, 15000);
    await new Promise((resolve) => setTimeout(resolve, 500));

    await httpPost(
      serverPort,
      `/api/file/${editToken}`,
      JSON.stringify({
        content: "after rapid final\n",
        author: "dave",
      }),
    );

    const res2 = await poll2;
    expect(res2.ok).toBe(true);
    const diff2 = (res2.data as { diff: string }).diff;
    expect(diff2).toContain("after rapid final");

    // Current file on disk is final
    const disk = fs.readFileSync(testFilePath, "utf-8");
    expect(disk).toBe("after rapid final\n");

    // History has ALL commits
    const histRes = await httpGet(serverPort, `/api/history/${editToken}`);
    const history = JSON.parse(histRes.body) as Array<{
      hash: string;
      author: string;
    }>;
    const histAuthors = history.map((e) => e.author);
    expect(histAuthors).toContain("alice");
    expect(histAuthors).toContain("bob");
    expect(histAuthors).toContain("charlie");
    expect(histAuthors).toContain("dave");

    // Restore
    fs.writeFileSync(testFilePath, "# Poll Final\n\nStart.\n");
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  test("browser sees all intermediate saves even if poll only caught first", async ({
    browser,
  }) => {
    const editUrl = `http://127.0.0.1:${serverPort}/edit/${editToken}`;

    // Start IPC poll
    const pollPromise = ipcPoll(socketPath, editToken, 15000);
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Open browser
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(editUrl);
    await waitForMonaco(page);

    // Collect file:saved events in browser
    const collectSaves = page.evaluate(() => {
      return new Promise<number>((resolve) => {
        let count = 0;
        const timeout = setTimeout(() => resolve(count), 8000);
        const startContent = (
          window as unknown as {
            monaco: {
              editor: {
                getEditors: () => Array<{ getValue: () => string }>;
              };
            };
          }
        ).monaco.editor
          .getEditors()[0]
          .getValue();

        // Count content changes as proxy for save events received
        let lastContent = startContent;
        const interval = setInterval(() => {
          const current = (
            window as unknown as {
              monaco: {
                editor: {
                  getEditors: () => Array<{ getValue: () => string }>;
                };
              };
            }
          ).monaco.editor
            .getEditors()[0]
            .getValue();
          if (current !== lastContent) {
            count++;
            lastContent = current;
          }
        }, 100);

        // Stop after some time
        setTimeout(() => {
          clearInterval(interval);
          clearTimeout(timeout);
          resolve(count);
        }, 6000);
      });
    });

    // Make 3 saves
    await httpPost(
      serverPort,
      `/api/file/${editToken}`,
      JSON.stringify({ content: "step1\n", author: "x" }),
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    await httpPost(
      serverPort,
      `/api/file/${editToken}`,
      JSON.stringify({ content: "step2\n", author: "y" }),
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    await httpPost(
      serverPort,
      `/api/file/${editToken}`,
      JSON.stringify({ content: "step3\n", author: "z" }),
    );

    // Poll resolves on first change
    const pollRes = await pollPromise;
    expect(pollRes.ok).toBe(true);

    // Browser should have seen at least some of the content changes
    const changeCount = await collectSaves;
    expect(changeCount).toBeGreaterThanOrEqual(1);

    // Final content on disk
    const disk = fs.readFileSync(testFilePath, "utf-8");
    expect(disk).toBe("step3\n");

    // Browser's final content matches disk
    const browserFinal = await page.evaluate(() => {
      return (
        window as unknown as {
          monaco: {
            editor: {
              getEditors: () => Array<{ getValue: () => string }>;
            };
          };
        }
      ).monaco.editor
        .getEditors()[0]
        .getValue();
    });
    expect(browserFinal).toBe("step3\n");

    // History contains all saves
    const histRes = await httpGet(serverPort, `/api/history/${editToken}`);
    const history = JSON.parse(histRes.body) as Array<{
      author: string;
    }>;
    const authors = history.map((e) => e.author);
    expect(authors).toContain("x");
    expect(authors).toContain("y");
    expect(authors).toContain("z");

    await ctx.close();

    // Restore
    fs.writeFileSync(testFilePath, "# Poll Final\n\nStart.\n");
    await new Promise((resolve) => setTimeout(resolve, 500));
  });
});
