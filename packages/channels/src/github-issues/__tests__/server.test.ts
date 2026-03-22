import { describe, expect, it } from "vitest";

describe("github-issues server", () => {
  it("module can be imported without throwing", async () => {
    const mod = await import("../server.js");
    expect(mod).toBeDefined();
  });
});
