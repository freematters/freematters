/**
 * Agent pool — manages agent sessions for the daemon.
 *
 * Tracks agent lifecycle: starting → running → idle → stopped.
 * Enforces capacity limits and provides agent lookup.
 */

import { randomUUID } from "node:crypto";
import type { AgentHandle, AgentStatus } from "../gateway/types.js";

export interface AgentPoolConfig {
  max_agents: number;
  agent_idle_timeout_ms: number;
}

export interface StartAgentArgs {
  run_id: string;
  workflow: string;
  prompt?: string;
}

export class AgentPool {
  private config: AgentPoolConfig;
  private agents: Map<string, AgentHandle> = new Map();
  private inputQueues: Map<string, string[]> = new Map();

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
   */
  async startAgent(args: StartAgentArgs): Promise<AgentHandle> {
    // Check capacity (count non-stopped agents)
    const activeCount = [...this.agents.values()].filter(
      (a) => a.status !== "stopped",
    ).length;

    if (activeCount >= this.config.max_agents) {
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
    this.inputQueues.set(args.run_id, []);

    // In a real implementation, this would spawn the agent process
    // using logic from commands/run.ts (runCore). For now, we mark
    // the agent as ready after creation.
    queueMicrotask(() => {
      this.updateStatus(args.run_id, "running");
      this.onReady?.(args.run_id);
    });

    return handle;
  }

  /**
   * Update agent status.
   */
  updateStatus(runId: string, status: AgentStatus): void {
    const agent = this.agents.get(runId);
    if (agent) {
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
   * Send user input to an agent.
   */
  sendInput(runId: string, input: string): void {
    const agent = this.agents.get(runId);
    if (!agent) {
      throw new Error(`No agent found for run ${runId}`);
    }

    const queue = this.inputQueues.get(runId);
    if (queue) {
      queue.push(input);
    }

    // In a real implementation, this would write to the agent's stdin
    agent.last_activity = new Date();
  }

  /**
   * Remove an agent from the pool.
   */
  removeAgent(runId: string): void {
    this.agents.delete(runId);
    this.inputQueues.delete(runId);
  }

  /**
   * Stop all agents.
   */
  stopAll(): void {
    for (const [runId, agent] of this.agents) {
      agent.status = "stopped";
      this.onComplete?.(runId, "aborted");
    }
    this.agents.clear();
    this.inputQueues.clear();
  }
}
