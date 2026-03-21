import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { loadFsm } from "../../fsm.js";

const VERIFIER_FSM = resolve(__dirname, "../../../workflows/verifier/workflow.yaml");

describe("verifier.workflow.yaml", () => {
  test("loads and validates against FSM schema", () => {
    const fsm = loadFsm(VERIFIER_FSM);
    expect(fsm.states).toHaveProperty("verify");
    expect(fsm.states).toHaveProperty("done");
    expect(fsm.states.done.transitions).toEqual({});
  });
});
