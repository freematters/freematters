import { describe, expect, test } from "vitest";
import {
  type ClientToGateway,
  type DaemonToGateway,
  type GatewayToClient,
  type GatewayToDaemon,
  fromJSON,
  isClientMessage,
  isDaemonMessage,
  isGatewayToClientMessage,
  isGatewayToDaemonMessage,
  toJSON,
} from "../types.js";

// --- Type guard tests ---

describe("isClientMessage", () => {
  test("accepts create_run", () => {
    const msg: ClientToGateway = { type: "create_run", workflow: "my.yaml" };
    expect(isClientMessage(msg)).toBe(true);
  });

  test("accepts create_run with optional fields", () => {
    const msg: ClientToGateway = {
      type: "create_run",
      workflow: "my.yaml",
      run_id: "r1",
      prompt: "hello",
    };
    expect(isClientMessage(msg)).toBe(true);
  });

  test("accepts user_input", () => {
    const msg: ClientToGateway = { type: "user_input", run_id: "r1", input: "yes" };
    expect(isClientMessage(msg)).toBe(true);
  });

  test("accepts abort_run", () => {
    const msg: ClientToGateway = { type: "abort_run", run_id: "r1" };
    expect(isClientMessage(msg)).toBe(true);
  });

  test("accepts subscribe", () => {
    const msg: ClientToGateway = { type: "subscribe", run_id: "r1" };
    expect(isClientMessage(msg)).toBe(true);
  });

  test("rejects daemon message types", () => {
    expect(isClientMessage({ type: "register", daemon_id: "d1", capacity: 5 })).toBe(
      false,
    );
  });

  test("rejects invalid type", () => {
    expect(isClientMessage({ type: "unknown" })).toBe(false);
  });

  test("rejects non-object", () => {
    expect(isClientMessage("hello")).toBe(false);
    expect(isClientMessage(null)).toBe(false);
    expect(isClientMessage(undefined)).toBe(false);
    expect(isClientMessage(42)).toBe(false);
  });
});

describe("isDaemonMessage", () => {
  test("accepts register", () => {
    const msg: DaemonToGateway = { type: "register", daemon_id: "d1", capacity: 5 };
    expect(isDaemonMessage(msg)).toBe(true);
  });

  test("accepts agent_ready", () => {
    const msg: DaemonToGateway = { type: "agent_ready", run_id: "r1" };
    expect(isDaemonMessage(msg)).toBe(true);
  });

  test("accepts agent_output", () => {
    const msg: DaemonToGateway = { type: "agent_output", run_id: "r1", content: "hi" };
    expect(isDaemonMessage(msg)).toBe(true);
  });

  test("accepts agent_output with stream flag", () => {
    const msg: DaemonToGateway = {
      type: "agent_output",
      run_id: "r1",
      content: "hi",
      stream: true,
    };
    expect(isDaemonMessage(msg)).toBe(true);
  });

  test("accepts state_changed", () => {
    const msg: DaemonToGateway = {
      type: "state_changed",
      run_id: "r1",
      from: "a",
      to: "b",
    };
    expect(isDaemonMessage(msg)).toBe(true);
  });

  test("accepts run_completed", () => {
    const msg: DaemonToGateway = {
      type: "run_completed",
      run_id: "r1",
      status: "completed",
    };
    expect(isDaemonMessage(msg)).toBe(true);
  });

  test("accepts error", () => {
    const msg: DaemonToGateway = { type: "error", run_id: "r1", message: "oops" };
    expect(isDaemonMessage(msg)).toBe(true);
  });

  test("rejects client message types", () => {
    expect(isDaemonMessage({ type: "create_run", workflow: "x.yaml" })).toBe(false);
  });

  test("rejects non-object", () => {
    expect(isDaemonMessage(null)).toBe(false);
  });
});

describe("isGatewayToClientMessage", () => {
  test("accepts run_created", () => {
    expect(isGatewayToClientMessage({ type: "run_created", run_id: "r1" })).toBe(true);
  });

  test("accepts run_started", () => {
    expect(
      isGatewayToClientMessage({ type: "run_started", run_id: "r1", state: "init" }),
    ).toBe(true);
  });

  test("accepts agent_output", () => {
    expect(
      isGatewayToClientMessage({ type: "agent_output", run_id: "r1", content: "hi" }),
    ).toBe(true);
  });

  test("accepts state_changed", () => {
    expect(
      isGatewayToClientMessage({
        type: "state_changed",
        run_id: "r1",
        from: "a",
        to: "b",
      }),
    ).toBe(true);
  });

  test("accepts run_completed", () => {
    expect(
      isGatewayToClientMessage({
        type: "run_completed",
        run_id: "r1",
        status: "completed",
      }),
    ).toBe(true);
  });

  test("accepts error without run_id", () => {
    expect(isGatewayToClientMessage({ type: "error", message: "oops" })).toBe(true);
  });

  test("accepts error with run_id", () => {
    expect(
      isGatewayToClientMessage({ type: "error", run_id: "r1", message: "oops" }),
    ).toBe(true);
  });

  test("rejects daemon message types", () => {
    expect(
      isGatewayToClientMessage({ type: "register", daemon_id: "d1", capacity: 5 }),
    ).toBe(false);
  });
});

describe("isGatewayToDaemonMessage", () => {
  test("accepts start_run", () => {
    expect(
      isGatewayToDaemonMessage({ type: "start_run", run_id: "r1", workflow: "x.yaml" }),
    ).toBe(true);
  });

  test("accepts start_run with prompt", () => {
    expect(
      isGatewayToDaemonMessage({
        type: "start_run",
        run_id: "r1",
        workflow: "x.yaml",
        prompt: "go",
      }),
    ).toBe(true);
  });

  test("accepts user_input", () => {
    expect(
      isGatewayToDaemonMessage({ type: "user_input", run_id: "r1", input: "yes" }),
    ).toBe(true);
  });

  test("accepts abort_run", () => {
    expect(isGatewayToDaemonMessage({ type: "abort_run", run_id: "r1" })).toBe(true);
  });

  test("rejects client message types", () => {
    expect(isGatewayToDaemonMessage({ type: "create_run", workflow: "x.yaml" })).toBe(
      false,
    );
  });
});

// --- Serialization round-trip tests ---

describe("toJSON / fromJSON round-trip", () => {
  test("ClientToGateway: create_run", () => {
    const msg: ClientToGateway = {
      type: "create_run",
      workflow: "my.yaml",
      run_id: "r1",
    };
    const json = toJSON(msg);
    expect(typeof json).toBe("string");
    const parsed = fromJSON(json);
    expect(parsed).toEqual(msg);
  });

  test("ClientToGateway: user_input", () => {
    const msg: ClientToGateway = { type: "user_input", run_id: "r1", input: "yes" };
    const json = toJSON(msg);
    const parsed = fromJSON(json);
    expect(parsed).toEqual(msg);
  });

  test("ClientToGateway: abort_run", () => {
    const msg: ClientToGateway = { type: "abort_run", run_id: "r1" };
    const json = toJSON(msg);
    const parsed = fromJSON(json);
    expect(parsed).toEqual(msg);
  });

  test("ClientToGateway: subscribe", () => {
    const msg: ClientToGateway = { type: "subscribe", run_id: "r1" };
    const json = toJSON(msg);
    const parsed = fromJSON(json);
    expect(parsed).toEqual(msg);
  });

  test("GatewayToClient: run_created", () => {
    const msg: GatewayToClient = { type: "run_created", run_id: "r1" };
    const json = toJSON(msg);
    const parsed = fromJSON(json);
    expect(parsed).toEqual(msg);
  });

  test("GatewayToClient: run_started", () => {
    const msg: GatewayToClient = { type: "run_started", run_id: "r1", state: "init" };
    const json = toJSON(msg);
    const parsed = fromJSON(json);
    expect(parsed).toEqual(msg);
  });

  test("GatewayToClient: agent_output with stream", () => {
    const msg: GatewayToClient = {
      type: "agent_output",
      run_id: "r1",
      content: "hello world",
      stream: true,
    };
    const json = toJSON(msg);
    const parsed = fromJSON(json);
    expect(parsed).toEqual(msg);
  });

  test("GatewayToClient: state_changed", () => {
    const msg: GatewayToClient = {
      type: "state_changed",
      run_id: "r1",
      from: "a",
      to: "b",
    };
    const json = toJSON(msg);
    const parsed = fromJSON(json);
    expect(parsed).toEqual(msg);
  });

  test("GatewayToClient: run_completed", () => {
    const msg: GatewayToClient = {
      type: "run_completed",
      run_id: "r1",
      status: "aborted",
    };
    const json = toJSON(msg);
    const parsed = fromJSON(json);
    expect(parsed).toEqual(msg);
  });

  test("GatewayToClient: error", () => {
    const msg: GatewayToClient = { type: "error", run_id: "r1", message: "bad input" };
    const json = toJSON(msg);
    const parsed = fromJSON(json);
    expect(parsed).toEqual(msg);
  });

  test("DaemonToGateway: register", () => {
    const msg: DaemonToGateway = { type: "register", daemon_id: "d1", capacity: 10 };
    const json = toJSON(msg);
    const parsed = fromJSON(json);
    expect(parsed).toEqual(msg);
  });

  test("DaemonToGateway: agent_ready", () => {
    const msg: DaemonToGateway = { type: "agent_ready", run_id: "r1" };
    const json = toJSON(msg);
    const parsed = fromJSON(json);
    expect(parsed).toEqual(msg);
  });

  test("DaemonToGateway: agent_output", () => {
    const msg: DaemonToGateway = {
      type: "agent_output",
      run_id: "r1",
      content: "output",
    };
    const json = toJSON(msg);
    const parsed = fromJSON(json);
    expect(parsed).toEqual(msg);
  });

  test("DaemonToGateway: run_completed", () => {
    const msg: DaemonToGateway = {
      type: "run_completed",
      run_id: "r1",
      status: "completed",
    };
    const json = toJSON(msg);
    const parsed = fromJSON(json);
    expect(parsed).toEqual(msg);
  });

  test("GatewayToDaemon: start_run", () => {
    const msg: GatewayToDaemon = {
      type: "start_run",
      run_id: "r1",
      workflow: "x.yaml",
      prompt: "go",
    };
    const json = toJSON(msg);
    const parsed = fromJSON(json);
    expect(parsed).toEqual(msg);
  });

  test("GatewayToDaemon: user_input", () => {
    const msg: GatewayToDaemon = { type: "user_input", run_id: "r1", input: "yes" };
    const json = toJSON(msg);
    const parsed = fromJSON(json);
    expect(parsed).toEqual(msg);
  });

  test("GatewayToDaemon: abort_run", () => {
    const msg: GatewayToDaemon = { type: "abort_run", run_id: "r1" };
    const json = toJSON(msg);
    const parsed = fromJSON(json);
    expect(parsed).toEqual(msg);
  });

  test("fromJSON throws on invalid JSON", () => {
    expect(() => fromJSON("not json")).toThrow();
  });
});
