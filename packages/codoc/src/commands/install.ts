import { execFile, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Command } from "commander";
import { getDefaultSocketPath } from "../paths.js";

const execFileAsync = promisify(execFile);

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer: string) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function getPackageRoot(): string {
  const __filename = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(__filename), "..", "..");
}

function generateHooksJson(cliPath: string): object {
  const nodeExe = process.execPath;
  const cmd = `${nodeExe} ${cliPath}`;
  return {
    hooks: {
      SessionStart: [
        {
          hooks: [
            {
              type: "command",
              command: `${cmd} server`,
              timeout: 30,
            },
          ],
        },
      ],
      SessionEnd: [
        {
          hooks: [
            {
              type: "command",
              command: `${cmd} stop`,
              timeout: 10,
            },
          ],
        },
      ],
      PostToolUse: [
        {
          matcher: "",
          hooks: [
            {
              type: "command",
              command: `${cmd} _hook post-tool-use`,
              timeout: 10,
            },
          ],
        },
      ],
    },
  };
}

async function runInstall(platform: string): Promise<void> {
  if (platform !== "claude") {
    console.error(`Unsupported platform: ${platform}. Only "claude" is supported.`);
    process.exitCode = 1;
    return;
  }

  console.log("Killing existing codoc servers...");
  try {
    execSync("pkill -9 -f 'codoc/dist/cli.js server'", { stdio: "ignore" });
  } catch {}
  try {
    fs.unlinkSync(getDefaultSocketPath());
  } catch {}

  const packageRoot = getPackageRoot();
  const cliPath = path.join(packageRoot, "dist", "cli.js");
  const hooksJsonPath = path.join(packageRoot, "hooks", "hooks.json");
  const marketplacePath = path.join(packageRoot, ".claude-plugin", "marketplace.json");
  const pluginName = "codoc";

  const configPath = path.join(os.homedir(), ".codoc", "config.json");
  if (!fs.existsSync(configPath)) {
    console.log("\nFirst-time setup: creating ~/.codoc/config.json\n");
    const tunnelAnswer = await ask("Use Cloudflare Tunnel for remote access? (y/n): ");
    const tunnel = tunnelAnswer.toLowerCase() === "y" ? "cloudflare" : null;
    const portAnswer = await ask("HTTP port (default 3000): ");
    const port = portAnswer ? Number.parseInt(portAnswer, 10) : 3000;
    const nameAnswer = await ask("Default username (default browser_user): ");
    const defaultName = nameAnswer || "browser_user";

    const configDir = path.dirname(configPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    const config = { tunnel, port: Number.isNaN(port) ? 3000 : port, defaultName };
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    console.log(`Config written to ${configPath}`);
    console.log(JSON.stringify(config, null, 2));
    console.log("");
  }

  console.log(`Registering codoc plugin from ${packageRoot}...`);

  console.log("Generating hooks.json with absolute paths...");
  const hooksJson = generateHooksJson(cliPath);
  fs.writeFileSync(hooksJsonPath, `${JSON.stringify(hooksJson, null, 2)}\n`);
  console.log(`hooks.json written to ${hooksJsonPath}`);

  try {
    console.log("Adding plugin to marketplace...");
    await execFileAsync("claude", ["plugin", "marketplace", "add", marketplacePath]);
    console.log("Marketplace entry added.");
  } catch (err: unknown) {
    const e = err as { message: string };
    console.error(`Failed to add marketplace entry: ${e.message}`);
    console.log("(This is expected if claude CLI is not available)");
  }

  try {
    console.log("Installing plugin...");
    await execFileAsync("claude", ["plugin", "install", pluginName]);
    console.log("Plugin installed successfully.");
  } catch (err: unknown) {
    const e = err as { message: string };
    console.error(`Failed to install plugin: ${e.message}`);
    console.log("(This is expected if claude CLI is not available)");
  }

  console.log("Plugin registration complete.");
}

export function installCommand(): Command {
  const cmd = new Command("install");
  cmd
    .description("Register as Claude Code plugin")
    .argument("<platform>", "Target platform (e.g., claude)")
    .action(runInstall);
  return cmd;
}
