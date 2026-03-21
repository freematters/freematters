import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { SocketModeClient } from "@slack/socket-mode";
import { WebClient } from "@slack/web-api";
import { addPending, isAllowed, readAccess, writeAccess } from "../core/access.js";
import { createChannelServer } from "../core/channel-server.js";
import { registerReplyTool } from "../core/reply-tool.js";

const CHANNEL_DIR = path.join(os.homedir(), ".claude", "channels", "slack");

export async function loadEnv(): Promise<Record<string, string>> {
  const envPath = path.join(CHANNEL_DIR, ".env");
  try {
    const raw = await fs.readFile(envPath, "utf-8");
    const env: Record<string, string> = {};
    for (const line of raw.split("\n")) {
      const match = line.match(/^([A-Z_]+)=(.*)$/);
      if (match) env[match[1]] = match[2];
    }
    return env;
  } catch {
    return {};
  }
}

export async function main(): Promise<void> {
  const env = await loadEnv();
  const botToken = env.SLACK_BOT_TOKEN || process.env.SLACK_BOT_TOKEN;
  const appToken = env.SLACK_APP_TOKEN || process.env.SLACK_APP_TOKEN;

  if (!botToken || !appToken) {
    console.error(
      "Missing SLACK_BOT_TOKEN or SLACK_APP_TOKEN. Run /slack:configure to set up.",
    );
    process.exit(1);
  }

  const { server, notify, connect } = createChannelServer({
    name: "slack",
    version: "0.0.1",
    instructions: [
      'Messages from Slack arrive as <channel source="slack" sender_id="..." chat_id="..." sender_name="...">.',
      "Reply with the reply tool, passing the chat_id from the tag.",
      "Keep replies concise — Slack has a 4000-char message limit.",
    ].join(" "),
    twoWay: true,
  });

  const web = new WebClient(botToken);
  registerReplyTool(server, async (chatId: string, text: string) => {
    await web.chat.postMessage({ channel: chatId, text });
  });

  await connect();

  const socketMode = new SocketModeClient({ appToken });

  socketMode.on("message", async ({ event, ack }) => {
    await ack();
    if (!event || event.subtype === "bot_message") return;

    const senderId = event.user;
    const chatId = event.channel;
    if (!senderId || !chatId) return;

    const access = await readAccess(CHANNEL_DIR);

    if (access.dmPolicy === "pairing" && !access.allowFrom.includes(senderId)) {
      const code = addPending(access, senderId, chatId);
      await writeAccess(CHANNEL_DIR, access);
      await web.chat.postMessage({
        channel: chatId,
        text: `Pairing code: \`${code}\`\nAsk the Claude Code user to run: \`/slack:access pair ${code}\``,
      });
      return;
    }

    if (
      !isAllowed(access, senderId, {
        groupId:
          event.channel_type === "group" || event.channel_type === "channel"
            ? chatId
            : undefined,
        isMention:
          typeof event.text === "string" &&
          access.mentionPatterns.some((p) => event.text.includes(p)),
      })
    ) {
      return;
    }

    await notify(event.text || "", {
      sender_id: senderId,
      chat_id: chatId,
      sender_name: event.user || senderId,
    });
  });

  const shutdown = () => {
    socketMode.disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  const approvedDir = path.join(CHANNEL_DIR, "approved");
  setInterval(async () => {
    try {
      const files = await fs.readdir(approvedDir);
      for (const senderId of files) {
        const chatId = await fs.readFile(path.join(approvedDir, senderId), "utf-8");
        await web.chat.postMessage({
          channel: chatId.trim(),
          text: "You're paired! Your messages will now reach Claude.",
        });
        await fs.rm(path.join(approvedDir, senderId));
      }
    } catch {
      // approved dir may not exist yet
    }
  }, 3000);

  await socketMode.start();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
