import { cn } from "@/lib/utils";
import { useWorkflowAnimation } from "../../hooks/use-workflow-animation";
import { StateGraph } from "./StateGraph";
import { TerminalPanel } from "./TerminalPanel";
import { YamlPanel } from "./YamlPanel";

export function HeroSection() {
  const anim = useWorkflowAnimation();

  return (
    <>
      {/* Aurora ribbons — only visible on aurora theme via CSS */}
      <div className="ribbon ribbon-1" />
      <div className="ribbon ribbon-2" />
      <div className="ribbon ribbon-3" />

      {/* Hero text */}
      <div
        className={cn(
          "relative z-[1] mx-auto max-w-[1280px]",
          "px-10 pt-14 text-center",
        )}
      >
        <div
          className={cn(
            "mb-[14px] text-[0.72rem] font-medium uppercase",
            "font-mono tracking-[0.12em] text-[var(--accent)]",
          )}
        >
          AGENT WORKFLOW ENGINE
        </div>

        <h1
          className={cn(
            "mx-auto mb-4 max-w-[640px]",
            "font-heading text-foreground",
            "font-bold leading-[1.05] tracking-[-0.03em]",
          )}
          style={{ fontSize: "clamp(2.4rem, 4vw, 3.6rem)" }}
        >
          Define once,
          <br />
          agents execute.
        </h1>

        <p className="mx-auto mb-[22px] max-w-[540px] text-base leading-[1.6] text-muted-foreground">
          YAML defines the path. Hooks keep agents on track. Humans decide at
          checkpoints.
        </p>

        <div className="flex flex-col items-center gap-4">
          <div
            className={cn(
              "flex items-center gap-3 rounded-lg px-5 py-2.5",
              "bg-[var(--bg2)] border border-[var(--border)]",
            )}
          >
            <span className="font-mono text-[13px] text-muted-foreground">$</span>
            <span className="font-mono text-[13px] text-foreground">npx freeflow init</span>
          </div>
        </div>
      </div>

      {/* Two-column panel */}
      <div
        className={cn(
          "relative z-[1] mx-auto mt-8 flex max-w-[1280px]",
          "h-[480px] px-10",
        )}
      >
        {/* Left: YAML + Terminal */}
        <div
          className={cn(
            "flex min-w-0 flex-1 flex-col overflow-hidden",
            "rounded-l-[10px] border border-[var(--border)]",
          )}
        >
          <YamlPanel activeState={anim.activeYamlState} />
          <TerminalPanel
            lines={anim.terminalLines}
            reasoningText={anim.reasoningText}
            isTyping={anim.isTyping}
            branchState={anim.branchState}
            branchOptions={anim.branchOptions}
            onBranchChoice={anim.onBranchChoice}
            chosenBranch={anim.chosenBranch}
            onRestart={anim.start}
          />
        </div>

        {/* Right: State graph */}
        <div
          className={cn(
            "flex min-w-0 flex-1 items-center justify-center",
            "rounded-r-[10px] border border-l-0 border-[var(--border)]",
            "bg-[var(--bg2)] px-8 py-10",
          )}
        >
          <StateGraph
            ref={anim.graphRef}
            currentState={anim.currentState}
            completedStates={anim.completedStates}
            activeEdge={anim.activeEdge}
          />
        </div>
      </div>
    </>
  );
}
