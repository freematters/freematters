import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { FsmError, loadFsm } from "../fsm.js";

// biome-ignore lint/style/noNonNullAssertion: dirname is always defined for file modules
const FIXTURES = join(import.meta.dirname!, "fixtures", "legacy-removal");

function fixture(name: string): string {
  return join(FIXTURES, name);
}

// T15a — `from:` on a state is a hard error at v1.4.
describe("legacy removal — from: hard error", () => {
  test("v1.4 workflow with state.from throws SCHEMA_INVALID pointing at extends", () => {
    try {
      loadFsm(fixture("from-v14.workflow.yaml"));
      expect.fail("expected loadFsm to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(FsmError);
      expect((e as FsmError).code).toBe("SCHEMA_INVALID");
      expect((e as FsmError).message).toMatch(/from.*no longer supported.*extends/i);
    }
  });
});

// T15b — `extends_guide:` at the top level is a hard error.
describe("legacy removal — extends_guide: hard error", () => {
  test("workflow with top-level extends_guide throws SCHEMA_INVALID pointing at extends", () => {
    try {
      loadFsm(fixture("extends-guide.workflow.yaml"));
      expect.fail("expected loadFsm to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(FsmError);
      expect((e as FsmError).code).toBe("SCHEMA_INVALID");
      expect((e as FsmError).message).toMatch(
        /extends_guide.*no longer supported.*extends/i,
      );
    }
  });
});

// T15c — `from:` error fires independent of version gate.
describe("legacy removal — from: version independence", () => {
  test("v1.0 workflow with state.from still throws SCHEMA_INVALID", () => {
    try {
      loadFsm(fixture("from-v10.workflow.yaml"));
      expect.fail("expected loadFsm to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(FsmError);
      expect((e as FsmError).code).toBe("SCHEMA_INVALID");
      expect((e as FsmError).message).toMatch(/from.*no longer supported.*extends/i);
    }
  });
});

// T16 — `{{base}}` placeholder is no longer substituted anywhere.
describe("legacy removal — {{base}} no longer substituted", () => {
  test("literal {{base}} in guide and prompt is preserved verbatim", () => {
    const fsm = loadFsm(fixture("base-literal.workflow.yaml"));
    expect(fsm.guide).toBe("Guide with literal {{base}} token.");
    expect(fsm.states.start.prompt).toBe("Prompt containing {{base}} placeholder.");
  });
});
