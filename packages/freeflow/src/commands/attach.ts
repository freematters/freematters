import { createInterface } from "node:readline";
import { agentLog, colors as c } from "../agent-log.js";
import { handleError } from "../output.js";

export interface AttachArgs {
  runId: string;
  gateway: string;
  apiKey?: string;
  json: boolean;
}

const log = agentLog;

export async function attach(args: AttachArgs): Promise<void> {
  try {
    const { GatewayCliClient } = await import("../gateway/cli-client.js");
    const rl = createInterface({ input: process.stdin, output: process.stderr });

    const client = new GatewayCliClient({
      gatewayUrl: args.gateway,
      apiKey: args.apiKey,
    });

    log(`Connecting to gateway: ${args.gateway}`, c.cyan);
    await client.connect();
    log("Connected to gateway", c.green);

    let done = false;

    client.on("agent_output", (msg) => {
      if (msg.content.startsWith("> ")) {
        // User input replay — show in bright white
        process.stdout.write(`\x1b[1;37m${msg.content}\x1b[0m`);
      } else {
        process.stdout.write(msg.content);
      }
      if (!msg.stream) {
        process.stdout.write("\n");
      }
    });

    client.on("state_changed", (msg) => {
      log(`state: ${msg.from} → ${msg.to}`, c.green);
    });

    client.on("run_completed", (msg) => {
      log(`run finished: ${msg.status}`, c.green);
      done = true;
      rl.close();
    });

    client.on("error", (msg) => {
      log(`error: ${msg.message}`, c.red);
    });

    // Subscribe to the existing run
    client.subscribe(args.runId);
    log(`Attached to run ${args.runId}`, c.green);

    // Forward stdin as user_input
    rl.on("line", (line) => {
      client.sendInput(args.runId, line);
    });

    // Wait until run completes or connection closes
    await new Promise<void>((resolve) => {
      if (done) {
        resolve();
        return;
      }
      client.on("run_completed", () => resolve());
      client.on("close", () => resolve());
    });

    client.close();
  } catch (err: unknown) {
    handleError(err, args.json);
  }
}
