import fs from "node:fs";
import http from "node:http";
import type net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GitOps } from "../git-ops.js";
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

describe("Step 8: Sharing (readonly token, share dialog, copy-as-markdown)", () => {
  let tokenStore: TokenStore;
  let server: http.Server;
  let port: number;
  let tokensPath: string;
  let testFilePath: string;
  let gitOpsMap: Map<string, GitOps>;
  let tempBase: string;

  beforeAll(async () => {
    tempBase = fs.mkdtempSync(path.join(os.tmpdir(), "codoc-step8-test-"));
    tokensPath = path.join(tempBase, "tokens.json");
    tokenStore = new TokenStore(tokensPath);
    gitOpsMap = new Map();

    testFilePath = path.join(tempBase, "test-doc.md");
    fs.writeFileSync(testFilePath, "# Hello World\n\nSome content.\n");

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

  describe("TokenStore.register with readonly flag", () => {
    it("should generate both writable and readonly tokens when readonly is true", () => {
      const result = tokenStore.register(testFilePath, true);
      expect(result.token).toBeDefined();
      expect(result.readonlyToken).toBeDefined();
      expect(result.token).not.toBe(result.readonlyToken);
    });

    it("should resolve writable token as readonly=false", () => {
      const result = tokenStore.register(testFilePath, true);
      const entry = tokenStore.resolve(result.token);
      expect(entry).not.toBeNull();
      expect(entry?.readonly).toBe(false);
    });

    it("should resolve readonly token as readonly=true", () => {
      const result = tokenStore.register(testFilePath, true);
      const entry = tokenStore.resolve(result.readonlyToken as string);
      expect(entry).not.toBeNull();
      expect(entry?.readonly).toBe(true);
    });

    it("should return same tokens for same file on repeated register with readonly", () => {
      const result1 = tokenStore.register(testFilePath, true);
      const result2 = tokenStore.register(testFilePath, true);
      expect(result1.token).toBe(result2.token);
      expect(result1.readonlyToken).toBe(result2.readonlyToken);
    });

    it("should not generate readonly token when readonly is false", () => {
      const otherFile = path.join(tempBase, "other.md");
      fs.writeFileSync(otherFile, "other content");
      const result = tokenStore.register(otherFile, false);
      expect(result.token).toBeDefined();
      expect(result.readonlyToken).toBeUndefined();
    });
  });

  describe("GET /api/file/:readonlyToken", () => {
    it("should return readonly=true for readonly token", async () => {
      const result = tokenStore.register(testFilePath, true);
      const res = await httpGet(port, `/api/file/${result.readonlyToken}`);
      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.readonly).toBe(true);
      expect(data.content).toBeDefined();
    });

    it("should return readonly=false for writable token", async () => {
      const result = tokenStore.register(testFilePath, true);
      const res = await httpGet(port, `/api/file/${result.token}`);
      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.readonly).toBe(false);
    });
  });

  describe("POST /api/file/:readonlyToken", () => {
    it("should return 403 for readonly token", async () => {
      const result = tokenStore.register(testFilePath, true);
      const res = await httpPost(
        port,
        `/api/file/${result.readonlyToken}`,
        JSON.stringify({ content: "should not save" }),
      );
      expect(res.statusCode).toBe(403);
      const data = JSON.parse(res.body);
      expect(data.error).toBeDefined();
    });

    it("should allow POST for writable token", async () => {
      const result = tokenStore.register(testFilePath, true);
      const res = await httpPost(
        port,
        `/api/file/${result.token}`,
        JSON.stringify({ content: "# Hello World\n\nUpdated.\n" }),
      );
      expect(res.statusCode).toBe(200);
    });
  });

  describe("GET /view/:readonlyToken", () => {
    it("should serve frontend SPA for readonly token", async () => {
      const result = tokenStore.register(testFilePath, true);
      const res = await httpGet(port, `/view/${result.readonlyToken}`);
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain("codoc");
    });

    it("should return 404 for unknown token in /view/ route", async () => {
      const res = await httpGet(port, "/view/nonexistent");
      expect(res.statusCode).toBe(404);
    });
  });

  describe("Copy-as-markdown: strip HTML comments", () => {
    it("should strip all HTML comments from content", async () => {
      const { stripHtmlComments } = await import("../copy-markdown.js");
      const input = `# Title

Some text.
<!--
@alice[tid:t1][cid:c1]: hello
[REPLY_TEMPLATE] @agent[tid:t1][cid:NEW_ID][reply:c1]: reply here
-->
More text.
<!--
@bob[cid:c2]: another comment
-->
Final line.`;

      const result = stripHtmlComments(input);
      expect(result).not.toContain("<!--");
      expect(result).not.toContain("-->");
      expect(result).toContain("# Title");
      expect(result).toContain("Some text.");
      expect(result).toContain("More text.");
      expect(result).toContain("Final line.");
    });

    it("should handle content with no comments", async () => {
      const { stripHtmlComments } = await import("../copy-markdown.js");
      const input = "# Title\n\nJust text.\n";
      const result = stripHtmlComments(input);
      expect(result).toBe("# Title\n\nJust text.\n");
    });

    it("should clean up excess blank lines after stripping", async () => {
      const { stripHtmlComments } = await import("../copy-markdown.js");
      const input = "Line 1\n<!--\ncomment\n-->\n<!--\ncomment2\n-->\nLine 2\n";
      const result = stripHtmlComments(input);
      expect(result).not.toMatch(/\n{3,}/);
      expect(result).toContain("Line 1");
      expect(result).toContain("Line 2");
    });
  });

  describe("codoc share --readonly", () => {
    it("should pass readonly param via IPC", async () => {
      const result = tokenStore.register(testFilePath, true);
      expect(result.token).toBeDefined();
      expect(result.readonlyToken).toBeDefined();
    });
  });
});
