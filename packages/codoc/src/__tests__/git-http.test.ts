import fs from "node:fs";
import http from "node:http";
import type net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GitOps } from "../git-ops.js";
import { createHttpHandler } from "../http.js";
import { TokenStore } from "../token-store.js";

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
          resolve({ statusCode: res.statusCode as number, body });
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
          resolve({ statusCode: res.statusCode as number, body });
        });
      },
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

describe("Git HTTP routes", () => {
  let tokenStore: TokenStore;
  let server: http.Server;
  let port: number;
  let tokensPath: string;
  let testFilePath: string;
  let gitOpsMap: Map<string, GitOps>;
  let tempBase: string;

  beforeAll(async () => {
    tempBase = fs.mkdtempSync(path.join(os.tmpdir(), "codoc-git-http-test-"));
    tokensPath = path.join(tempBase, "tokens.json");
    tokenStore = new TokenStore(tokensPath);
    gitOpsMap = new Map();

    testFilePath = path.join(tempBase, "test-doc.md");
    fs.writeFileSync(testFilePath, "# Hello World\n\nThis is test content.\n");

    const reg = tokenStore.register(testFilePath, false);
    const token = reg.token;

    const gitWorkTree = path.join(tempBase, "git-work", token);
    const gitDir = path.join(gitWorkTree, ".git");
    fs.mkdirSync(gitWorkTree, { recursive: true });
    const gitOps = new GitOps(gitDir, gitWorkTree);
    await gitOps.init();

    const gitFileName = "doc.md";
    fs.copyFileSync(testFilePath, path.join(gitWorkTree, gitFileName));
    await gitOps.commit(gitFileName, "initial", "alice");

    fs.writeFileSync(testFilePath, "# Hello World\n\nUpdated content.\n");
    fs.copyFileSync(testFilePath, path.join(gitWorkTree, gitFileName));
    await gitOps.commit(gitFileName, "second save", "bob");

    gitOpsMap.set(token, gitOps);

    const handler = createHttpHandler(
      tokenStore,
      undefined,
      gitOpsMap,
      undefined,
      undefined,
    );
    server = http.createServer(handler);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        resolve();
      });
    });
    const addr = server.address() as net.AddressInfo;
    port = addr.port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
    fs.rmSync(tempBase, { recursive: true, force: true });
  });

  it("GET /api/history/:token should return version list", async () => {
    const token = tokenStore.list()[0].token;
    const res = await httpGet(port, `/api/history/${token}`);
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(2);
    expect(data[0].hash).toMatch(/^[0-9a-f]{40}$/);
    expect(data[0].author).toBeTruthy();
    expect(data[0].date).toBeTruthy();
  });

  it("GET /api/history/:token should return 404 for unknown token", async () => {
    const res = await httpGet(port, "/api/history/nonexistent");
    expect(res.statusCode).toBe(404);
  });

  it("GET /api/history/:token/:hash should return file content at that commit", async () => {
    const token = tokenStore.list()[0].token;
    const histRes = await httpGet(port, `/api/history/${token}`);
    const versions = JSON.parse(histRes.body);
    const oldHash = versions[1].hash;

    const res = await httpGet(port, `/api/history/${token}/${oldHash}`);
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.content).toContain("# Hello World");
    expect(data.content).toContain("test content");
  });

  it("GET /api/blame/:token should return blame data", async () => {
    const token = tokenStore.list()[0].token;
    const res = await httpGet(port, `/api/blame/${token}`);
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(data[0]).toHaveProperty("lineStart");
    expect(data[0]).toHaveProperty("lineEnd");
    expect(data[0]).toHaveProperty("author");
    expect(data[0]).toHaveProperty("hash");
    expect(data[0]).toHaveProperty("isAgent");
  });

  it("GET /api/blame/:token should return 404 for unknown token", async () => {
    const res = await httpGet(port, "/api/blame/nonexistent");
    expect(res.statusCode).toBe(404);
  });

  it("POST /api/file/:token with baseContent should return 409 on conflict", async () => {
    const token = tokenStore.list()[0].token;
    const res = await httpPost(
      port,
      `/api/file/${token}`,
      JSON.stringify({
        content: "conflicting content\n",
        baseContent: "wrong base\n",
        author: "alice",
      }),
    );
    expect(res.statusCode).toBe(409);
    const data = JSON.parse(res.body);
    expect(data.conflict).toBe(true);
  });

  it("POST /api/file/:token should auto-commit after save", async () => {
    const token = tokenStore.list()[0].token;
    const newContent = "# Hello World\n\nThird version content.\n";
    const res = await httpPost(
      port,
      `/api/file/${token}`,
      JSON.stringify({
        content: newContent,
        author: "charlie",
      }),
    );
    expect(res.statusCode).toBe(200);

    const histRes = await httpGet(port, `/api/history/${token}`);
    const versions = JSON.parse(histRes.body);
    expect(versions.length).toBe(3);
    expect(versions[0].author).toBe("charlie");
  });
});
