// --- Run Status (gateway-specific) ---

export type GatewayRunStatus =
  | "pending"
  | "waiting_daemon"
  | "starting"
  | "running"
  | "completed"
  | "aborted";

// --- Message Types ---

// Client → Gateway
export type ClientToGateway =
  | { type: "create_run"; workflow: string; run_id?: string; prompt?: string }
  | { type: "user_input"; run_id: string; input: string }
  | { type: "abort_run"; run_id: string }
  | { type: "subscribe"; run_id: string };

// Gateway → Client
export type GatewayToClient =
  | { type: "run_created"; run_id: string }
  | { type: "run_started"; run_id: string; state: string }
  | { type: "agent_output"; run_id: string; content: string; stream?: boolean }
  | { type: "state_changed"; run_id: string; from: string; to: string }
  | { type: "run_completed"; run_id: string; status: "completed" | "aborted" }
  | { type: "error"; run_id?: string; message: string };

// Daemon → Gateway
export type DaemonToGateway =
  | { type: "register"; daemon_id: string; capacity: number }
  | { type: "agent_ready"; run_id: string }
  | { type: "agent_output"; run_id: string; content: string; stream?: boolean }
  | { type: "state_changed"; run_id: string; from: string; to: string }
  | { type: "run_completed"; run_id: string; status: "completed" | "aborted" }
  | { type: "error"; run_id: string; message: string };

// Gateway → Daemon
export type GatewayToDaemon =
  | { type: "start_run"; run_id: string; workflow: string; prompt?: string }
  | { type: "user_input"; run_id: string; input: string }
  | { type: "abort_run"; run_id: string };

// --- Configuration Interfaces ---

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

// --- Agent Handle ---

export interface AgentHandle {
  run_id: string;
  session_id: string;
  status: "starting" | "running" | "idle" | "stopped";
  last_activity: Date;
}

// --- Type Guards ---

const CLIENT_TYPES = new Set(["create_run", "user_input", "abort_run", "subscribe"]);
const DAEMON_TYPES = new Set([
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isClientMessage(value: unknown): value is ClientToGateway {
  return (
    isObject(value) && typeof value.type === "string" && CLIENT_TYPES.has(value.type)
  );
}

export function isDaemonMessage(value: unknown): value is DaemonToGateway {
  return (
    isObject(value) && typeof value.type === "string" && DAEMON_TYPES.has(value.type)
  );
}

export function isGatewayToClientMessage(value: unknown): value is GatewayToClient {
  return (
    isObject(value) &&
    typeof value.type === "string" &&
    GATEWAY_TO_CLIENT_TYPES.has(value.type)
  );
}

export function isGatewayToDaemonMessage(value: unknown): value is GatewayToDaemon {
  return (
    isObject(value) &&
    typeof value.type === "string" &&
    GATEWAY_TO_DAEMON_TYPES.has(value.type)
  );
}

// --- Serialization Helpers ---

type AnyMessage = ClientToGateway | GatewayToClient | DaemonToGateway | GatewayToDaemon;

export function toJSON(msg: AnyMessage): string {
  return JSON.stringify(msg);
}

export function fromJSON(raw: string): AnyMessage {
  return JSON.parse(raw) as AnyMessage;
}
