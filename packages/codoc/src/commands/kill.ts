import { execSync } from "node:child_process";
import fs from "node:fs";
import { Command } from "commander";
import { getDefaultSocketPath } from "../paths.js";

export function killCommand(): Command {
  const cmd = new Command("kill");
  cmd.description("Kill all codoc server processes").action(() => {
    const socketPath = getDefaultSocketPath();
    try {
      const result = execSync("pgrep -f 'codoc/dist/cli.js server'", {
        encoding: "utf-8",
      }).trim();
      const pids = result.split("\n").filter((p) => p.length > 0);
      if (pids.length === 0) {
        console.log("No codoc server processes found.");
        return;
      }
      execSync("pkill -9 -f 'codoc/dist/cli.js server'");
      console.log(`Killed ${pids.length} codoc server process(es).`);
    } catch {
      console.log("No codoc server processes found.");
    }
    try {
      fs.unlinkSync(socketPath);
    } catch {}
  });
  return cmd;
}
