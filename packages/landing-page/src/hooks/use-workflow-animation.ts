import { useCallback, useEffect, useRef, useState } from "react";
import { STATES, yamlLines } from "../data/workflow-states";

export interface TerminalLine {
  id: number;
  text: string;
  className: string;
  html?: string;
}

export interface StateGraphHandle {
  animateDot(edgeKey: string): Promise<void>;
}

type Phase = "idle" | "running";
type BranchState = null | "pending" | string;

export interface WorkflowAnimationState {
  phase: Phase;
  currentState: string | null;
  completedStates: Set<string>;
  terminalLines: TerminalLine[];
  reasoningText: string;
  isTyping: boolean;
  activeYamlState: string | null;
  branchState: BranchState;
  branchOptions: string[];
  chosenBranch: string | null;
  activeEdge: string | null;
}

export interface WorkflowAnimationActions {
  start(): void;
  onBranchChoice(choice: string): void;
  graphRef: React.RefObject<StateGraphHandle | null>;
}

let lineIdCounter = 0;
function makeId() {
  return ++lineIdCounter;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function useWorkflowAnimation(): WorkflowAnimationState &
  WorkflowAnimationActions {
  const [phase, setPhase] = useState<Phase>("idle");
  const [currentState, setCurrentState] = useState<string | null>(null);
  const [completedStates, setCompletedStates] = useState<Set<string>>(new Set());
  const [terminalLines, setTerminalLines] = useState<TerminalLine[]>([]);
  const [reasoningText, setReasoningText] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [activeYamlState, setActiveYamlState] = useState<string | null>(null);
  const [branchState, setBranchState] = useState<BranchState>(null);
  const [branchOptions, setBranchOptions] = useState<string[]>([]);
  const [chosenBranch, setChosenBranch] = useState<string | null>(null);
  const [activeEdge, setActiveEdge] = useState<string | null>(null);

  const runIdRef = useRef(0);
  const branchResolveRef = useRef<((choice: string) => void) | null>(null);
  const graphRef = useRef<StateGraphHandle | null>(null);

  const addLine = useCallback((text: string, className: string) => {
    setTerminalLines((prev) => [...prev, { id: makeId(), text, className }]);
  }, []);

  const addHtmlLine = useCallback((html: string) => {
    setTerminalLines((prev) => [
      ...prev,
      { id: makeId(), text: "", className: "", html },
    ]);
  }, []);

  const typeReasoning = useCallback((text: string, myId: number): Promise<void> => {
    return new Promise<void>((resolve) => {
      setReasoningText("");
      setIsTyping(true);
      let idx = 0;
      const iv = setInterval(() => {
        if (runIdRef.current !== myId) {
          clearInterval(iv);
          setIsTyping(false);
          resolve();
          return;
        }
        if (idx < text.length) {
          idx++;
          setReasoningText(text.slice(0, idx));
        } else {
          clearInterval(iv);
          setIsTyping(false);
          resolve();
        }
      }, 14);
    });
  }, []);

  const addStateCard = useCallback(
    (name: string, prompt: string, transitions: [string, string][]) => {
      const tr = transitions
        .map(
          ([label]) =>
            `<div class="sc-tr-row"><span class="arr">\u2192</span> ${label}</div>`,
        )
        .join("");
      const html = `<div class="state-card"><div class="sc-name">\u25CF ${name}</div><div class="sc-sec">// Your instructions</div><div class="sc-prompt">${prompt}</div><div class="sc-sec">// Transitions</div>${tr}</div>`;
      addHtmlLine(html);
    },
    [addHtmlLine],
  );

  const showBranchPrompt = useCallback((myId: number): Promise<string> => {
    return new Promise<string>((resolve) => {
      const analyzeState = STATES.analyze;
      const options = Object.keys(analyzeState.transitions);
      setBranchOptions(options);
      setBranchState("pending");
      setChosenBranch(null);

      branchResolveRef.current = resolve;

      // Auto-select after 5s
      const timer = setTimeout(() => {
        if (runIdRef.current !== myId) return;
        if (branchResolveRef.current === resolve) {
          branchResolveRef.current = null;
          setChosenBranch(options[0]);
          setBranchState(options[0]);
          resolve(STATES.analyze.transitions[options[0]]);
        }
      }, 5000);

      // Store timer cleanup alongside resolve so manual click can cancel it
      const originalResolve = resolve;
      branchResolveRef.current = (choice: string) => {
        clearTimeout(timer);
        originalResolve(choice);
      };
    });
  }, []);

  const onBranchChoice = useCallback((choice: string) => {
    if (branchResolveRef.current) {
      const analyzeState = STATES.analyze;
      const nextState = analyzeState.transitions[choice];
      setChosenBranch(choice);
      setBranchState(choice);
      const fn = branchResolveRef.current;
      branchResolveRef.current = null;
      fn(nextState);
    }
  }, []);

  const transTo = useCallback(async (from: string, edgeKey: string, myId: number) => {
    setActiveEdge(edgeKey);
    if (graphRef.current) {
      await graphRef.current.animateDot(edgeKey);
    }
    if (runIdRef.current !== myId) return;
    setActiveEdge(null);
    setCompletedStates((prev) => new Set([...prev, from]));
  }, []);

  const showState = useCallback(
    async (name: string, myId: number) => {
      setActiveYamlState(name);
      setCurrentState(name);
      const st = STATES[name];
      if (st.prompt) {
        addStateCard(name, st.prompt, Object.entries(st.transitions));
      }
      // Flush reasoning before typing
      setReasoningText("");
      await typeReasoning(st.reasoning, myId);
    },
    [addStateCard, typeReasoning],
  );

  const start = useCallback(() => {
    const myId = ++runIdRef.current;

    // Reset all state
    setPhase("running");
    setCurrentState(null);
    setCompletedStates(new Set());
    setTerminalLines([]);
    setReasoningText("");
    setIsTyping(false);
    setActiveYamlState(null);
    setBranchState(null);
    setBranchOptions([]);
    setChosenBranch(null);
    setActiveEdge(null);
    branchResolveRef.current = null;

    async function run() {
      await sleep(400);
      if (runIdRef.current !== myId) return;

      addLine("$ fflow start code-review", "t-cmd");
      await sleep(300);
      if (runIdRef.current !== myId) return;

      addLine("\u2713 Initialized \u00B7 4 states \u00B7 deterministic", "t-ok");
      await sleep(500);
      if (runIdRef.current !== myId) return;

      // ── read state ──
      await showState("read", myId);
      if (runIdRef.current !== myId) return;
      await sleep(800);
      if (runIdRef.current !== myId) return;
      addLine("fflow\u2192 Scanning src/auth/session.ts...", "t-dim");
      await sleep(600);
      if (runIdRef.current !== myId) return;
      addLine("fflow\u2192 312 lines \u00B7 8 functions \u00B7 2 classes", "t-ok");
      await sleep(700);
      if (runIdRef.current !== myId) return;
      addLine("fflow\u2192 Transition: analyzed", "t-dim");
      await transTo("read", "read->analyze", myId);
      if (runIdRef.current !== myId) return;

      // ── analyze state ──
      await showState("analyze", myId);
      if (runIdRef.current !== myId) return;
      await sleep(800);
      if (runIdRef.current !== myId) return;
      addLine("fflow\u2192 Running analysis...", "t-dim");
      await sleep(500);
      if (runIdRef.current !== myId) return;
      addLine("\u26A0 3 issues found", "t-warn");
      await sleep(250);
      if (runIdRef.current !== myId) return;
      addLine("  \u00B7 SQL injection risk on line 47", "t-dim");
      await sleep(200);
      if (runIdRef.current !== myId) return;
      addLine("  \u00B7 Missing error boundary in UserCard", "t-dim");
      await sleep(200);
      if (runIdRef.current !== myId) return;
      addLine("  \u00B7 Unused import: lodash/debounce", "t-dim");
      await sleep(600);
      if (runIdRef.current !== myId) return;

      const chosenTarget = await showBranchPrompt(myId);
      if (runIdRef.current !== myId) return;
      await sleep(400);
      if (runIdRef.current !== myId) return;

      if (chosenTarget === "feedback") {
        addLine("fflow\u2192 Transition: found issues", "t-dim");
        await transTo("analyze", "analyze->feedback", myId);
        if (runIdRef.current !== myId) return;

        await showState("feedback", myId);
        if (runIdRef.current !== myId) return;
        await sleep(700);
        if (runIdRef.current !== myId) return;
        addLine("fflow\u2192 Posting review comments...", "t-dim");
        await sleep(500);
        if (runIdRef.current !== myId) return;
        addLine('Developer: "Fix SQL injection. Others are low priority."', "t-reason");
        await sleep(600);
        if (runIdRef.current !== myId) return;
        addLine("fflow\u2192 Acknowledged. Transition: review posted", "t-ok");
        await transTo("feedback", "feedback->done", myId);
        if (runIdRef.current !== myId) return;
      } else {
        addLine("fflow\u2192 Transition: looks good", "t-dim");
        await transTo("analyze", "analyze->done", myId);
        if (runIdRef.current !== myId) return;
      }

      // ── done state ──
      await showState("done", myId);
      if (runIdRef.current !== myId) return;
      await sleep(700);
      if (runIdRef.current !== myId) return;
      addLine("fflow\u2192 Writing report...", "t-dim");
      await sleep(500);
      if (runIdRef.current !== myId) return;
      addLine("\u2713 ./review-2026-04-09.md written", "t-ok");
      addLine("fflow\u2192 Workflow complete", "t-ok");

      await sleep(5000);
      if (runIdRef.current !== myId) return;

      // Auto-restart
      start();
    }

    run();
  }, [addLine, showState, showBranchPrompt, transTo]);

  // Auto-start on mount
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once on mount
  useEffect(() => {
    start();
  }, []);

  return {
    phase,
    currentState,
    completedStates,
    terminalLines,
    reasoningText,
    isTyping,
    activeYamlState,
    branchState,
    branchOptions,
    chosenBranch,
    activeEdge,
    start,
    onBranchChoice,
    graphRef,
  };
}

export { yamlLines };
