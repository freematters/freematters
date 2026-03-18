import { describe, expect, test } from "vitest";
import { MessageBus } from "../../e2e/message-bus.js";

describe("MessageBus", () => {
  describe("appendOutput + enqueueTurnComplete", () => {
    test("accumulated output is included in turn_complete event", async () => {
      const bus = new MessageBus();
      bus.appendOutput("hello");
      bus.appendOutput("world");
      bus.enqueueTurnComplete();

      const event = await bus.waitForEvent(1000);
      expect(event.type).toBe("turn_complete");
      if (event.type === "turn_complete") {
        expect(event.output).toBe("hello\nworld");
      }
    });

    test("waitForEvent blocks until turn_complete is enqueued", async () => {
      const bus = new MessageBus();
      setTimeout(() => {
        bus.appendOutput("delayed");
        bus.enqueueTurnComplete();
      }, 10);

      const event = await bus.waitForEvent(5000);
      expect(event.type).toBe("turn_complete");
      if (event.type === "turn_complete") {
        expect(event.output).toContain("delayed");
      }
    });
  });

  describe("enqueueInputRequest blocks until resolveInput", () => {
    test("enqueueInputRequest returns input text after resolveInput", async () => {
      const bus = new MessageBus();
      const inputPromise = bus.enqueueInputRequest("What?");

      setTimeout(() => bus.resolveInput("Answer"), 10);

      const result = await inputPromise;
      expect(result).toBe("Answer");
    });
  });

  describe("waitForEvent returns input_request with accumulated output", () => {
    test("accumulated output is included in input_request event", async () => {
      const bus = new MessageBus();
      bus.appendOutput("Setting up...");
      bus.appendOutput("Ready.");

      bus.enqueueInputRequest("Enter name:");

      const event = await bus.waitForEvent(1000);
      expect(event.type).toBe("input_request");
      if (event.type === "input_request") {
        expect(event.prompt).toBe("Enter name:");
        expect(event.output).toBe("Setting up...\nReady.");
      }

      bus.resolveInput("test");
    });
  });

  describe("waitForEvent returns exited with accumulated output", () => {
    test("markExited pushes exited event with accumulated output", async () => {
      const bus = new MessageBus();
      bus.appendOutput("line 1");
      bus.appendOutput("line 2");
      bus.markExited(0);

      const event = await bus.waitForEvent(1000);
      expect(event.type).toBe("exited");
      if (event.type === "exited") {
        expect(event.code).toBe(0);
        expect(event.output).toBe("line 1\nline 2");
      }
    });
  });

  describe("waitForEvent timeout", () => {
    test("rejects with timeout error when no event arrives", async () => {
      const bus = new MessageBus();
      await expect(bus.waitForEvent(50)).rejects.toThrow("timeout");
    });
  });

  describe("resolveInput errors when no request pending", () => {
    test("throws when no input request is pending", () => {
      const bus = new MessageBus();
      expect(() => bus.resolveInput("text")).toThrow("No input request pending");
    });
  });

  describe("accumulated output drains between events", () => {
    test("output accumulates separately for each event", async () => {
      const bus = new MessageBus();
      bus.appendOutput("A");
      bus.appendOutput("B");
      bus.enqueueTurnComplete();

      bus.appendOutput("C");
      bus.markExited(0);

      const event1 = await bus.waitForEvent(1000);
      expect(event1.type).toBe("turn_complete");
      if (event1.type === "turn_complete") {
        expect(event1.output).toBe("A\nB");
      }

      const event2 = await bus.waitForEvent(1000);
      expect(event2.type).toBe("exited");
      if (event2.type === "exited") {
        expect(event2.output).toBe("C");
      }
    });
  });
});
