/**
 * Gateway message types and configuration interfaces.
 *
 * Defines the WebSocket protocol between Client, Gateway, and Daemon.
 */

// ── Client → Gateway ──────────────────────────────────────────────

export type ClientToGateway =
  | { type: "create_run"; workflow: string; run_id?: string; prompt?: string }
  | { type: "user_input"; run_id: string; input: string }
  | { type: "abort_run"; run_id: string }
  | { type: "subscribe"; run_id: string };

// ── Gateway → Client ──────────────────────────────────────────────

export type GatewayToClient =
  | { type: "run_created"; run_id: string }
  | { type: "run_started"; run_id: string; state: string }
  | { type: "agent_output"; run_id: string; content: string; stream?: boolean }
  | { type: "state_changed"; run_id: string; from: string; to: string }
  | {
      type: "run_completed";
      run_id: string;
      status: "completed" | "aborted";
    }
  | { type: "error"; run_id?: string; message: string };

// ── Daemon → Gateway ──────────────────────────────────────────────

export type DaemonToGateway =
  | { type: "register"; daemon_id: string; capacity: number }
  | { type: "agent_ready"; run_id: string }
  | { type: "agent_output"; run_id: string; content: string; stream?: boolean }
  | { type: "state_changed"; run_id: string; from: string; to: string }
  | {
      type: "run_completed";
      run_id: string;
      status: "completed" | "aborted";
    }
  | { type: "error"; run_id: string; message: string };

// ── Gateway → Daemon ──────────────────────────────────────────────

export type GatewayToDaemon =
  | { type: "start_run"; run_id: string; workflow: string; prompt?: string }
  | { type: "user_input"; run_id: string; input: string }
  | { type: "abort_run"; run_id: string };

// ── Configuration ─────────────────────────────────────────────────

export interface GatewayConfig {
  port: number;
  host: string;
  api_keys: string[];
  store_root: string;
  max_concurrent_runs: number;
  idle_timeout_ms: number;
}

export interface DaemonConfig {
  gateway_url: string;
  api_key: string;
  max_agents: number;
  agent_idle_timeout_ms: number;
}

// ── Agent Handle ──────────────────────────────────────────────────

export type AgentStatus = "starting" | "running" | "idle" | "stopped";

export interface AgentHandle {
  run_id: string;
  session_id: string;
  status: AgentStatus;
  last_activity: Date;
}

// ── Type Guards ───────────────────────────────────────────────────

const CLIENT_MESSAGE_TYPES = new Set([
  "create_run",
  "user_input",
  "abort_run",
  "subscribe",
]);

const DAEMON_MESSAGE_TYPES = new Set([
  "register",
  "agent_ready",
  "agent_output",
  "state_changed",
  "run_completed",
  "error",
]);

const GATEWAY_TO_CLIENT_TYPES = new Set([
  "run_created",
  "run_started",
  "agent_output",
  "state_changed",
  "run_completed",
  "error",
]);

const GATEWAY_TO_DAEMON_TYPES = new Set(["start_run", "user_input", "abort_run"]);

export function isClientMessage(msg: unknown): msg is ClientToGateway {
  return (
    typeof msg === "object" &&
    msg !== null &&
    "type" in msg &&
    CLIENT_MESSAGE_TYPES.has((msg as { type: string }).type)
  );
}

export function isDaemonMessage(msg: unknown): msg is DaemonToGateway {
  return (
    typeof msg === "object" &&
    msg !== null &&
    "type" in msg &&
    DAEMON_MESSAGE_TYPES.has((msg as { type: string }).type)
  );
}

export function isGatewayToClientMessage(msg: unknown): msg is GatewayToClient {
  return (
    typeof msg === "object" &&
    msg !== null &&
    "type" in msg &&
    GATEWAY_TO_CLIENT_TYPES.has((msg as { type: string }).type)
  );
}

export function isGatewayToDaemonMessage(msg: unknown): msg is GatewayToDaemon {
  return (
    typeof msg === "object" &&
    msg !== null &&
    "type" in msg &&
    GATEWAY_TO_DAEMON_TYPES.has((msg as { type: string }).type)
  );
}

// ── Serialization ─────────────────────────────────────────────────

export function serializeMessage(
  msg: ClientToGateway | GatewayToClient | DaemonToGateway | GatewayToDaemon,
): string {
  return JSON.stringify(msg);
}

export function deserializeMessage(
  data: string,
): ClientToGateway | GatewayToClient | DaemonToGateway | GatewayToDaemon {
  return JSON.parse(data);
}
