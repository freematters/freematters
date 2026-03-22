import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Client } from "@notionhq/client";
import { createChannelServer } from "../core/channel-server.js";

const CHANNEL_DIR = path.join(os.homedir(), ".claude", "channels", "notion");
const STATE_FILE = path.join(CHANNEL_DIR, "state.json");

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

interface PollState {
  lastEditedTime: string | null;
}

async function readState(): Promise<PollState> {
  try {
    const raw = await fs.readFile(STATE_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { lastEditedTime: null };
  }
}

async function writeState(state: PollState): Promise<void> {
  await fs.mkdir(CHANNEL_DIR, { recursive: true });
  await fs.writeFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

export async function main(): Promise<void> {
  const env = await loadEnv();
  const token = env.NOTION_API_TOKEN || process.env.NOTION_API_TOKEN;

  if (!token) {
    console.error("Missing NOTION_API_TOKEN. Run /notion:configure to set up.");
    process.exit(1);
  }

  const notion = new Client({ auth: token });

  const { server, notify, connect } = createChannelServer({
    name: "notion",
    version: "0.0.1",
    instructions: [
      'Notion page/database changes arrive as <channel source="notion" page_id="..." title="...">.',
      "Use the comment tool to add a comment to a page (pass page_id from the tag).",
      "Use the append tool to append content blocks to a page.",
    ].join(" "),
    twoWay: true,
  });

  // Register tools: comment and append
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "comment",
        description: "Add a comment to a Notion page",
        inputSchema: {
          type: "object" as const,
          properties: {
            page_id: {
              type: "string",
              description: "The Notion page ID to comment on",
            },
            text: {
              type: "string",
              description: "The comment text",
            },
          },
          required: ["page_id", "text"],
        },
      },
      {
        name: "append",
        description: "Append a paragraph to a Notion page",
        inputSchema: {
          type: "object" as const,
          properties: {
            page_id: {
              type: "string",
              description: "The Notion page ID to append to",
            },
            text: {
              type: "string",
              description: "The text content to append as a paragraph",
            },
          },
          required: ["page_id", "text"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { page_id, text } = req.params.arguments as {
      page_id: string;
      text: string;
    };

    if (req.params.name === "comment") {
      await notion.comments.create({
        parent: { page_id },
        rich_text: [{ type: "text", text: { content: text } }],
      });
      return { content: [{ type: "text" as const, text: "comment added" }] };
    }

    if (req.params.name === "append") {
      await notion.blocks.children.append({
        block_id: page_id,
        children: [
          {
            object: "block",
            type: "paragraph",
            paragraph: {
              rich_text: [{ type: "text", text: { content: text } }],
            },
          },
        ],
      });
      return { content: [{ type: "text" as const, text: "content appended" }] };
    }

    throw new Error(`unknown tool: ${req.params.name}`);
  });

  await connect();

  const pollInterval =
    Number.parseInt(process.env.POLL_INTERVAL_MS || "", 10) || 30_000;
  const state = await readState();

  const poll = async () => {
    try {
      const response = await notion.search({
        sort: { direction: "descending", timestamp: "last_edited_time" },
        page_size: 10,
      });

      const results = response.results.filter(
        (r): r is Extract<typeof r, { last_edited_time: string }> =>
          "last_edited_time" in r,
      );

      // On first run, just set the cursor without emitting
      if (!state.lastEditedTime && results.length > 0) {
        state.lastEditedTime = results[0].last_edited_time;
        await writeState(state);
        return;
      }

      const newPages = results.filter(
        (r) => state.lastEditedTime && r.last_edited_time > state.lastEditedTime,
      );

      for (const page of newPages.reverse()) {
        let title = page.id;
        try {
          if ("properties" in page) {
            const props = page.properties as Record<string, unknown>;
            for (const val of Object.values(props)) {
              if (val && typeof val === "object" && "title" in val) {
                const titleProp = val as { title: Array<{ plain_text: string }> };
                if (Array.isArray(titleProp.title)) {
                  title = titleProp.title.map((t) => t.plain_text).join("") || page.id;
                  break;
                }
              }
            }
          }
        } catch {
          // fallback to page.id
        }

        await notify(`Page updated: ${title}`, {
          page_id: page.id,
          title,
          last_edited: page.last_edited_time,
        });
      }

      if (newPages.length > 0) {
        state.lastEditedTime = newPages[newPages.length - 1].last_edited_time;
        await writeState(state);
      }
    } catch (err) {
      console.error("Notion poll error:", err);
    }
  };

  setInterval(poll, pollInterval);
  await poll();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
