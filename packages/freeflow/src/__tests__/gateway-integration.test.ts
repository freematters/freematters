/**
 * Integration tests for fflow Gateway — Disconnection Handling.
 *
 * Tests the full stack: Gateway Server + Daemon + CLI Client.
 * Verifies that when a client disconnects unexpectedly:
 *   1. The workflow continues running (not aborted)
 *   2. The client can reconnect and resubscribe
 *   3. Buffered output is replayed on reconnect
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import WebSocket from "ws";
import { createGatewayServer } from "../gateway/server.js";
import type { GatewayToClient } from "../gateway/types.js";
import { cleanupTempDir, createTempDir } from "./fixtures.js";

const TEST_PORT = 18_765;
const API_KEY = "test-integration-key";

let tmp: string;
let gateway: ReturnType<typeof createGatewayServer>;

beforeAll(async () => {
  tmp = createTempDir("gw-integration");
  gateway = createGatewayServer({
    port: TEST_PORT,
    host: "127.0.0.1",
    api_keys: [API_KEY],
    store_root: tmp,
    max_concurrent_runs: 10,
    idle_timeout_ms: 60_000,
  });
  await gateway.start();
});

afterAll(async () => {
  await gateway.stop();
  cleanupTempDir(tmp);
});

/** Helper: create a WebSocket client to the gateway. */
function connectClient(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/ws/client`, {
      headers: { "x-api-key": API_KEY },
    });
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

/** Helper: create a WebSocket daemon connection to the gateway. */
function connectDaemonWs(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/ws/daemon`, {
      headers: { "x-api-key": API_KEY },
    });
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

/** Helper: collect messages from a WebSocket. */
function collectMessages(ws: WebSocket): GatewayToClient[] {
  const msgs: GatewayToClient[] = [];
  ws.on("message", (data) => {
    msgs.push(JSON.parse(data.toString()) as GatewayToClient);
  });
  return msgs;
}

/** Helper: wait for a message matching a predicate. */
function waitForMessage(
  ws: WebSocket,
  predicate: (msg: GatewayToClient) => boolean,
  timeoutMs = 5000,
): Promise<GatewayToClient> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Timeout waiting for message")),
      timeoutMs,
    );
    const handler = (data: WebSocket.RawData) => {
      const msg = JSON.parse(data.toString()) as GatewayToClient;
      if (predicate(msg)) {
        clearTimeout(timer);
        ws.off("message", handler);
        resolve(msg);
      }
    };
    ws.on("message", handler);
  });
}

/** Helper: wait for N milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("Disconnection Handling", { timeout: 30_000 }, () => {
  test("workflow continues running after client disconnect", async () => {
    // --- Setup: connect daemon ---
    const daemonWs = await connectDaemonWs();
    const daemonId = "daemon-integ-1";
    daemonWs.send(
      JSON.stringify({ type: "register", daemon_id: daemonId, capacity: 5 }),
    );
    // Wait for registration ack
    await waitForMessage(
      daemonWs,
      (m) => (m as unknown as { type: string }).type === "registered",
    );

    // --- Setup: connect client, create run ---
    const clientWs = await connectClient();
    const clientMsgs = collectMessages(clientWs);

    const runId = "disconnect-test-run-1";
    clientWs.send(
      JSON.stringify({ type: "create_run", workflow: "test.yaml", run_id: runId }),
    );

    // Wait for run_created
    await waitForMessage(clientWs, (m) => m.type === "run_created");

    // Daemon should receive start_run
    const startRunMsg = await waitForMessage(
      daemonWs,
      (m) => (m as unknown as { type: string }).type === "start_run",
    );
    expect((startRunMsg as unknown as { run_id: string }).run_id).toBe(runId);

    // Daemon signals agent is ready
    daemonWs.send(JSON.stringify({ type: "agent_ready", run_id: runId }));
    await waitForMessage(clientWs, (m) => m.type === "run_started");

    // Daemon sends some output
    daemonWs.send(
      JSON.stringify({
        type: "agent_output",
        run_id: runId,
        content: "output-before-disconnect",
      }),
    );
    await sleep(100);

    // --- Client disconnects unexpectedly ---
    clientWs.terminate();
    await sleep(100);

    // --- Daemon continues sending output (workflow is NOT aborted) ---
    daemonWs.send(
      JSON.stringify({
        type: "agent_output",
        run_id: runId,
        content: "output-while-disconnected-1",
      }),
    );
    daemonWs.send(
      JSON.stringify({
        type: "agent_output",
        run_id: runId,
        content: "output-while-disconnected-2",
      }),
    );
    await sleep(100);

    // Verify daemon did NOT receive an abort_run
    // (The daemon WS is still open and not closed)
    expect(daemonWs.readyState).toBe(WebSocket.OPEN);

    // --- Client reconnects and resubscribes ---
    const client2Ws = await connectClient();
    const client2Msgs = collectMessages(client2Ws);

    // Subscribe to the same run
    client2Ws.send(JSON.stringify({ type: "subscribe", run_id: runId }));
    await sleep(200);

    // Buffered output should be replayed
    const replayedContents = client2Msgs
      .filter((m) => m.type === "agent_output")
      .map((m) => (m as Extract<GatewayToClient, { type: "agent_output" }>).content);

    expect(replayedContents).toContain("output-while-disconnected-1");
    expect(replayedContents).toContain("output-while-disconnected-2");

    // --- New output after reconnect is also received ---
    daemonWs.send(
      JSON.stringify({
        type: "agent_output",
        run_id: runId,
        content: "output-after-reconnect",
      }),
    );
    const afterReconnectMsg = await waitForMessage(
      client2Ws,
      (m) =>
        m.type === "agent_output" &&
        (m as Extract<GatewayToClient, { type: "agent_output" }>).content ===
          "output-after-reconnect",
    );
    expect(afterReconnectMsg).toBeDefined();

    // Cleanup
    client2Ws.close();
    daemonWs.close();
    await sleep(100);
  });

  test("run is still accessible via REST after client disconnect", async () => {
    // --- Setup: connect daemon ---
    const daemonWs = await connectDaemonWs();
    daemonWs.send(
      JSON.stringify({ type: "register", daemon_id: "daemon-integ-2", capacity: 5 }),
    );
    await waitForMessage(
      daemonWs,
      (m) => (m as unknown as { type: string }).type === "registered",
    );

    // --- Setup: connect client, create run ---
    const clientWs = await connectClient();
    const runId = "disconnect-test-run-2";

    // Set up daemon listener BEFORE creating run to avoid race condition
    const startRunPromise = waitForMessage(
      daemonWs,
      (m) => (m as unknown as { type: string }).type === "start_run",
    );

    clientWs.send(
      JSON.stringify({ type: "create_run", workflow: "test2.yaml", run_id: runId }),
    );
    await waitForMessage(clientWs, (m) => m.type === "run_created");

    // Wait for daemon to get start_run
    await startRunPromise;

    // --- Client disconnects ---
    clientWs.terminate();
    await sleep(100);

    // --- Run should still be accessible via REST ---
    const response = await fetch(`http://127.0.0.1:${TEST_PORT}/api/runs/${runId}`, {
      headers: { "x-api-key": API_KEY },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.run_id).toBe(runId);
    // Status should NOT be aborted
    expect(body.gateway_status).not.toBe("aborted");

    // Cleanup
    daemonWs.close();
    await sleep(100);
  });
});
