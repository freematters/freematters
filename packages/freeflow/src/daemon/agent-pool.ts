/**
 * Agent pool — manages agent sessions for the daemon.
 *
 * Tracks agent lifecycle: starting → running → idle → stopped.
 * Enforces capacity limits and provides agent lookup.
 *
 * Spawns real child processes using `fflow run` to execute workflows.
 */

import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import type { AgentHandle, AgentStatus } from "../gateway/types.js";

export interface AgentPoolConfig {
  max_agents: number;
  agent_idle_timeout_ms: number;
  /** The freeflow storage root directory. */
  store_root: string;
  /** Path to the fflow CLI entry point (e.g., dist/cli.js). */
  cli_path: string;
}

export interface StartAgentArgs {
  run_id: string;
  workflow: string;
  prompt?: string;
}

export class AgentPool {
  private config: AgentPoolConfig;
  private agents: Map<string, AgentHandle> = new Map();
  private processes: Map<string, ChildProcess> = new Map();
  private activeCount = 0;

  /** Called when an agent produces output. */
  onOutput: ((runId: string, content: string, stream?: boolean) => void) | null = null;

  /** Called when an agent is ready. */
  onReady: ((runId: string) => void) | null = null;

  /** Called when an agent completes. */
  onComplete: ((runId: string, status: "completed" | "aborted") => void) | null = null;

  constructor(config: AgentPoolConfig) {
    this.config = config;
  }

  /**
   * Start a new agent for a run. Returns the agent handle.
   *
   * Spawns `node <cli_path> run <workflow> --run-id <run_id> --root <store_root>`
   * as a child process. Stdout is piped line-by-line to `onOutput`.
   * When the child exits, `onComplete` is called with the appropriate status.
   */
  async startAgent(args: StartAgentArgs): Promise<AgentHandle> {
    if (this.activeCount >= this.config.max_agents) {
      throw new Error(
        `Agent pool at capacity (${this.config.max_agents}). Cannot start new agent.`,
      );
    }

    const handle: AgentHandle = {
      run_id: args.run_id,
      session_id: randomUUID(),
      status: "starting",
      last_activity: new Date(),
    };

    this.agents.set(args.run_id, handle);
    this.activeCount++;

    // Build child process arguments
    const childArgs = [
      this.config.cli_path,
      "run",
      args.workflow,
      "--run-id",
      args.run_id,
      "--root",
      this.config.store_root,
    ];
    if (args.prompt) {
      childArgs.push("--prompt", args.prompt);
    }

    const child = spawn(process.execPath, childArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    this.processes.set(args.run_id, child);

    // Pipe stdout line by line to onOutput
    if (child.stdout) {
      const rl = createInterface({ input: child.stdout });
      rl.on("line", (line) => {
        handle.last_activity = new Date();
        this.onOutput?.(args.run_id, line);
      });
    }

    // Pipe stderr line by line to onOutput (agent logs go to stderr)
    if (child.stderr) {
      const rl = createInterface({ input: child.stderr });
      rl.on("line", (line) => {
        handle.last_activity = new Date();
        this.onOutput?.(args.run_id, line);
      });
    }

    // Handle child exit
    child.on("exit", (code, signal) => {
      const status: "completed" | "aborted" = code === 0 ? "completed" : "aborted";
      this.updateStatus(args.run_id, "stopped");
      this.onComplete?.(args.run_id, status);
      this.processes.delete(args.run_id);
    });

    child.on("error", (err) => {
      this.updateStatus(args.run_id, "stopped");
      this.onComplete?.(args.run_id, "aborted");
      this.processes.delete(args.run_id);
    });

    // Mark as running and notify ready once spawned
    this.updateStatus(args.run_id, "running");
    this.onReady?.(args.run_id);

    return handle;
  }

  /**
   * Update agent status.
   */
  updateStatus(runId: string, status: AgentStatus): void {
    const agent = this.agents.get(runId);
    if (agent) {
      const wasStopped = agent.status === "stopped";
      const isStopped = status === "stopped";
      if (!wasStopped && isStopped) {
        this.activeCount--;
      } else if (wasStopped && !isStopped) {
        this.activeCount++;
      }
      agent.status = status;
      agent.last_activity = new Date();
    }
  }

  /**
   * Get agent handle by run_id.
   */
  getAgent(runId: string): AgentHandle | undefined {
    return this.agents.get(runId);
  }

  /**
   * Get all agent handles.
   */
  getAgents(): AgentHandle[] {
    return [...this.agents.values()];
  }

  /**
   * Send user input to an agent by writing to the child process stdin.
   */
  sendInput(runId: string, input: string): void {
    const agent = this.agents.get(runId);
    if (!agent) {
      throw new Error(`No agent found for run ${runId}`);
    }

    const child = this.processes.get(runId);
    if (child?.stdin && !child.stdin.destroyed) {
      child.stdin.write(`${input}\n`);
    }

    agent.last_activity = new Date();
  }

  /**
   * Remove an agent from the pool.
   */
  removeAgent(runId: string): void {
    const agent = this.agents.get(runId);
    if (agent && agent.status !== "stopped") {
      this.activeCount--;
    }
    const child = this.processes.get(runId);
    if (child) {
      try {
        child.kill("SIGTERM");
      } catch {
        // Process may already be dead
      }
      this.processes.delete(runId);
    }
    this.agents.delete(runId);
  }

  /**
   * Stop all agents by sending SIGTERM to all child processes.
   */
  stopAll(): void {
    for (const [runId, child] of this.processes) {
      try {
        child.kill("SIGTERM");
      } catch {
        // Process may already be dead
      }
    }
    for (const [runId, agent] of this.agents) {
      agent.status = "stopped";
      this.onComplete?.(runId, "aborted");
    }
    this.agents.clear();
    this.processes.clear();
    this.activeCount = 0;
  }
}
