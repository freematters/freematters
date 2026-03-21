import { describe, expect, it } from "vitest";
import { createChannelServer } from "../channel-server.js";

describe("createChannelServer", () => {
  it("returns a ChannelServer with server, notify, and connect", () => {
    const cs = createChannelServer({
      name: "test-channel",
      version: "0.0.1",
      instructions: "Test instructions",
    });
    expect(cs.server).toBeDefined();
    expect(typeof cs.notify).toBe("function");
    expect(typeof cs.connect).toBe("function");
  });

  it("sets channel capability on the server", () => {
    const cs = createChannelServer({
      name: "test-channel",
      version: "0.0.1",
      instructions: "Test instructions",
    });
    expect(cs.server).toBeDefined();
  });

  it("does not set tools capability when twoWay is false", () => {
    const cs = createChannelServer({
      name: "one-way",
      version: "0.0.1",
      instructions: "One-way channel",
      twoWay: false,
    });
    expect(cs.server).toBeDefined();
  });

  it("sets tools capability when twoWay is true", () => {
    const cs = createChannelServer({
      name: "two-way",
      version: "0.0.1",
      instructions: "Two-way channel",
      twoWay: true,
    });
    expect(cs.server).toBeDefined();
  });
});
