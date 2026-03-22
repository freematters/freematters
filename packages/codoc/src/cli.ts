#!/usr/bin/env node

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { hookCommand } from "./commands/hook.js";
import { installCommand } from "./commands/install.js";
import { killCommand } from "./commands/kill.js";
import { pollCommand } from "./commands/poll.js";
import { serverCommand } from "./commands/server.js";
import { shareCommand } from "./commands/share.js";
import { stopCommand } from "./commands/stop.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const pkg = require(path.join(__dirname, "..", "package.json"));

const program = new Command();

program
  .name("codoc")
  .description("Real-time collaborative markdown editing between AI agents and humans")
  .version(pkg.version);

program.addCommand(serverCommand());
program.addCommand(shareCommand());
program.addCommand(pollCommand());
program.addCommand(stopCommand());
program.addCommand(installCommand());
program.addCommand(killCommand());
program.addCommand(hookCommand(), { hidden: true });

program.parse(process.argv);
