#!/usr/bin/env bun
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as esbuild from "esbuild";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIST = path.join(ROOT, "dist");
const SKILLS_DIR = path.join(ROOT, "skills");

interface ChannelDef {
  name: string;
  version: string;
  description: string;
  keywords: string[];
  twoWay: boolean;
  tokens: Array<{ envVar: string; hint: string }>;
  skills: { configure: "template" | "override"; access: boolean };
  entryPoint: string;
}

const CHANNELS: ChannelDef[] = [
  {
    name: "slack",
    version: "0.0.1",
    description: "Slack channel for Claude Code — chat bridge with access control",
    keywords: ["slack", "messaging"],
    twoWay: true,
    tokens: [
      { envVar: "SLACK_BOT_TOKEN", hint: "from api.slack.com/apps → OAuth" },
      {
        envVar: "SLACK_APP_TOKEN",
        hint: "from api.slack.com/apps → Basic Information → App-Level Tokens",
      },
    ],
    skills: { configure: "override", access: true },
    entryPoint: "src/slack/server.ts",
  },
  {
    name: "notion",
    version: "0.0.1",
    description:
      "Notion channel for Claude Code — page and database change notifications",
    keywords: ["notion", "documents"],
    twoWay: false,
    tokens: [{ envVar: "NOTION_API_TOKEN", hint: "from notion.so/my-integrations" }],
    skills: { configure: "override", access: false },
    entryPoint: "src/notion/server.ts",
  },
  {
    name: "github-issues",
    version: "0.0.1",
    description:
      "GitHub Issues channel for Claude Code — issue and comment notifications",
    keywords: ["github", "issues"],
    twoWay: true,
    tokens: [
      {
        envVar: "GITHUB_TOKEN",
        hint: "from github.com/settings/tokens with repo scope",
      },
    ],
    skills: { configure: "override", access: false },
    entryPoint: "src/github-issues/server.ts",
  },
];

async function renderTemplate(
  templatePath: string,
  vars: Record<string, string>,
): Promise<string> {
  let content = await fs.readFile(templatePath, "utf-8");
  for (const [key, value] of Object.entries(vars)) {
    content = content.replaceAll(`{{${key}}}`, value);
  }
  return content;
}

async function buildChannel(channel: ChannelDef): Promise<void> {
  const outDir = path.join(DIST, channel.name);

  // Clean
  await fs.rm(outDir, { recursive: true, force: true });

  // 1. Bundle with esbuild
  const entryPath = path.join(ROOT, channel.entryPoint);
  try {
    await fs.access(entryPath);
  } catch {
    console.warn(`  ⚠ Entry point ${channel.entryPoint} not found, skipping bundle`);
    return;
  }

  await esbuild.build({
    entryPoints: [entryPath],
    bundle: true,
    platform: "node",
    target: "node18",
    format: "esm",
    outfile: path.join(outDir, "server.js"),
    banner: { js: "#!/usr/bin/env bun" },
  });

  // 2. Generate plugin.json
  const pluginDir = path.join(outDir, ".claude-plugin");
  await fs.mkdir(pluginDir, { recursive: true });
  await fs.writeFile(
    path.join(pluginDir, "plugin.json"),
    JSON.stringify(
      {
        name: channel.name,
        description: channel.description,
        version: channel.version,
        keywords: [...channel.keywords, "channel", "mcp"],
      },
      null,
      2,
    ) + "\n",
  );

  // 3. Generate .mcp.json
  await fs.writeFile(
    path.join(outDir, ".mcp.json"),
    JSON.stringify(
      {
        mcpServers: {
          [channel.name]: {
            command: "bun",
            args: ["${CLAUDE_PLUGIN_ROOT}/server.js"],
          },
        },
      },
      null,
      2,
    ) + "\n",
  );

  // 4. Build skills
  const templateVars: Record<string, string> = {
    CHANNEL: channel.name,
    TOKEN_VAR: channel.tokens[0].envVar,
    TOKEN_HINT: channel.tokens[0].hint,
    CHANNEL_DIR: `~/.claude/channels/${channel.name}`,
  };

  // Configure skill
  const configureOutDir = path.join(outDir, "skills", "configure");
  await fs.mkdir(configureOutDir, { recursive: true });

  if (channel.skills.configure === "override") {
    const overridePath = path.join(SKILLS_DIR, channel.name, "configure.md");
    await fs.copyFile(overridePath, path.join(configureOutDir, "SKILL.md"));
  } else {
    const templatePath = path.join(SKILLS_DIR, "_templates", "configure.md");
    const rendered = await renderTemplate(templatePath, templateVars);
    await fs.writeFile(path.join(configureOutDir, "SKILL.md"), rendered);
  }

  // Access skill (if applicable)
  if (channel.skills.access) {
    const accessOutDir = path.join(outDir, "skills", "access");
    await fs.mkdir(accessOutDir, { recursive: true });

    const overridePath = path.join(SKILLS_DIR, channel.name, "access.md");
    try {
      await fs.access(overridePath);
      await fs.copyFile(overridePath, path.join(accessOutDir, "SKILL.md"));
    } catch {
      const templatePath = path.join(SKILLS_DIR, "_templates", "access.md");
      const rendered = await renderTemplate(templatePath, templateVars);
      await fs.writeFile(path.join(accessOutDir, "SKILL.md"), rendered);
    }
  }

  console.log(`  ✓ ${channel.name}`);
}

async function main(): Promise<void> {
  const target = process.argv[2];
  const toBuild = target ? CHANNELS.filter((c) => c.name === target) : CHANNELS;

  if (target && toBuild.length === 0) {
    console.error(`Unknown channel: ${target}`);
    console.error(`Available: ${CHANNELS.map((c) => c.name).join(", ")}`);
    process.exit(1);
  }

  console.log("Building channel plugins...");
  for (const channel of toBuild) {
    await buildChannel(channel);
  }
  console.log("Done.");
}

main();
