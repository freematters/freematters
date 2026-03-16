import { describe, expect, test } from "vitest";
import { greet } from "../greet.js";

describe("greet", () => {
  test('greet("World") returns "Hello, World!"', () => {
    expect(greet("World")).toBe("Hello, World!");
  });

  test('greet("Alice") returns "Hello, Alice!"', () => {
    expect(greet("Alice")).toBe("Hello, Alice!");
  });

  test('greet("World", { uppercase: true }) returns "HELLO, WORLD!"', () => {
    expect(greet("World", { uppercase: true })).toBe("HELLO, WORLD!");
  });

  test('greet("World", { uppercase: false }) returns "Hello, World!"', () => {
    expect(greet("World", { uppercase: false })).toBe("Hello, World!");
  });
});
