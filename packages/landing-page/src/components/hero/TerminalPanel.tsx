import { cn } from "@/lib/utils";
import { useEffect, useRef } from "react";
import type { TerminalLine } from "../../hooks/use-workflow-animation";

interface Props {
  lines: TerminalLine[];
  reasoningText: string;
  isTyping: boolean;
  branchState: null | "pending" | string;
  branchOptions: string[];
  onBranchChoice: (choice: string) => void;
  chosenBranch: string | null;
  onRestart: () => void;
}

function lineClassName(cls: string): string {
  switch (cls) {
    case "t-cmd":
      return "text-foreground";
    case "t-ok":
      return "text-[var(--ok)] font-medium";
    case "t-dim":
      return "text-muted-foreground";
    case "t-warn":
      return "text-[#D4A22A]";
    case "t-reason":
      return "text-muted-foreground italic";
    default:
      return "";
  }
}

export function TerminalPanel({
  lines,
  reasoningText,
  isTyping,
  branchState,
  branchOptions,
  onBranchChoice,
  chosenBranch,
  onRestart,
}: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on content changes
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, reasoningText, branchState]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--term-bg)]">
      {/* Title bar */}
      <div
        className={cn(
          "flex shrink-0 items-center gap-[7px]",
          "border-b border-[var(--term-border)] bg-[var(--term-bar)]",
          "px-[14px] py-[9px]",
        )}
      >
        <span className="inline-block size-[10px] rounded-full bg-[#FF5F57]" />
        <span className="inline-block size-[10px] rounded-full bg-[#FEBC2E]" />
        <span className="inline-block size-[10px] rounded-full bg-[#28C840]" />
        <span className="ml-1.5 text-[11px] font-mono text-muted-foreground opacity-70">
          fflow start code-review
        </span>
        <button
          type="button"
          onClick={onRestart}
          className={cn(
            "ml-auto cursor-pointer p-0.5",
            "text-muted-foreground opacity-60 hover:opacity-100 hover:text-[var(--accent)]",
            "transition-all duration-200",
          )}
          title="Restart"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M1 4v4h4" />
            <path d="M3.51 10a6 6 0 1 0 .49-5L1 8" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div
        ref={bodyRef}
        className={cn(
          "flex-1 overflow-y-auto p-[12px_14px]",
          "font-mono text-xs leading-[1.85]",
          "scroll-smooth",
        )}
        style={{
          scrollbarWidth: "thin",
          scrollbarColor: "var(--term-border) transparent",
        }}
      >
        {lines.map((line) => {
          if (line.html) {
            return (
              // biome-ignore lint/security/noDangerouslySetInnerHtml: state card HTML
              <div key={line.id} dangerouslySetInnerHTML={{ __html: line.html }} />
            );
          }
          return (
            <div key={line.id} className={lineClassName(line.className)}>
              {line.text}
            </div>
          );
        })}

        {/* Live typewriter reasoning line */}
        {(reasoningText || isTyping) && (
          <div className="italic text-muted-foreground">
            {reasoningText}
            {isTyping && (
              <span
                className="ml-0.5 inline-block h-[1em] w-px bg-[var(--accent)] align-text-bottom"
                style={{ animation: "blink .7s step-end infinite" }}
              />
            )}
          </div>
        )}

        {/* Branch buttons */}
        {branchState === "pending" && (
          <>
            <div className="my-[8px_0_4px] text-[10.5px] italic text-muted-foreground">
              Which path should the agent take?
            </div>
            <div className="mb-1.5 flex gap-2">
              {branchOptions.map((opt, i) => {
                const isPicked = chosenBranch === opt;
                const isFaded = chosenBranch !== null && chosenBranch !== opt;
                const isRec = i === 0;

                return (
                  <button
                    type="button"
                    key={opt}
                    onClick={() => onBranchChoice(opt)}
                    className={cn(
                      "relative flex-1 cursor-pointer rounded-[5px] px-3 py-[5px]",
                      "font-mono text-[11px] transition-all duration-200",
                      isPicked ? "text-[var(--accent)]" : "text-foreground",
                    )}
                    style={{
                      border: `1px solid ${isPicked || isRec ? "var(--accent)" : "color-mix(in srgb, var(--accent) 40%, transparent)"}`,
                      background: isPicked
                        ? "color-mix(in srgb, var(--accent) 15%, transparent)"
                        : "transparent",
                      opacity: isFaded ? 0.3 : 1,
                      textDecoration: isFaded ? "line-through" : "none",
                      pointerEvents: isFaded ? "none" : "auto",
                      animation:
                        isFaded || isPicked
                          ? "none"
                          : `branchSlideIn .3s ease-out ${i * 0.08}s both, branchPulse 2s ease-in-out ${0.6 + i * 0.08}s infinite`,
                    }}
                  >
                    {isRec && !isPicked && !isFaded && (
                      <span className="absolute -right-[3px] -top-[3px] size-1.5 rounded-full bg-[var(--accent)]" />
                    )}
                    {opt}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
