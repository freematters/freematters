/**
 * Agent Daemon — connects to Gateway and manages agent sessions.
 *
 * Usage:
 *   const daemon = createDaemon(config);
 *   daemon.start();    // connects and registers with Gateway
 *   daemon.stop();     // disconnects and stops all agents
 *   daemon.getAgents() // returns current agent handles
 */

import { randomUUID } from "node:crypto";
import type { AgentHandle, DaemonConfig, GatewayToDaemon } from "../gateway/types.js";
import { AgentPool } from "./agent-pool.js";
import { GatewayClient } from "./gateway-client.js";

export interface Daemon {
  start(): void;
  stop(): void;
  getAgents(): AgentHandle[];
}

export interface CreateDaemonOptions {
  /** Optional factory for creating a GatewayClient (used for testing). */
  gatewayClientFactory?: (config: DaemonConfig) => GatewayClient;
}

/** Extended interface for testing — provides access to the gateway client via dependency injection. */
export interface DaemonTestHandle extends Daemon {
  gatewayClient: GatewayClient;
}

/**
 * Create a daemon instance that connects to a Gateway and manages agents.
 */
export function createDaemon(
  config: DaemonConfig,
  options?: CreateDaemonOptions,
): Daemon {
  return _createDaemonInternal(config, options);
}

/**
 * Create a daemon with an exposed gateway client for testing.
 * Production code should use `createDaemon` instead.
 */
export function createDaemonForTest(
  config: DaemonConfig,
  options?: CreateDaemonOptions,
): DaemonTestHandle {
  return _createDaemonInternal(config, options);
}

function _createDaemonInternal(
  config: DaemonConfig,
  options?: CreateDaemonOptions,
): DaemonTestHandle {
  const daemonId = `daemon-${randomUUID().slice(0, 8)}`;
  const factory =
    options?.gatewayClientFactory ?? ((c: DaemonConfig) => new GatewayClient(c));
  const client = factory(config);
  const pool = new AgentPool({
    max_agents: config.max_agents,
    agent_idle_timeout_ms: config.agent_idle_timeout_ms,
    store_root: config.store_root,
    cli_path: config.cli_path,
  });

  // Wire up pool events → gateway messages
  pool.onReady = (runId) => {
    client.sendMessage({ type: "agent_ready", run_id: runId });
  };

  pool.onOutput = (runId, content, stream) => {
    client.sendMessage({
      type: "agent_output",
      run_id: runId,
      content,
      stream,
    });
  };

  pool.onComplete = (runId, status) => {
    client.sendMessage({
      type: "run_completed",
      run_id: runId,
      status,
    });
    pool.removeAgent(runId);
  };

  // Wire up gateway messages → pool actions
  client.onMessage = (msg: GatewayToDaemon) => {
    switch (msg.type) {
      case "start_run":
        pool
          .startAgent({
            run_id: msg.run_id,
            workflow: msg.workflow,
            prompt: msg.prompt,
          })
          .catch((err) => {
            client.sendMessage({
              type: "error",
              run_id: msg.run_id,
              message: err instanceof Error ? err.message : String(err),
            });
          });
        break;

      case "user_input":
        try {
          pool.sendInput(msg.run_id, msg.input);
        } catch (err) {
          client.sendMessage({
            type: "error",
            run_id: msg.run_id,
            message: err instanceof Error ? err.message : String(err),
          });
        }
        break;

      case "abort_run": {
        const agent = pool.getAgent(msg.run_id);
        if (agent) {
          pool.updateStatus(msg.run_id, "stopped");
          pool.removeAgent(msg.run_id);
          client.sendMessage({
            type: "run_completed",
            run_id: msg.run_id,
            status: "aborted",
          });
        }
        break;
      }
    }
  };

  return {
    start() {
      client.connect(daemonId, config.max_agents);
    },

    stop() {
      pool.stopAll();
      client.disconnect();
    },

    getAgents() {
      return pool.getAgents();
    },

    gatewayClient: client,
  };
}
