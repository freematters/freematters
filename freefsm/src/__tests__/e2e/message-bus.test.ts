import { describe, expect, test } from "vitest";
import { MessageBus } from "../../e2e/message-bus.js";
import type { BusEvent } from "../../e2e/message-bus.js";

describe("MessageBus", () => {
  describe("enqueueOutput + waitForEvent", () => {
    test("returns output event in FIFO order", async () => {
      const bus = new MessageBus();
      bus.enqueueOutput("hello");
      bus.enqueueOutput("world");

      const e1 = await bus.waitForEvent(1000);
      expect(e1).toEqual({ type: "output", text: "hello" });

      const e2 = await bus.waitForEvent(1000);
      expect(e2).toEqual({ type: "output", text: "world" });
    });

    test("waitForEvent blocks until output is enqueued", async () => {
      const bus = new MessageBus();

      const promise = bus.waitForEvent(5000);
      // Enqueue after a short delay
      setTimeout(() => bus.enqueueOutput("delayed"), 10);

      const event = await promise;
      expect(event).toEqual({ type: "output", text: "delayed" });
    });
  });

  describe("enqueueInputRequest + resolveInput", () => {
    test("enqueueInputRequest blocks until resolveInput is called", async () => {
      const bus = new MessageBus();

      const inputPromise = bus.enqueueInputRequest("What is your name?");
      // Resolve after a short delay
      setTimeout(() => bus.resolveInput("Alice"), 10);

      const result = await inputPromise;
      expect(result).toBe("Alice");
    });

    test("waitForEvent returns input_request event when input is requested", async () => {
      const bus = new MessageBus();

      // Start input request (don't await — it blocks until resolved)
      bus.enqueueInputRequest("Enter value:");

      const event = await bus.waitForEvent(1000);
      expect(event.type).toBe("input_request");
      if (event.type === "input_request") {
        expect(event.prompt).toBe("Enter value:");
      }
    });

    test("input_request event includes accumulated output", async () => {
      const bus = new MessageBus();

      bus.enqueueOutput("Setting up...");
      bus.enqueueOutput("Ready.");

      // Consume the output events first
      await bus.waitForEvent(1000);
      await bus.waitForEvent(1000);

      bus.enqueueOutput("More output before input");
      bus.enqueueInputRequest("Enter value:");

      // The next waitForEvent should show the output event first
      const outputEvent = await bus.waitForEvent(1000);
      expect(outputEvent.type).toBe("output");

      const inputEvent = await bus.waitForEvent(1000);
      expect(inputEvent.type).toBe("input_request");
      if (inputEvent.type === "input_request") {
        expect(inputEvent.prompt).toBe("Enter value:");
        expect(inputEvent.output).toBe("More output before input");
      }
    });
  });

  describe("markExited", () => {
    test("waitForEvent returns exited event after markExited", async () => {
      const bus = new MessageBus();

      bus.markExited(0);

      const event = await bus.waitForEvent(1000);
      expect(event).toEqual({ type: "exited", code: 0, output: "" });
    });

    test("exited event includes accumulated output", async () => {
      const bus = new MessageBus();

      bus.enqueueOutput("line 1");
      bus.enqueueOutput("line 2");

      // Consume the output events
      await bus.waitForEvent(1000);
      await bus.waitForEvent(1000);

      // More output then exit
      bus.enqueueOutput("final output");
      bus.markExited(0);

      // Output event first
      const outputEvent = await bus.waitForEvent(1000);
      expect(outputEvent.type).toBe("output");

      const exitEvent = await bus.waitForEvent(1000);
      expect(exitEvent.type).toBe("exited");
      if (exitEvent.type === "exited") {
        expect(exitEvent.code).toBe(0);
        expect(exitEvent.output).toBe("final output");
      }
    });

    test("exited event with non-zero code", async () => {
      const bus = new MessageBus();
      bus.markExited(1);

      const event = await bus.waitForEvent(1000);
      expect(event.type).toBe("exited");
      if (event.type === "exited") {
        expect(event.code).toBe(1);
      }
    });
  });

  describe("timeout", () => {
    test("waitForEvent rejects when timeout expires with no events", async () => {
      const bus = new MessageBus();

      await expect(bus.waitForEvent(50)).rejects.toThrow("timeout");
    });
  });

  describe("multiple enqueueOutput accumulate in output field", () => {
    test("accumulated output appears in input_request event", async () => {
      const bus = new MessageBus();

      bus.enqueueOutput("A");
      bus.enqueueOutput("B");
      bus.enqueueInputRequest("Prompt:");

      // Consume the two output events
      await bus.waitForEvent(1000);
      await bus.waitForEvent(1000);

      const event = await bus.waitForEvent(1000);
      expect(event.type).toBe("input_request");
      if (event.type === "input_request") {
        expect(event.output).toBe("A\nB");
      }
    });

    test("accumulated output appears in exited event", async () => {
      const bus = new MessageBus();

      bus.enqueueOutput("X");
      bus.enqueueOutput("Y");
      bus.enqueueOutput("Z");
      bus.markExited(0);

      // Consume the three output events
      await bus.waitForEvent(1000);
      await bus.waitForEvent(1000);
      await bus.waitForEvent(1000);

      const event = await bus.waitForEvent(1000);
      expect(event.type).toBe("exited");
      if (event.type === "exited") {
        expect(event.code).toBe(0);
        expect(event.output).toBe("X\nY\nZ");
      }
    });
  });

  describe("resolveInput error handling", () => {
    test("resolveInput throws when no input request is pending", () => {
      const bus = new MessageBus();
      expect(() => bus.resolveInput("something")).toThrow();
    });
  });
});
