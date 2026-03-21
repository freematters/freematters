/**
 * E2E test for verify-runner session log symlinking.
 *
 * Calls verifyCore() directly. Mocks only query() (Agent SDK) since we can't
 * launch real Claude sessions in tests. The mock simulates what the verifier
 * agent would do: create the FSM run dir via the real fflow CLI.
 * Everything else — symlink creation, session dir convention, filesystem — is real.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { getSessionDir } from "../session-log.js";

const CLI = resolve(__dirname, "../../dist/cli.js");
const VERIFIER_FSM = resolve(__dirname, "../../workflows/verifier/workflow.yaml");

let tmp: string;
let fsmRoot: string;
let testDir: string;
let planPath: string;

const VERIFIER_SESSION_ID = "verifier-sess-test-abc123";
const EMBEDDED_SESSION_ID = "embedded-sess-test-def456";

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "freeflow-verify-e2e-"));
  fsmRoot = join(tmp, "freeflow-root");
  testDir = join(tmp, "test-output");
  mkdirSync(testDir, { recursive: true });

  // Minimal test plan (verifyCore just needs a file that exists)
  planPath = join(tmp, "plan.md");
  writeFileSync(
    planPath,
    "# Test: stub\n\n## Steps\n1. **noop**: noop\n   - Expected: noop\n\n## Expected Outcomes\n- noop\n",
  );

  // Create session JSONL files at the deterministic path
  const sessionDir = getSessionDir(process.cwd());
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, `${VERIFIER_SESSION_ID}.jsonl`), '{"type":"init"}\n');
  writeFileSync(join(sessionDir, `${EMBEDDED_SESSION_ID}.jsonl`), '{"type":"init"}\n');
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// Mock query() — the only thing we can't run for real
vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@anthropic-ai/claude-agent-sdk")>();
  return {
    ...original,
    query: vi.fn(({ prompt }: { prompt: string }) => {
      // Extract the run ID from the prompt (verifyCore puts --run-id <id> in it)
      const runIdMatch = /--run-id\s+(\S+)/.exec(prompt);
      const runId = runIdMatch?.[1];

      // Simulate what the verifier agent does: create the FSM run
      if (runId) {
        execFileSync(
          "node",
          [CLI, "start", VERIFIER_FSM, "--run-id", runId, "--root", fsmRoot],
          { encoding: "utf-8", env: { ...process.env, FREEFLOW_ROOT: fsmRoot } },
        );
      }

      // Return an async iterable that yields init + result messages.
      // Note: SDKSystemMessage (init) does NOT carry session_id.
      // session_id comes on assistant/result messages.
      const messages = [
        { type: "system", subtype: "init" },
        {
          type: "result",
          subtype: "success",
          result: "done",
          is_error: false,
          session_id: VERIFIER_SESSION_ID,
        },
      ];

      let index = 0;
      const iterable = {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              if (index < messages.length) {
                return { value: messages[index++], done: false };
              }
              return { value: undefined, done: true };
            },
          };
        },
        close() {},
      };
      return iterable;
    }),
  };
});

// Mock createVerifierMcpServer to return a stub with embeddedSessionId
vi.mock("../e2e/verifier-tools.js", () => ({
  createVerifierMcpServer: () => {
    let _embeddedSessionId: string | null = null;
    return {
      get embeddedSessionId() {
        return _embeddedSessionId;
      },
      closeSession() {
        // Simulate: embedded agent had this session ID
        _embeddedSessionId = EMBEDDED_SESSION_ID;
      },
    };
  },
}));

describe("verifyCore session log symlinking (e2e)", () => {
  beforeEach(() => {
    process.env.FREEFLOW_ROOT = fsmRoot;
  });

  afterEach(() => {
    process.env.FREEFLOW_ROOT = undefined;
  });

  test("creates verifier-session.jsonl, executor-session.jsonl symlinks and test plan copy in verifier run dir", async () => {
    const { verifyCore } = await import("../e2e/verify-runner.js");

    await verifyCore({ planPath, testDir, root: fsmRoot });

    // Find the verifier run dir (verifyCore generates verifier-<timestamp>)
    const { readdirSync } = await import("node:fs");
    const runsDir = join(fsmRoot, "runs");
    const runDirs = readdirSync(runsDir).filter((d) => d.startsWith("verifier-"));
    expect(runDirs.length).toBeGreaterThanOrEqual(1);

    const runDir = join(runsDir, runDirs[runDirs.length - 1]);
    const sessionLink = join(runDir, "verifier-session.jsonl");
    const embeddedLink = join(runDir, "executor-session.jsonl");

    // Both symlinks must exist
    expect(existsSync(sessionLink)).toBe(true);
    expect(existsSync(embeddedLink)).toBe(true);

    // Both must be symlinks (not copies)
    expect(lstatSync(sessionLink).isSymbolicLink()).toBe(true);
    expect(lstatSync(embeddedLink).isSymbolicLink()).toBe(true);

    // Test plan copy must exist
    const { basename } = await import("node:path");
    const planCopy = join(runDir, basename(planPath));
    expect(existsSync(planCopy)).toBe(true);

    // Symlinks point to the correct session JSONL files
    const sessionDir = getSessionDir(process.cwd());
    expect(readlinkSync(sessionLink)).toBe(
      join(sessionDir, `${VERIFIER_SESSION_ID}.jsonl`),
    );
    expect(readlinkSync(embeddedLink)).toBe(
      join(sessionDir, `${EMBEDDED_SESSION_ID}.jsonl`),
    );
  });
});
