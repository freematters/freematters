import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { cleanupTempDir, createTempDir } from "../../__tests__/fixtures.js";
import { gateway } from "../gateway.js";

let tmp: string;

beforeAll(() => {
  tmp = createTempDir("cmd-gateway");
});

afterAll(() => {
  cleanupTempDir(tmp);
});

describe("gateway command", () => {
  test("starts server and returns shutdown function", async () => {
    const shutdown = await gateway({
      port: 19_001,
      host: "127.0.0.1",
      apiKey: "test-key-1",
      storeRoot: tmp,
    });

    expect(typeof shutdown).toBe("function");

    // Verify server is actually listening by hitting health endpoint
    const res = await fetch("http://127.0.0.1:19001/api/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");

    await shutdown();
  });

  test("auto-generates API key when not provided", async () => {
    // Capture stderr output
    const writes: string[] = [];
    const origWrite = process.stderr.write;
    process.stderr.write = ((chunk: string) => {
      writes.push(chunk);
      return true;
    }) as typeof process.stderr.write;

    const shutdown = await gateway({
      port: 19_002,
      host: "127.0.0.1",
      storeRoot: tmp,
    });

    process.stderr.write = origWrite;

    // Should have printed a generated API key
    const keyLine = writes.find((w) => w.includes("Generated API key:"));
    expect(keyLine).toBeDefined();

    // Extract the key and verify it works
    const key = keyLine?.replace("Generated API key: ", "").trim();
    expect(key).toBeTruthy();
    expect(key?.length).toBeGreaterThan(0);

    // Verify auth works with the generated key
    const authedRes = await fetch("http://127.0.0.1:19002/api/runs", {
      headers: { "x-api-key": key as string },
    });
    expect(authedRes.status).toBe(200);

    // Verify auth fails without key
    const unauthRes = await fetch("http://127.0.0.1:19002/api/runs");
    expect(unauthRes.status).toBe(401);

    await shutdown();
  });

  test("uses provided API key", async () => {
    const shutdown = await gateway({
      port: 19_003,
      host: "127.0.0.1",
      apiKey: "my-custom-key",
      storeRoot: tmp,
    });

    // Auth with the provided key
    const res = await fetch("http://127.0.0.1:19003/api/runs", {
      headers: { "x-api-key": "my-custom-key" },
    });
    expect(res.status).toBe(200);

    // Wrong key should fail
    const badRes = await fetch("http://127.0.0.1:19003/api/runs", {
      headers: { "x-api-key": "wrong-key" },
    });
    expect(badRes.status).toBe(403);

    await shutdown();
  });

  test("server stops cleanly on shutdown", async () => {
    const shutdown = await gateway({
      port: 19_004,
      host: "127.0.0.1",
      apiKey: "key",
      storeRoot: tmp,
    });

    await shutdown();

    // Server should no longer be reachable
    await expect(
      fetch("http://127.0.0.1:19004/api/health").then((r) => r.json()),
    ).rejects.toThrow();
  });
});
