export interface ChannelServerConfig {
  name: string;
  version: string;
  instructions: string;
  twoWay?: boolean;
}

export interface ChannelServer {
  server: import("@modelcontextprotocol/sdk/server/index.js").Server;
  notify: (content: string, meta?: Record<string, string>) => Promise<void>;
  connect: () => Promise<void>;
}

export interface AccessConfig {
  dmPolicy: "pairing" | "allowlist" | "disabled";
  allowFrom: string[];
  groups: Record<
    string,
    { requireMention: boolean; allowFrom: string[] }
  >;
  pending: Record<
    string,
    {
      senderId: string;
      chatId: string;
      createdAt: number;
      expiresAt: number;
    }
  >;
  mentionPatterns: string[];
}

export interface IsAllowedContext {
  groupId?: string;
  isMention?: boolean;
}

export interface ChannelConfig {
  name: string;
  version: string;
  description: string;
  keywords: string[];
  twoWay: boolean;
  tokens: Array<{
    envVar: string;
    hint: string;
  }>;
  skills: {
    configure: "template" | "override";
    access: boolean;
  };
  pollIntervalMs?: number;
}
