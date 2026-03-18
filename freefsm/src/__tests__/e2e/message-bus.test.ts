import { describe, expect, test } from "vitest";
import { MessageBus } from "../../e2e/message-bus.js";

describe("MessageBus", () => {
  describe("completeTurn + waitForMessage", () => {
    test("turn_complete event is received via waitForMessage", async () => {
      const bus = new MessageBus();
      bus.appendOutput("hello");
      bus.completeTurn();

      const msg = await bus.waitForMessage(1000);
      expect(msg).toEqual({ type: "turn_complete", output: "hello" });
    });

    test("waitForMessage blocks until completeTurn is called", async () => {
      const bus = new MessageBus();
      setTimeout(() => {
        bus.appendOutput("delayed");
        bus.completeTurn();
      }, 10);

      const msg = await bus.waitForMessage(5000);
      expect(msg).toEqual({ type: "turn_complete", output: "delayed" });
    });

    test("multiple turns are queued and consumed in order", async () => {
      const bus = new MessageBus();
      bus.appendOutput("first");
      bus.completeTurn();
      bus.appendOutput("second");
      bus.completeTurn();

      const msg1 = await bus.waitForMessage(1000);
      const msg2 = await bus.waitForMessage(1000);
      expect(msg1).toEqual({ type: "turn_complete", output: "first" });
      expect(msg2).toEqual({ type: "turn_complete", output: "second" });
    });

    test("multiple appendOutput calls are joined with newline on completeTurn", async () => {
      const bus = new MessageBus();
      bus.appendOutput("line1");
      bus.appendOutput("line2");
      bus.completeTurn();

      const msg = await bus.waitForMessage(1000);
      expect(msg).toEqual({ type: "turn_complete", output: "line1\nline2" });
    });
  });

  describe("post + waitForPrompt", () => {
    test("posted message is received via waitForPrompt", async () => {
      const bus = new MessageBus();
      bus.post("input text");

      const prompt = await bus.waitForPrompt(1000);
      expect(prompt).toBe("input text");
    });

    test("waitForPrompt blocks until post is called", async () => {
      const bus = new MessageBus();
      setTimeout(() => bus.post("delayed input"), 10);

      const prompt = await bus.waitForPrompt(5000);
      expect(prompt).toBe("delayed input");
    });

    test("multiple posts before waitForPrompt are consumed in order", async () => {
      const bus = new MessageBus();
      bus.post("a");
      bus.post("b");

      const first = await bus.waitForPrompt(1000);
      const second = await bus.waitForPrompt(1000);
      expect(first).toBe("a");
      expect(second).toBe("b");
    });
  });

  describe("timeouts", () => {
    test("waitForMessage rejects on timeout", async () => {
      const bus = new MessageBus();
      await expect(bus.waitForMessage(50)).rejects.toThrow("timeout");
    });

    test("waitForPrompt rejects on timeout", async () => {
      const bus = new MessageBus();
      await expect(bus.waitForPrompt(50)).rejects.toThrow("timeout");
    });
  });
});
