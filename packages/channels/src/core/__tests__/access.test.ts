import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  addPending,
  defaultAccessConfig,
  isAllowed,
  readAccess,
  writeAccess,
} from "../access.js";
import type { AccessConfig } from "../types.js";

describe("defaultAccessConfig", () => {
  it("returns a valid default config", () => {
    const config = defaultAccessConfig();
    expect(config.dmPolicy).toBe("pairing");
    expect(config.allowFrom).toEqual([]);
    expect(config.groups).toEqual({});
    expect(config.pending).toEqual({});
    expect(config.mentionPatterns).toEqual([]);
  });
});

describe("isAllowed", () => {
  it("returns true when senderId is in allowFrom", () => {
    const config: AccessConfig = {
      ...defaultAccessConfig(),
      dmPolicy: "allowlist",
      allowFrom: ["user1", "user2"],
    };
    expect(isAllowed(config, "user1")).toBe(true);
  });

  it("returns false when senderId is not in allowFrom", () => {
    const config: AccessConfig = {
      ...defaultAccessConfig(),
      dmPolicy: "allowlist",
      allowFrom: ["user1"],
    };
    expect(isAllowed(config, "user3")).toBe(false);
  });

  it("returns false when dmPolicy is disabled", () => {
    const config: AccessConfig = {
      ...defaultAccessConfig(),
      dmPolicy: "disabled",
      allowFrom: ["user1"],
    };
    expect(isAllowed(config, "user1")).toBe(false);
  });

  it("allows any sender when dmPolicy is pairing", () => {
    const config: AccessConfig = {
      ...defaultAccessConfig(),
      dmPolicy: "pairing",
    };
    expect(isAllowed(config, "anyone")).toBe(true);
  });

  it("checks group allowFrom when groupId is provided", () => {
    const config: AccessConfig = {
      ...defaultAccessConfig(),
      dmPolicy: "allowlist",
      allowFrom: [],
      groups: {
        group1: { requireMention: false, allowFrom: ["user1"] },
      },
    };
    expect(isAllowed(config, "user1", { groupId: "group1" })).toBe(true);
    expect(isAllowed(config, "user2", { groupId: "group1" })).toBe(false);
  });

  it("requires mention when group has requireMention true", () => {
    const config: AccessConfig = {
      ...defaultAccessConfig(),
      dmPolicy: "allowlist",
      groups: {
        group1: { requireMention: true, allowFrom: ["user1"] },
      },
    };
    expect(
      isAllowed(config, "user1", { groupId: "group1", isMention: false }),
    ).toBe(false);
    expect(
      isAllowed(config, "user1", { groupId: "group1", isMention: true }),
    ).toBe(true);
  });
});

describe("addPending", () => {
  it("adds a pending entry and returns a 6-char code", () => {
    const config = defaultAccessConfig();
    const code = addPending(config, "sender1", "chat1");
    expect(code).toHaveLength(6);
    expect(config.pending[code]).toEqual({
      senderId: "sender1",
      chatId: "chat1",
      createdAt: expect.any(Number),
      expiresAt: expect.any(Number),
    });
  });

  it("generates unique codes", () => {
    const config = defaultAccessConfig();
    const code1 = addPending(config, "s1", "c1");
    const code2 = addPending(config, "s2", "c2");
    expect(code1).not.toBe(code2);
  });
});

describe("readAccess / writeAccess", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns defaults when file does not exist", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "access-test-"));
    const config = await readAccess(tmpDir);
    expect(config.dmPolicy).toBe("pairing");
    expect(config.allowFrom).toEqual([]);
  });

  it("round-trips a config through write and read", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "access-test-"));
    const config: AccessConfig = {
      dmPolicy: "allowlist",
      allowFrom: ["user1"],
      groups: {},
      pending: {},
      mentionPatterns: ["@bot"],
    };
    await writeAccess(tmpDir, config);
    const loaded = await readAccess(tmpDir);
    expect(loaded).toEqual(config);
  });

  it("writes pretty-printed JSON", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "access-test-"));
    const config = defaultAccessConfig();
    await writeAccess(tmpDir, config);
    const raw = await fs.readFile(
      path.join(tmpDir, "access.json"),
      "utf-8",
    );
    expect(raw).toContain("\n");
    expect(raw).toContain("  ");
  });
});
