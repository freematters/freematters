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

describe("Step 7: Revert and Diff HTTP routes", () => {
  let tokenStore: TokenStore;
  let server: http.Server;
  let port: number;
  let tokensPath: string;
  let testFilePath: string;
  let gitOpsMap: Map<string, GitOps>;
  let tempBase: string;
  let token: string;
  let firstHash: string;
  let secondHash: string;

  beforeAll(async () => {
    tempBase = fs.mkdtempSync(path.join(os.tmpdir(), "codoc-step7-test-"));
    tokensPath = path.join(tempBase, "tokens.json");
    tokenStore = new TokenStore(tokensPath);
    gitOpsMap = new Map();

    testFilePath = path.join(tempBase, "test-doc.md");
    fs.writeFileSync(testFilePath, "# Hello World\n\nFirst version content.\n");

    const reg = tokenStore.register(testFilePath, false);
    token = reg.token;

    const gitWorkTree = path.join(tempBase, "git-work", token);
    const gitDir = path.join(gitWorkTree, ".git");
    fs.mkdirSync(gitWorkTree, { recursive: true });
    const gitOps = new GitOps(gitDir, gitWorkTree);
    await gitOps.init();

    const gitFileName = "doc.md";
    fs.copyFileSync(testFilePath, path.join(gitWorkTree, gitFileName));
    firstHash = await gitOps.commit(gitFileName, "initial", "alice");

    fs.writeFileSync(testFilePath, "# Hello World\n\nSecond version content.\n");
    fs.copyFileSync(testFilePath, path.join(gitWorkTree, gitFileName));
    secondHash = await gitOps.commit(gitFileName, "second save", "bob");

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

  describe("POST /api/revert/:token/:hash", () => {
    it("should revert file content to the specified commit version", async () => {
      const res = await httpPost(port, `/api/revert/${token}/${firstHash}`, "{}");
      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.ok).toBe(true);
      expect(data.content).toContain("First version content.");
    });

    it("should create a new commit after reverting", async () => {
      const histRes = await httpGet(port, `/api/history/${token}`);
      const versions = JSON.parse(histRes.body);
      expect(versions.length).toBeGreaterThanOrEqual(3);
    });

    it("should update the actual file on disk after reverting", async () => {
      const fileContent = fs.readFileSync(testFilePath, "utf-8");
      expect(fileContent).toContain("First version content.");
    });

    it("should return 404 for unknown token", async () => {
      const res = await httpPost(port, `/api/revert/nonexistent/${firstHash}`, "{}");
      expect(res.statusCode).toBe(404);
    });

    it("should return 404 when no git history exists", async () => {
      const noGitFile = path.join(tempBase, "nogit.md");
      fs.writeFileSync(noGitFile, "no git");
      const reg = tokenStore.register(noGitFile, false);
      const res = await httpPost(port, `/api/revert/${reg.token}/${firstHash}`, "{}");
      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /api/diff/:token", () => {
    it("should return diff since last save", async () => {
      // First, save a known content
      await httpPost(
        port,
        `/api/file/${token}`,
        JSON.stringify({
          content: "# Hello World\n\nDiff base content.\n",
          author: "alice",
        }),
      );

      // Now modify the file externally
      fs.writeFileSync(testFilePath, "# Hello World\n\nDiff modified content.\n");

      const res = await httpGet(port, `/api/diff/${token}`);
      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.diff).toBeDefined();
      expect(typeof data.diff).toBe("string");
    });

    it("should return empty diff when file has not changed since last save", async () => {
      // Save and read back to ensure file matches last save
      const currentContent = fs.readFileSync(testFilePath, "utf-8");
      await httpPost(
        port,
        `/api/file/${token}`,
        JSON.stringify({
          content: currentContent,
          author: "alice",
        }),
      );

      const res = await httpGet(port, `/api/diff/${token}`);
      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.diff).toBe("");
    });

    it("should return 404 for unknown token", async () => {
      const res = await httpGet(port, "/api/diff/nonexistent");
      expect(res.statusCode).toBe(404);
    });

    it("should return 404 when no git history exists", async () => {
      const noGitFile2 = path.join(tempBase, "nogit2.md");
      fs.writeFileSync(noGitFile2, "no git 2");
      const reg = tokenStore.register(noGitFile2, false);
      const res = await httpGet(port, `/api/diff/${reg.token}`);
      expect(res.statusCode).toBe(404);
    });
  });
});
