import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function tmpPath(prefix: string): string {
  return path.join(os.tmpdir(), `codoc-step11-${prefix}-${process.pid}-${Date.now()}`);
}

describe("Config loader", () => {
  let configPath: string;

  beforeEach(() => {
    configPath = `${tmpPath("config")}.json`;
  });

  afterEach(() => {
    try {
      fs.unlinkSync(configPath);
    } catch {}
  });

  it("should load valid config with tunnel cloudflare", async () => {
    const { loadConfig } = await import("../config.js");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        tunnel: "cloudflare",
        port: 4000,
        defaultName: "testuser",
      }),
    );
    const config = loadConfig(configPath);
    expect(config.tunnel).toBe("cloudflare");
    expect(config.port).toBe(4000);
    expect(config.defaultName).toBe("testuser");
  });

  it("should load valid config with tunnel null", async () => {
    const { loadConfig } = await import("../config.js");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        tunnel: null,
        port: 3000,
        defaultName: "browser_user",
      }),
    );
    const config = loadConfig(configPath);
    expect(config.tunnel).toBeNull();
    expect(config.port).toBe(3000);
  });

  it("should load config with optional callbackScript", async () => {
    const { loadConfig } = await import("../config.js");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        tunnel: null,
        port: 3000,
        defaultName: "browser_user",
        callbackScript: "echo $CODOC_FILE",
      }),
    );
    const config = loadConfig(configPath);
    expect(config.callbackScript).toBe("echo $CODOC_FILE");
  });

  it("should throw when config file is missing", async () => {
    const { loadConfig } = await import("../config.js");
    const missingPath = path.join(
      os.tmpdir(),
      `codoc-autocreate-${process.pid}-${Date.now()}`,
      "config.json",
    );
    expect(() => loadConfig(missingPath)).toThrow("Config not found");
  });

  it("should throw when config is invalid JSON", async () => {
    const { loadConfig } = await import("../config.js");
    fs.writeFileSync(configPath, "not json{{{");
    expect(() => loadConfig(configPath)).toThrow();
  });

  it("should throw when tunnel field is missing", async () => {
    const { loadConfig } = await import("../config.js");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        port: 3000,
        defaultName: "browser_user",
      }),
    );
    expect(() => loadConfig(configPath)).toThrow("tunnel");
  });

  it("should throw when tunnel has invalid value", async () => {
    const { loadConfig } = await import("../config.js");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        tunnel: "wireguard",
        port: 3000,
        defaultName: "browser_user",
      }),
    );
    expect(() => loadConfig(configPath)).toThrow("tunnel");
  });

  it("should throw when port is missing", async () => {
    const { loadConfig } = await import("../config.js");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        tunnel: null,
        defaultName: "browser_user",
      }),
    );
    expect(() => loadConfig(configPath)).toThrow("port");
  });

  it("should throw when port is not a number", async () => {
    const { loadConfig } = await import("../config.js");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        tunnel: null,
        port: "abc",
        defaultName: "browser_user",
      }),
    );
    expect(() => loadConfig(configPath)).toThrow("port");
  });

  it("should throw when defaultName is missing", async () => {
    const { loadConfig } = await import("../config.js");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        tunnel: null,
        port: 3000,
      }),
    );
    expect(() => loadConfig(configPath)).toThrow("defaultName");
  });
});

describe("ScriptCallback", () => {
  it("should execute shell command with correct env vars", async () => {
    const { ScriptCallback } = await import("../callback.js");
    const outputFile = `${tmpPath("cb-output")}.txt`;
    const script = `echo "$CODOC_FILE|$CODOC_EVENT|$CODOC_TOKEN|$CODOC_URL" > ${outputFile}`;
    const callback = new ScriptCallback(script);

    await new Promise<void>((resolve) => {
      callback.execute(
        "/tmp/test.md",
        "save",
        "tok123",
        "http://localhost:3000/edit/tok123",
      );
      setTimeout(resolve, 500);
    });

    const output = fs.readFileSync(outputFile, "utf-8").trim();
    expect(output).toBe("/tmp/test.md|save|tok123|http://localhost:3000/edit/tok123");
    try {
      fs.unlinkSync(outputFile);
    } catch {}
  });

  it("should handle missing/failing script gracefully without throwing", async () => {
    const { ScriptCallback } = await import("../callback.js");
    const callback = new ScriptCallback("/nonexistent/script.sh");

    expect(() => {
      callback.execute(
        "/tmp/test.md",
        "save",
        "tok123",
        "http://localhost:3000/edit/tok123",
      );
    }).not.toThrow();
  });

  it("should pass external_change as event", async () => {
    const { ScriptCallback } = await import("../callback.js");
    const outputFile = `${tmpPath("cb-event")}.txt`;
    const script = `echo "$CODOC_EVENT" > ${outputFile}`;
    const callback = new ScriptCallback(script);

    await new Promise<void>((resolve) => {
      callback.execute(
        "/tmp/test.md",
        "external_change",
        "tok123",
        "http://localhost:3000/edit/tok123",
      );
      setTimeout(resolve, 500);
    });

    const output = fs.readFileSync(outputFile, "utf-8").trim();
    expect(output).toBe("external_change");
    try {
      fs.unlinkSync(outputFile);
    } catch {}
  });
});

describe("Tunnel URL parsing", () => {
  it("should parse cloudflared tunnel URL from stdout", async () => {
    const { parseTunnelUrl } = await import("../config.js");
    const output = `2024-01-01T00:00:00Z INF +--------------------------------------------------------------------------------------------+
2024-01-01T00:00:00Z INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |
2024-01-01T00:00:00Z INF |  https://abc-123-def.trycloudflare.com                                                    |
2024-01-01T00:00:00Z INF +--------------------------------------------------------------------------------------------+`;
    const url = parseTunnelUrl(output);
    expect(url).toBe("https://abc-123-def.trycloudflare.com");
  });

  it("should return null when no tunnel URL found", async () => {
    const { parseTunnelUrl } = await import("../config.js");
    const output = "some random output\nno url here";
    const url = parseTunnelUrl(output);
    expect(url).toBeNull();
  });

  it("should parse URL with longer subdomain", async () => {
    const { parseTunnelUrl } = await import("../config.js");
    const output = "https://my-long-tunnel-name-abcdef1234.trycloudflare.com";
    const url = parseTunnelUrl(output);
    expect(url).toBe("https://my-long-tunnel-name-abcdef1234.trycloudflare.com");
  });
});

describe("Tunnel spawn command construction", () => {
  it("should construct correct cloudflared spawn args", async () => {
    const { getTunnelSpawnArgs } = await import("../config.js");
    const args = getTunnelSpawnArgs(4000, "/usr/bin/cloudflared");
    expect(args.command).toBe("/usr/bin/cloudflared");
    expect(args.args).toEqual(["tunnel", "--url", "http://localhost:4000"]);
  });
});
