import { describe, expect, test } from "vitest";
import { greet } from "../greet.js";

describe("greet", () => {
  test('greet("World") returns "Hello, World!"', () => {
    expect(greet("World")).toBe("Hello, World!");
  });

  test('greet("Alice") returns "Hello, Alice!"', () => {
    expect(greet("Alice")).toBe("Hello, Alice!");
  });
});
