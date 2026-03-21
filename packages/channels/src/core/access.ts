import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type { AccessConfig, IsAllowedContext } from "./types.js";

export function defaultAccessConfig(): AccessConfig {
  return {
    dmPolicy: "pairing",
    allowFrom: [],
    groups: {},
    pending: {},
    mentionPatterns: [],
  };
}

export async function readAccess(channelDir: string): Promise<AccessConfig> {
  const filePath = path.join(channelDir, "access.json");
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as AccessConfig;
  } catch {
    return defaultAccessConfig();
  }
}

export async function writeAccess(
  channelDir: string,
  config: AccessConfig,
): Promise<void> {
  const filePath = path.join(channelDir, "access.json");
  await fs.mkdir(channelDir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(config, null, 2) + "\n");
}

export function isAllowed(
  config: AccessConfig,
  senderId: string,
  context?: IsAllowedContext,
): boolean {
  if (config.dmPolicy === "disabled") {
    return false;
  }

  if (context?.groupId) {
    const group = config.groups[context.groupId];
    if (!group) return false;
    if (group.requireMention && !context.isMention) return false;
    if (group.allowFrom.length > 0) {
      return group.allowFrom.includes(senderId);
    }
    return true;
  }

  if (config.dmPolicy === "pairing") {
    return true;
  }

  return config.allowFrom.includes(senderId);
}

export function addPending(
  config: AccessConfig,
  senderId: string,
  chatId: string,
): string {
  const code = crypto.randomBytes(3).toString("hex");
  config.pending[code] = {
    senderId,
    chatId,
    createdAt: Date.now(),
    expiresAt: Date.now() + 10 * 60 * 1000,
  };
  return code;
}
